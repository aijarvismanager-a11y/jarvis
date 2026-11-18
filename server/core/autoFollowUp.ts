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

/** File names (lower-cased, folders dropped) that a piece of text points at: "_ai-records/x/cmd-spec.md" -> "cmd-spec.md". */
export function mentionedFiles(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.matchAll(/[A-Za-z0-9_.\\/-]+\.(?:md|txt|json|ya?ml|html?|css|tsx?|jsx?|mjs|ps1|py|cs|cpp|h|rs|go|java|sql|svg|xml|toml|ini|bat)\b/gi)) {
    out.add(m[0].split(/[\\/]/).pop()!.toLowerCase());
  }
  return out;
}

/** The idea only points at files that this request (or one it followed up on) already worked on: another round on the same file. Returns that file, or null. */
export function sameFileFollowUp(idea: { title: string; request: string }, previousGoals: string[]): string | null {
  const ideaFiles = mentionedFiles(`${idea.title} ${idea.request}`);
  if (ideaFiles.size === 0) return null;
  const done = new Set<string>();
  for (const g of previousGoals) for (const f of mentionedFiles(g)) done.add(f);
  const all = [...ideaFiles];
  return all.every((f) => done.has(f)) ? all[0] : null;
}

/** An idea whose work only a person can do (delete by hand, run by hand and paste the output, approve): a request made of it cannot finish by itself. */
export const HUMAN_ONLY_WORK = /人が(手で|自分で|通常の|実際に|[^、。\n]{0,14}(実行|削除|貼|取得|承認|押))|手で(削除|実行|貼)|削除を承認|手動で(削除|実行)/;

/** How many automatic follow-ups were made for the project in this window: a person starting a new request does not reset it. */
export const FOLLOW_UP_WINDOW_HOURS = 2;

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
  /** the goals of this request and of the requests it followed up on (see sameFileFollowUp) */
  previousGoals?: string[];
  /** automatic follow-ups already made for this project within FOLLOW_UP_WINDOW_HOURS */
  recentFollowUps?: number;
}): FollowUpDecision {
  if (!input.enabled) return { create: false, reason: "自動の続きの依頼が切ってあります" };
  if (input.alreadyDone) return { create: false, reason: "この依頼の続きは、すでに作ってあります" };
  if (!input.acceptance) return { create: false, reason: "達成度チェックの結果がありません" };
  const notDone = input.acceptance.items.some((i) => i.status === "unmet" || i.status === "partial") || (input.acceptance.score !== null && input.acceptance.score < FOLLOW_UP_SCORE_BELOW);
  if (!notDone) return { create: false, reason: "達成度チェックで、足りない点がありませんでした" };
  if (!input.recommended) return { create: false, reason: "次の依頼の提案がありません" };
  // an idea that has the AI widen its own permissions can only fail (it refuses), so it is left for a person to decide
  if (SELF_PERMISSION_TASK.test(`${input.recommended.title} ${input.recommended.request}`)) return { create: false, reason: "提案が、AI自身の許可設定の変更を含むため、自動では続けません。人が決めてください" };
  if (HUMAN_ONLY_WORK.test(`${input.recommended.title} ${input.recommended.request}`)) return { create: false, reason: "提案の中身が、人が手で行う作業(削除・実行・貼り付け・承認など)のため、自動では続けません。人が行ってから依頼してください" };
  const sameFile = sameFileFollowUp(input.recommended, input.previousGoals ?? []);
  if (sameFile) return { create: false, reason: `提案は、すでに作業した同じファイル(${sameFile})の続きです。細かい直しが続きやすいため、自動では続けません。続けるかは人が決めてください` };
  if ((input.recentFollowUps ?? 0) >= MAX_FOLLOW_UP_DEPTH) return { create: false, reason: `この${FOLLOW_UP_WINDOW_HOURS}時間に、自動の続きをすでに${input.recentFollowUps}回作りました。ここで人の判断を待ちます` };
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

/** The goals of this request and, going back, of each request it followed up on. */
export function chainGoals(store: Store, missionId: string): string[] {
  const goals: string[] = [];
  let cur: string | undefined = missionId;
  for (let i = 0; cur && i < MAX_FOLLOW_UP_DEPTH + 3; i++) {
    const row = store.db.prepare("SELECT goal FROM missions WHERE id = ?").get(cur) as { goal?: string } | undefined;
    if (row?.goal) goals.push(row.goal);
    cur = store.getSetting<{ from: string } | null>(followUpOfKey(cur), null)?.from;
  }
  return goals;
}

export function recentFollowUpCount(store: Store, projectId: string, now = Date.now()): number {
  const since = new Date(now - FOLLOW_UP_WINDOW_HOURS * 3600_000).toISOString();
  const row = store.db.prepare("SELECT COUNT(*) AS n FROM events WHERE project_id = ? AND type = 'AUTO_FOLLOW_UP_CREATED' AND created_at >= ?").get(projectId, since) as { n: number };
  return row.n;
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
      previousGoals: chainGoals(store, missionId),
      recentFollowUps: recentFollowUpCount(store, projectId),
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
