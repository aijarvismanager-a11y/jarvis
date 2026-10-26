import type { AiService, Store } from "./store.ts";

// Adjusting the AI scores from what really happened.
//
// The registry's scores are initial assumptions. Every outcome of a task counts for the AI that did the work:
//   good: the task passed its checks (weak), another AI's review approved it (strong), the run worked
//   bad:  the checks failed, the review said "要修正" (strong), the run failed, the automation of a site broke
// An AI's quality (and its fit for the kind of work) moves from its starting value (the snapshot taken at the first outcome) by
//   (share of good outcomes - the expected share) * 5, scaled by how much evidence there is, and never more than MAX_SHIFT.
// Nothing moves before MIN_WEIGHT outcomes. The starting values are kept, so everything can be put back.
// The tallies live in the settings, not in the projects: deleting a project does not erase what was learned.

export const TUNING_KEY = "score_tuning";
export const MAX_SHIFT = 1;
export const MIN_WEIGHT = 3;
const CONFIDENCE_K = 8;
const EXPECTED = { quality: 0.8, reliability: 0.9 } as const;

export type Tally = { good: number; bad: number };
type Base = { quality: number | null; reliability: number | null; caps: Record<string, number> };
type Stats = { quality: Tally; reliability: Tally; caps: Record<string, Tally> };
type Data = { enabled: boolean; base: Record<string, Base>; stats: Record<string, Stats> };

export type Outcome = "exec_ok" | "exec_fail" | "automation_break" | "validation_pass" | "validation_fail" | "review_approve" | "review_revise";
const WEIGHTS: Record<Outcome, { kind: "quality" | "reliability"; good: number; bad: number }> = {
  exec_ok: { kind: "reliability", good: 1, bad: 0 },
  exec_fail: { kind: "reliability", good: 0, bad: 1 },
  automation_break: { kind: "reliability", good: 0, bad: 1 },
  validation_pass: { kind: "quality", good: 0.5, bad: 0 },
  validation_fail: { kind: "quality", good: 0, bad: 1 },
  review_approve: { kind: "quality", good: 1, bad: 0 },
  review_revise: { kind: "quality", good: 0, bad: 1.5 },
};

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const round1 = (n: number) => Math.round(n * 10) / 10;
const emptyTally = (): Tally => ({ good: 0, bad: 0 });

/** The new score from its starting value and the evidence; unchanged until there is enough evidence. */
export function shiftedScore(base: number, tally: Tally, expected: number): number {
  const weight = tally.good + tally.bad;
  if (weight < MIN_WEIGHT) return base;
  const confidence = weight / (weight + CONFIDENCE_K);
  const delta = clamp((tally.good / weight - expected) * 5 * confidence, -MAX_SHIFT, MAX_SHIFT);
  return round1(clamp(base + delta, 0, 5));
}

const load = (store: Store): Data => {
  const raw = store.getSetting<Partial<Data>>(TUNING_KEY, {});
  return { enabled: raw.enabled !== false, base: raw.base ?? {}, stats: raw.stats ?? {} };
};
const save = (store: Store, data: Data) => store.setSetting(TUNING_KEY, data);

const snapshot = (svc: AiService): Base => ({ quality: svc.qualityScore, reliability: svc.reliabilityScore, caps: { ...svc.capabilityScores } });

/** Writes the scores the evidence gives for one AI (or its starting values when `restore`). */
function writeScores(store: Store, data: Data, aiId: string, restore = false): void {
  const svc = store.getAiService(aiId);
  const base = data.base[aiId];
  if (!svc || !base) return;
  const stats = data.stats[aiId];
  const quality = base.quality === null ? null : restore || !stats ? base.quality : shiftedScore(base.quality, stats.quality, EXPECTED.quality);
  const reliability = base.reliability === null ? null : restore || !stats ? base.reliability : shiftedScore(base.reliability, stats.reliability, EXPECTED.reliability);
  const caps: Record<string, number | null> = Object.fromEntries(svc.capabilities.map((c) => [c, svc.capabilityScores[c] ?? null]));
  for (const [cap, start] of Object.entries(base.caps)) caps[cap] = restore || !stats?.caps[cap] ? start : shiftedScore(start, stats.caps[cap]!, EXPECTED.quality);
  store.setCapabilities(aiId, caps);
  store.patchAiService(aiId, { qualityScore: quality, reliabilityScore: reliability });
}

/** Counts one outcome for an AI (and the kind of work it was for) and applies the adjustment. Never throws: tuning must not stop a task. */
export function recordOutcome(store: Store, aiId: string | null | undefined, capability: string | null, outcome: Outcome): void {
  try {
    if (!aiId) return;
    const svc = store.getAiService(aiId);
    if (!svc) return;
    const data = load(store);
    data.base[aiId] ??= snapshot(svc);
    const stats = (data.stats[aiId] ??= { quality: emptyTally(), reliability: emptyTally(), caps: {} });
    const w = WEIGHTS[outcome];
    const targets = w.kind === "reliability" ? [stats.reliability] : [stats.quality, ...(capability && capability !== "unclassified" ? [(stats.caps[capability] ??= emptyTally())] : [])];
    for (const t of targets) {
      t.good += w.good;
      t.bad += w.bad;
    }
    save(store, data);
    if (data.enabled) writeScores(store, data, aiId);
  } catch {
    /* a failure of the bookkeeping is not the task's failure */
  }
}

export type TuningItem = { key: string; label: string; start: number | null; now: number | null; good: number; bad: number };
export type TuningEntry = { aiId: string; name: string; items: TuningItem[] };

/** What the settings screen shows: for each AI with evidence, every score with its starting value, its current value and the evidence. */
export function tuningReport(store: Store): { enabled: boolean; entries: TuningEntry[] } {
  const data = load(store);
  const entries: TuningEntry[] = [];
  for (const [aiId, stats] of Object.entries(data.stats)) {
    const svc = store.getAiService(aiId);
    const base = data.base[aiId];
    if (!svc || !base) continue;
    const items: TuningItem[] = [
      { key: "quality", label: "品質", start: base.quality, now: svc.qualityScore, ...stats.quality },
      { key: "reliability", label: "信頼性", start: base.reliability, now: svc.reliabilityScore, ...stats.reliability },
      ...Object.entries(stats.caps).filter(([cap]) => cap in base.caps).map(([cap, t]) => ({ key: `cap:${cap}`, label: `得意分野: ${cap}`, start: base.caps[cap] ?? null, now: svc.capabilityScores[cap] ?? null, ...t })),
    ];
    entries.push({ aiId, name: svc.name, items });
  }
  return { enabled: data.enabled, entries: entries.sort((a, b) => a.name.localeCompare(b.name)) };
}

/** The tally and the starting value of one score, for "why this AI" (null when nothing has been counted for it). */
export function tuningOf(store: Store, aiId: string, capability: string): { start: number; now: number; good: number; bad: number } | null {
  const data = load(store);
  const base = data.base[aiId]?.caps[capability];
  const tally = data.stats[aiId]?.caps[capability];
  const svc = store.getAiService(aiId);
  if (base === undefined || !tally || !svc || svc.capabilityScores[capability] === undefined) return null;
  return { start: base, now: svc.capabilityScores[capability]!, good: round1(tally.good), bad: round1(tally.bad) };
}

export function setTuningEnabled(store: Store, enabled: boolean): void {
  const data = load(store);
  data.enabled = enabled;
  save(store, data);
  for (const aiId of Object.keys(data.base)) writeScores(store, data, aiId, !enabled);
}

/** Puts the starting values back and forgets the evidence, for one AI or all. */
export function resetTuning(store: Store, aiId?: string): void {
  const data = load(store);
  for (const id of aiId ? [aiId] : Object.keys(data.base)) {
    writeScores(store, data, id, true);
    delete data.base[id];
    delete data.stats[id];
  }
  save(store, data);
}
