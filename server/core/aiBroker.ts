import { botCheckExclusions } from "./botCheck.ts";
import { claudeLimitExclusions, readClaudeQuota } from "./claudeQuota.ts";
import { usageLimitExclusions } from "./usageLimit.ts";
import { capabilityForRole } from "./legacyImport.ts";
import type { AiService, Store, Task } from "./store.ts";

// AI Broker (spec §18/§19/§56/§58). Pure scoring over the registry: no I/O, so
// it is cheap to call on every task and easy to test.
//
//   total = fit*4 + quality*3 + automation*2 + safety*1   (each 0-5, max 50; /5 = 10-point scale)
//
// Candidates whose totals are within NEAR_BEST (0.4 of 10) of the best are "as good as each other": the scores are initial
// assumptions, not measurements, so a few hundredths decide nothing. Among them the work is shared: first the AI used least in
// this mission, then the one used least in the last 24 hours (free tiers have daily limits), then the specialist (higher fit for
// the kind of work), then the higher total, and last a tie broken by the task id, so equals are not always decided by their names.
// Without usage data the best total (then the name) wins, as before.
//
// Cost Guard (§56): a paid or API-key service is BLOCKED unless the mission's
// budget policy is allow_paid. Unavailable/retired services are excluded.

export const BROKER_WEIGHTS = { fit: 4, quality: 3, automation: 2, safety: 1 } as const;
const MAX_TOTAL = 5 * (BROKER_WEIGHTS.fit + BROKER_WEIGHTS.quality + BROKER_WEIGHTS.automation + BROKER_WEIGHTS.safety);
/** Neutral scores for data the registry does not have yet (lowers confidence, does not exclude). */
const UNKNOWN_QUALITY = 2.5;
const UNCLASSIFIED_FIT = 2;
const LOW_CONFIDENCE = 0.7;
/** On the 50-point scale: 2.0 = 0.4 on the 10-point scale. */
export const NEAR_BEST = 2;
/** how far below the best picture AI an automatic one may be and still be preferred (it saves the picture itself) */
export const PICTURE_AUTO_NEAR_BEST = 6;
/** Task work spreads over every AI within this many points (1.5 of 10) of the best, least used first: a few AIs were doing nearly everything. */
export const TASK_NEAR_BEST = 7.5;
/** From this share of the Claude plan (5-hour or 7-day window) used, Claude is spared for work only it can do (editing code). */
export const CLAUDE_SPARE_AT = 0.6;
export const USAGE_WINDOW_MS = 24 * 60 * 60 * 1000;

const ROLE_ALIASES: Record<string, string> = {
  code: "coding", coding: "coding", implement: "coding", implementation: "coding", refactor: "coding", integration: "coding", frontend: "coding", backend: "coding", database: "coding",
  fix: "debugging", bugfix: "debugging", debug: "debugging", debugging: "debugging",
  test: "testing", testing: "testing", qa: "testing",
  research: "research", "market research": "research", "technical research": "research",
  requirements: "architecture", requirement: "architecture", architecture: "architecture", design: "architecture",
  "ui design": "ux_review", review: "ux_review", "final review": "ux_review",
  docs: "documentation", documentation: "documentation",
  translation: "translation", seo: "seo",
  ideation: "ideation", brainstorm: "ideation", brainstorming: "ideation", naming: "ideation", copywriting: "ideation", "ux copy": "ideation",
  illustration: "image_generation", icon: "image_generation", logo: "image_generation", banner: "image_generation", graphic: "image_generation", "image generation": "image_generation",
  video: "video_generation", music: "music_generation", bgm: "music_generation", voice: "voice_generation", narration: "voice_generation",
  "fact check": "research", "fact-check": "research", factcheck: "research",
};

/** Work only a person can hand over today (the answer is a picture, a clip, a song or a voice, not text the app can read back): these may go to an AI that is not automatic. */
export const MEDIA_CAPABILITIES = ["image_generation", "video_generation", "music_generation", "voice_generation"];
export const MANUAL_TEXT_KEY = "allowManualTextAis";
export const isMediaCapability = (capability: string): boolean => MEDIA_CAPABILITIES.includes(capability);

/** Maps a Planner role to a registry capability ("unclassified" when it cannot). */
export function capabilityForTaskRole(role: string): string {
  const key = role.trim().toLowerCase();
  return ROLE_ALIASES[key] ?? capabilityForRole(role);
}

export type BrokerBreakdown = { fit: number; quality: number; automation: number; safety: number };
export type BrokerCandidate = {
  aiId: string;
  name: string;
  breakdown: BrokerBreakdown;
  /** weighted sum, 0-50 */
  total: number;
  /** total on the spec's 10-point scale */
  score10: number;
  notes: string[];
};
export type BrokerStrategy = "A" | "B" | "C";
export type BrokerDecision = {
  capability: string;
  selected: BrokerCandidate | null;
  /** 0-1; below 0.7 the caller should consider another candidate (§58) */
  confidence: number;
  confidenceLabel: "high" | "medium" | "low";
  needsReview: boolean;
  ranked: BrokerCandidate[];
  excluded: { aiId: string; name: string; reason: string }[];
  /** §19: best candidate per strategy. A quality-first, B automation-first, C free / manual-fallback-first. */
  alternatives: Record<BrokerStrategy, BrokerCandidate | null>;
  reason: string;
  /** The equally good AIs the choice was made from (ids; just the winner when there was no real choice). */
  shared: string[];
  /** How much each of the shared AIs had been used: in this mission and in the last 24 hours. */
  usage: AiUsage;
};
export type BrokerOptions = {
  /** Hidden switch (setting allowManualTextAis, off by default): let AIs that need a person to copy and paste take text work. */
  allowManualText?: boolean;
  budgetPolicy?: "free_only" | "allow_paid";
  /** Restrict to services whose adapter_type can actually be run (e.g. ["claude-code"]). */
  executableAdapters?: string[];
  /** how far below the best (in total points) an AI may be and still share the work; reviews keep the narrow default, task work spreads wider */
  nearBest?: number;
  /** points taken off an AI's total while its allowance runs low (the Claude plan): it stays a fallback but others are tried first */
  penalties?: Record<string, number>;
  /** AIs left out for now, with the reason (a bot check that is waiting for the person; see botCheck.ts). */
  restingAis?: Record<string, string>;
  /** AIs that already failed this task; skipped so a retry falls back to the next candidate. */
  excludeAiIds?: string[];
  /** How much each AI was used lately (see aiUsage); lets equally good AIs take turns. */
  usage?: AiUsage;
  /** Breaks a tie between equals (the task id): the same task decides the same way, different tasks differently. */
  seed?: string;
};
export type AiUsage = Record<string, { mission: number; recent: number }>;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const round = (n: number, digits = 2) => Math.round(n * 10 ** digits) / 10 ** digits;

/** Why Cost Guard blocks a service, or null when it may be used. */
export function costGuardReason(service: Pick<AiService, "freeStatus" | "requiresApiKey">, budgetPolicy: "free_only" | "allow_paid"): string | null {
  if (budgetPolicy === "allow_paid") return null;
  if (service.freeStatus === "paid") return "有料サービスのためCost Guardでブロック";
  if (service.requiresApiKey) return "APIキーが必要(従量課金の可能性)のためCost Guardでブロック";
  return null;
}

function safetyScore(s: AiService, notes: string[]): number {
  let safety = 5;
  if (s.requiresApiKey) {
    safety -= 3;
    notes.push("APIキー必須(許可済み)");
  }
  if (s.requiresLogin) safety -= 1;
  if (s.freeStatus === "unknown") {
    safety -= 1;
    notes.push("無料条件が未確認");
  }
  if (s.freeStatus === "trial") {
    safety -= 1;
    notes.push("トライアルのため将来有料になる可能性");
  }
  if (s.freeStatus === "paid") {
    safety -= 2;
    notes.push("有料(許可済み)");
  }
  if (s.reliabilityScore !== null && s.reliabilityScore < 3) safety -= 1;
  return clamp(safety, 0, 5);
}

function score(s: AiService, capability: string): BrokerCandidate | null {
  const notes: string[] = [];
  const explicit = s.capabilityScores[capability];
  const registered = s.capabilities.includes(capability);
  let fit: number;
  if (capability === "unclassified") {
    fit = UNCLASSIFIED_FIT;
    notes.push("役割を能力に分類できないため能力適合は仮の値");
  } else if (explicit !== undefined) fit = explicit;
  else if (registered) {
    fit = 3;
    notes.push("この能力のスコア未設定(仮の3)");
  } else return null;
  if (fit <= 0) return null;
  if (s.qualityScore === null) notes.push("品質スコア未設定(中立値)");
  const quality = s.qualityScore ?? UNKNOWN_QUALITY;
  const automation = round((clamp(s.automationLevel, 1, 3) * 5) / 3);
  const safety = safetyScore(s, notes);
  if (!s.lastVerifiedAt) notes.push("ヘルスチェック未実施");
  const total = round(fit * BROKER_WEIGHTS.fit + quality * BROKER_WEIGHTS.quality + automation * BROKER_WEIGHTS.automation + safety * BROKER_WEIGHTS.safety);
  return { aiId: s.id, name: s.name, breakdown: { fit, quality, automation, safety }, total, score10: round(total / 5, 1), notes };
}

/** How complete the registry data behind a candidate is, 0-1. */
function completeness(s: AiService, capability: string): number {
  return ([s.qualityScore !== null, s.capabilityScores[capability] !== undefined, s.lastVerifiedAt !== null].filter(Boolean).length) / 3;
}

const byTotal = (a: BrokerCandidate, b: BrokerCandidate) => b.total - a.total || a.name.localeCompare(b.name);

/** A small stable number from a text (FNV-1a): the same task always breaks a tie the same way, different tasks differently. */
const hashOf = (text: string): number => {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
};

/**
 * From candidates sorted best first: the best one, or - when usage is known - one of those within NEAR_BEST of it, taking the one
 *   used least in this mission, then least in the last 24 hours, then the specialist (the higher fit for this kind of work), then
 *   the higher total, and last a tie broken by the task (`seed`, so equals are not always decided by their names).
 * `shared` is the set of equally good AIs the choice was made from.
 */
export function pickBalanced(ranked: BrokerCandidate[], usage?: AiUsage, seed?: string, nearBest = NEAR_BEST): { pick: BrokerCandidate | null; shared: BrokerCandidate[] } {
  const best = ranked[0];
  if (!best) return { pick: null, shared: [] };
  if (!usage) return { pick: best, shared: [best] };
  const near = ranked.filter((c) => best.total - c.total <= nearBest);
  const used = (c: BrokerCandidate) => usage[c.aiId] ?? { mission: 0, recent: 0 };
  const lastResort = (a: BrokerCandidate, b: BrokerCandidate) => (seed ? hashOf(`${seed}:${a.aiId}`) - hashOf(`${seed}:${b.aiId}`) : a.name.localeCompare(b.name));
  const pick = [...near].sort((a, b) => used(a).mission - used(b).mission || used(a).recent - used(b).recent || b.breakdown.fit - a.breakdown.fit || b.total - a.total || lastResort(a, b))[0]!;
  return { pick, shared: near };
}

/** Runs per AI: in the same mission (other tasks that already have the AI) and in the last 24 hours (runs of any task, reviews included). */
export function aiUsage(store: Store, scope: { missionId?: string; taskId?: string; now?: number } = {}): AiUsage {
  const out: AiUsage = {};
  const add = (id: string | null, key: "mission" | "recent", n: number) => {
    if (id) (out[id] ??= { mission: 0, recent: 0 })[key] += n;
  };
  const since = new Date((scope.now ?? Date.now()) - USAGE_WINDOW_MS).toISOString();
  for (const r of store.db.prepare("SELECT ai_id, COUNT(*) AS n FROM ai_runs WHERE started_at >= ? AND status IN ('succeeded', 'failed') GROUP BY ai_id").all(since) as { ai_id: string | null; n: number }[]) add(r.ai_id, "recent", r.n);
  if (scope.missionId) {
    for (const r of store.db.prepare("SELECT selected_ai AS ai_id, COUNT(*) AS n FROM tasks WHERE mission_id = ? AND id != ? AND selected_ai IS NOT NULL GROUP BY selected_ai").all(scope.missionId, scope.taskId ?? "") as { ai_id: string; n: number }[]) add(r.ai_id, "mission", r.n);
  }
  return out;
}

export function chooseAi(services: AiService[], capability: string, options: BrokerOptions = {}): BrokerDecision {
  const budgetPolicy = options.budgetPolicy ?? "free_only";
  const excluded: BrokerDecision["excluded"] = [];
  const eligible: { service: AiService; candidate: BrokerCandidate }[] = [];
  for (const s of services) {
    if (s.status !== "active") {
      excluded.push({ aiId: s.id, name: s.name, reason: s.status === "unavailable" ? "ヘルスチェックで利用不可と判定" : "廃止済み" });
      continue;
    }
    const candidate = score(s, capability);
    if (!candidate) continue; // simply not capable: not worth listing
    const penalty = options.penalties?.[s.id] ?? 0;
    if (penalty > 0) {
      candidate.total = round(candidate.total - penalty);
      candidate.score10 = round(candidate.total / 5, 1);
      candidate.notes.push(`利用枠が残り少ないため${round(penalty / 5, 1)}点下げています`);
    }
    if (s.accessMode === "web" && s.automationLevel <= 2 && !options.allowManualText) {
      // an AI that needs a person to carry text or files between sites does not fit this app: it is never chosen (pictures become SVG, music/video are put on hold)
      excluded.push({ aiId: s.id, name: s.name, reason: "人の操作が要る(手動・半自動)ため、担当には選びません(自動で使えるようになるまで待ちです)" });
      continue;
    }
    const resting = options.restingAis?.[s.id];
    if (resting) {
      excluded.push({ aiId: s.id, name: s.name, reason: resting });
      continue;
    }
    if (options.excludeAiIds?.includes(s.id)) {
      excluded.push({ aiId: s.id, name: s.name, reason: "この作業で失敗したためフォールバックで除外" });
      continue;
    }
    if (options.executableAdapters && !options.executableAdapters.includes(s.adapterType)) {
      excluded.push({ aiId: s.id, name: s.name, reason: `この実行基盤では実行できない(${s.adapterType})` });
      continue;
    }
    const blocked = costGuardReason(s, budgetPolicy);
    if (blocked) {
      excluded.push({ aiId: s.id, name: s.name, reason: blocked });
      continue;
    }
    eligible.push({ service: s, candidate });
  }

  const ranked = eligible.map((e) => e.candidate).sort(byTotal);
  const pick = (strategy: BrokerStrategy): BrokerCandidate | null => {
    const pool = strategy === "C" ? eligible.filter((e) => (e.service.freeStatus === "free" || e.service.freeStatus === "free_tier") && !e.service.requiresApiKey) : eligible;
    const sortKey: Record<BrokerStrategy, (c: BrokerCandidate) => number> = {
      A: (c) => c.breakdown.fit * BROKER_WEIGHTS.fit + c.breakdown.quality * BROKER_WEIGHTS.quality,
      B: (c) => c.breakdown.automation,
      C: (c) => c.breakdown.safety,
    };
    return [...pool].map((e) => e.candidate).sort((a, b) => sortKey[strategy](b) - sortKey[strategy](a) || byTotal(a, b))[0] ?? null;
  };

  // Pictures: an AI the app drives by itself (it saves the picture) is chosen over a slightly better one that needs the person to copy, paste and carry the file back.
  const near = options.nearBest ?? NEAR_BEST;
  const levelOf = (c: BrokerCandidate) => eligible.find((e) => e.candidate.aiId === c.aiId)?.service.automationLevel ?? 1;
  const bestTotal = ranked[0]?.total ?? 0;
  const autoPictures = capability === "image_generation" ? ranked.filter((c) => levelOf(c) >= 3 && bestTotal - c.total <= Math.max(near, PICTURE_AUTO_NEAR_BEST)) : [];
  const balanced = pickBalanced(autoPictures.length ? autoPictures : ranked, options.usage, options.seed, options.nearBest);
  const selected = balanced.pick;
  let confidence = 0;
  if (selected) {
    const service = eligible.find((e) => e.candidate.aiId === selected.aiId)!.service;
    const rival = ranked.find((c) => c.aiId !== selected.aiId);
    const margin = rival ? clamp(Math.abs(selected.total - rival.total) / 5, 0, 1) : 0.5; // a lone candidate cannot be compared
    confidence = round(clamp(0.55 * (selected.total / MAX_TOTAL) + 0.3 * completeness(service, capability) + 0.15 * margin, 0, 1));
    if (capability === "unclassified") confidence = Math.min(confidence, 0.6);
  }
  const confidenceLabel = confidence >= 0.9 ? "high" : confidence >= LOW_CONFIDENCE ? "medium" : "low";
  const sharedNote = selected && balanced.shared.length > 1 ? `。同程度のAIが${balanced.shared.length}件(${balanced.shared.map((c) => c.name).join("、")})あるため、利用の少ない順に選びました` : "";
  const reason = selected
    ? `${selected.name}: 能力適合${selected.breakdown.fit}/品質${selected.breakdown.quality}/自動化${selected.breakdown.automation}/安全性${selected.breakdown.safety} → ${selected.score10}/10${sharedNote}`
    : `「${capability}」を担当できる利用可能なAIがありません`;
  return {
    capability,
    selected,
    confidence,
    confidenceLabel,
    needsReview: selected !== null && confidence < LOW_CONFIDENCE,
    ranked,
    excluded,
    alternatives: { A: pick("A"), B: pick("B"), C: pick("C") },
    reason,
    shared: balanced.shared.map((c) => c.aiId),
    usage: Object.fromEntries(balanced.shared.map((c) => [c.aiId, options.usage?.[c.aiId] ?? { mission: 0, recent: 0 }])),
  };
}

/** Convenience wrapper over the stored registry for one Task. */
export class AIBroker {
  constructor(private readonly store: Store) {}

  /** AIs left out for now: a bot check waiting for the person, a site limit, or the Claude plan used up (and the person chose to hand the work on). */
  private restingAis(): Record<string, string> {
    const ids = this.store.listAiServices().map((x) => x.id);
    // a bot check only matters where the app drives the page by itself (Level 3); at Level 2 the person is at the page and passes it
    const automatic = this.store.listAiServices().filter((x) => x.automationLevel >= 3).map((x) => x.id);
    return { ...botCheckExclusions(this.store, automatic), ...usageLimitExclusions(this.store, ids), ...claudeLimitExclusions(this.store, ids) };
  }

  /** The Claude plan is shared by Claude Code and claude.ai chat and cannot be topped up: from 60% used, other AIs get the work first. */
  private claudePenalties(): Record<string, number> {
    const q = readClaudeQuota(this.store);
    const used = Math.max(q?.fiveHour?.utilization ?? 0, q?.sevenDay?.utilization ?? 0);
    if (used < CLAUDE_SPARE_AT) return {};
    const penalty = Math.min(25, (used - 0.5) * 50);
    return Object.fromEntries(this.store.listAiServices().filter((x) => x.id.startsWith("claude")).map((x) => [x.id, penalty]));
  }

  select(task: Pick<Task, "role"> & Partial<Pick<Task, "id" | "missionId">>, options: BrokerOptions = {}): BrokerDecision {
    const usage = options.usage ?? aiUsage(this.store, { missionId: task.missionId, taskId: task.id });
    return chooseAi(this.store.listAiServices(), capabilityForTaskRole(task.role), { allowManualText: this.store.getSetting<boolean>(MANUAL_TEXT_KEY, false), nearBest: TASK_NEAR_BEST, penalties: this.claudePenalties(), restingAis: this.restingAis(), ...options, usage, seed: options.seed ?? task.id });
  }
}
