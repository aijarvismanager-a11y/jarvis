import { loadAcceptance, type Acceptance } from "./acceptance.ts";
import { loadNextIdeas } from "./nextIdeas.ts";
import type { Store } from "./store.ts";
import { SELF_PERMISSION_TASK } from "./taskGraph.ts";

// Automatic follow-up: when a request has finished but the acceptance check says it is NOT really done (something unmet / partly met),
// the orchestrator itself asks the planner for the next request - using the recommended idea - instead of leaving a person to read the
// findings and type the next request by hand. The new request stops at the normal "approve the plan" gate, so nothing runs without a yes.
// It is deliberately cautious: one follow-up per request, a limit on how long a chain may grow, never while another request is open.

export const AUTO_FOLLOW_UP_SETTING = "autoFollowUp";
export const MAX_FOLLOW_UP_DEPTH = 3;
/** below this score (0-100), or with anything unmet, the request counts as "not really done" */
export const FOLLOW_UP_SCORE_BELOW = 80;

export type FollowUpRecord = { from: string; depth: number; at: string; ideaTitle: string };
export const followUpKey = (missionId: string) => `follow-up:${missionId}`;
export const followUpOfKey = (missionId: string) => `follow-up-of:${missionId}`;

/** Words that identify what a check was about: file names, paths and program names (ASCII words of 4+ letters, dots kept: "sample.mp4"). */
export function checkTokens(objective: string): Set<string> {
  return new Set((objective.toLowerCase().match(/[a-z0-9][a-z0-9.]{3,}/g) ?? []).map((w) => w.replace(/\.$/, "")));
}

/** Do two checks (objectives) look like the same check worded differently? They share at least 3 identifying words. */
export function sameCheck(a: string, b: string): boolean {
  const ta = checkTokens(a);
  let shared = 0;
  for (const w of checkTokens(b)) if (ta.has(w)) shared++;
  return shared >= 3;
}

/** The checks that could not be done in a request ("CHECKS_NOT_DONE" events: a check whose retries ran out and was left as not verified). */
export function unverifiedChecks(store: Store, missionId: string): string[] {
  const rows = store.db.prepare("SELECT payload FROM events WHERE type = 'CHECKS_NOT_DONE' AND payload LIKE ?").all(`%"missionId":"${missionId}"%`) as { payload: string }[];
  const out: string[] = [];
  for (const r of rows) {
    try {
      for (const t of (JSON.parse(r.payload) as { tasks?: { objective?: string }[] }).tasks ?? []) if (typeof t.objective === "string") out.push(t.objective);
    } catch {
      /* skip */
    }
  }
  return out;
}

/** A check that could not be done in this request AND in the request it followed up on: trying again by itself will not help, a person decides. */
export function repeatedUnverified(store: Store, missionId: string): string | null {
  const parent = store.getSetting<{ from: string } | null>(followUpOfKey(missionId), null)?.from;
  if (!parent) return null;
  const before = unverifiedChecks(store, parent);
  for (const now of unverifiedChecks(store, missionId)) if (before.some((b) => sameCheck(now, b))) return now;
  return null;
}

export type FollowUpDecision = { create: true; request: string; title: string; depth: number } | { create: false; reason: string };

/** Pure decision: should a follow-up request be made for this finished request, and with what text? */
export function decideFollowUp(input: {
  enabled: boolean;
  acceptance: Acceptance | null;
  recommended: { title: string; request: string } | null;
  alreadyDone: boolean;
  depth: number;
  openMissions: number;
  /** a check that stayed "not verified" in this request and in the one before it (see repeatedUnverified) */
  repeatedUnverified?: string | null;
}): FollowUpDecision {
  if (!input.enabled) return { create: false, reason: "自動の続きの依頼が切ってあります" };
  if (input.alreadyDone) return { create: false, reason: "この依頼の続きは、すでに作ってあります" };
  if (!input.acceptance) return { create: false, reason: "達成度チェックの結果がありません" };
  const notDone = input.acceptance.items.some((i) => i.status === "unmet" || i.status === "partial") || (input.acceptance.score !== null && input.acceptance.score < FOLLOW_UP_SCORE_BELOW);
  if (!notDone) return { create: false, reason: "達成度チェックで、足りない点がありませんでした" };
  if (!input.recommended) return { create: false, reason: "次の依頼の提案がありません" };
  // an idea that has the AI widen its own permissions can only fail (it refuses), so it is left for a person to decide
  if (SELF_PERMISSION_TASK.test(`${input.recommended.title} ${input.recommended.request}`)) return { create: false, reason: "提案が、AI自身の許可設定の変更を含むため、自動では続けません。人が決めてください" };
  if (input.depth >= MAX_FOLLOW_UP_DEPTH) return { create: false, reason: `続きの依頼が${MAX_FOLLOW_UP_DEPTH}回続いたので、ここで人の判断を待ちます` };
  if (input.repeatedUnverified) return { create: false, reason: `同じ確認が続けて「未確認」のままです(${input.repeatedUnverified.slice(0, 50)}…)。自動でくり返しても変わらないため、ここで人の判断を待ちます` };
  if (input.openMissions > 0) return { create: false, reason: "ほかに終わっていない依頼があるので、重ねて作りません" };
  return { create: true, request: input.recommended.request, title: input.recommended.title, depth: input.depth + 1 };
}

/** How many follow-ups deep this request already is (0 for one a person made). */
export function followUpDepth(store: Store, missionId: string): number {
  let depth = 0;
  let cur = missionId;
  for (let i = 0; i < MAX_FOLLOW_UP_DEPTH + 2; i++) {
    const rec = store.getSetting<{ from: string } | null>(followUpOfKey(cur), null);
    if (!rec) break;
    depth++;
    cur = rec.from;
  }
  return depth;
}

const OPEN = new Set(["draft", "planning", "running", "paused"]);

export type FollowUpCreator = (input: { projectId: string; goal: string }) => Promise<{ mission: { id: string } }>;

/** Runs after the acceptance check and the next-ideas run. Best effort: returns the decision and never throws. */
export async function autoFollowUp(store: Store, create: FollowUpCreator, projectId: string, missionId: string): Promise<FollowUpDecision> {
  try {
    const ideas = loadNextIdeas(store, missionId);
    const recommended = ideas?.ideas.find((i) => i.recommended) ?? ideas?.ideas[0] ?? null;
    const decision = decideFollowUp({
      enabled: store.getSetting<boolean>(AUTO_FOLLOW_UP_SETTING, true) !== false,
      acceptance: loadAcceptance(store, missionId),
      recommended,
      alreadyDone: store.getSetting<FollowUpRecord | null>(followUpKey(missionId), null) !== null,
      depth: followUpDepth(store, missionId),
      openMissions: store.listMissions(projectId).filter((m) => m.id !== missionId && OPEN.has(m.status)).length,
      repeatedUnverified: repeatedUnverified(store, missionId),
    });
    if (!decision.create) {
      store.appendEvent({ projectId, type: "AUTO_FOLLOW_UP_SKIPPED", payload: { missionId, reason: decision.reason } });
      return decision;
    }
    // mark first: a second completion signal (or a restart) must not make a second request
    store.setSetting(followUpKey(missionId), { from: missionId, depth: decision.depth, at: new Date().toISOString(), ideaTitle: decision.title } satisfies FollowUpRecord);
    const { mission } = await create({ projectId, goal: decision.request });
    store.setSetting(followUpOfKey(mission.id), { from: missionId, depth: decision.depth });
    store.appendEvent({ projectId, type: "AUTO_FOLLOW_UP_CREATED", payload: { missionId, newMissionId: mission.id, title: decision.title, depth: decision.depth } });
    return decision;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    // the request was not made after all: let a later completion signal (or a manual run) try again
    try { store.deleteSetting(followUpKey(missionId)); } catch { /* best effort */ }
    try { store.appendEvent({ projectId, type: "AUTO_FOLLOW_UP_FAILED", payload: { missionId, reason: reason.slice(0, 300) } }); } catch { /* best effort */ }
    return { create: false, reason };
  }
}
