import { capabilityForRole } from "./legacyImport.ts";
import type { AiService, Store, Task } from "./store.ts";

// AI Broker (spec §18/§19/§56/§58). Pure scoring over the registry: no I/O, so
// it is cheap to call on every task and easy to test.
//
//   total = fit*4 + quality*3 + automation*2 + safety*1   (each 0-5, max 50; /5 = 10-point scale)
//
// Cost Guard (§56): a paid or API-key service is BLOCKED unless the mission's
// budget policy is allow_paid. Unavailable/retired services are excluded.

export const BROKER_WEIGHTS = { fit: 4, quality: 3, automation: 2, safety: 1 } as const;
const MAX_TOTAL = 5 * (BROKER_WEIGHTS.fit + BROKER_WEIGHTS.quality + BROKER_WEIGHTS.automation + BROKER_WEIGHTS.safety);
/** Neutral scores for data the registry does not have yet (lowers confidence, does not exclude). */
const UNKNOWN_QUALITY = 2.5;
const UNCLASSIFIED_FIT = 2;
const LOW_CONFIDENCE = 0.7;

const ROLE_ALIASES: Record<string, string> = {
  code: "coding", coding: "coding", implement: "coding", implementation: "coding", refactor: "coding", integration: "coding", frontend: "coding", backend: "coding", database: "coding",
  fix: "debugging", bugfix: "debugging", debug: "debugging", debugging: "debugging",
  test: "testing", testing: "testing", qa: "testing",
  research: "research", "market research": "research", "technical research": "research",
  requirements: "architecture", requirement: "architecture", architecture: "architecture", design: "architecture",
  "ui design": "ux_review", review: "ux_review", "final review": "ux_review",
  docs: "documentation", documentation: "documentation",
  translation: "translation", seo: "seo",
};

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
};
export type BrokerOptions = {
  budgetPolicy?: "free_only" | "allow_paid";
  /** Restrict to services whose adapter_type can actually be run (e.g. ["claude-code"]). */
  executableAdapters?: string[];
  /** AIs that already failed this task; skipped so a retry falls back to the next candidate. */
  excludeAiIds?: string[];
};

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

  const selected = ranked[0] ?? null;
  let confidence = 0;
  if (selected) {
    const service = eligible.find((e) => e.candidate.aiId === selected.aiId)!.service;
    const margin = ranked[1] ? clamp((selected.total - ranked[1].total) / 5, 0, 1) : 0.5; // a lone candidate cannot be compared
    confidence = round(clamp(0.55 * (selected.total / MAX_TOTAL) + 0.3 * completeness(service, capability) + 0.15 * margin, 0, 1));
    if (capability === "unclassified") confidence = Math.min(confidence, 0.6);
  }
  const confidenceLabel = confidence >= 0.9 ? "high" : confidence >= LOW_CONFIDENCE ? "medium" : "low";
  const reason = selected
    ? `${selected.name}: 能力適合${selected.breakdown.fit}/品質${selected.breakdown.quality}/自動化${selected.breakdown.automation}/安全性${selected.breakdown.safety} → ${selected.score10}/10`
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
  };
}

/** Convenience wrapper over the stored registry for one Task. */
export class AIBroker {
  constructor(private readonly store: Store) {}

  select(task: Pick<Task, "role">, options: BrokerOptions = {}): BrokerDecision {
    return chooseAi(this.store.listAiServices(), capabilityForTaskRole(task.role), options);
  }
}
