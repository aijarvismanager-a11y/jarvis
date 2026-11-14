import type { MissionEngine } from "./missionEngine.ts";
import type { Store } from "./store.ts";

// The watchdog: every minute it looks at the running requests and fixes the two ways one can silently stop moving.
//  1. A request is "running" but nothing drives it (its loop ended or died): start it again.
//  2. A task has been "running" with no sign of life for a long time (no event of its own, no approval or all-resting wait to explain it):
//     stop it. It ends as a failed attempt and the ordinary automatic retry (bounded) runs it again, possibly with another AI.
// It never creates a request and never touches a task that is waiting for a person. Every action is written as a WATCHDOG_* event.

/** No event from a running task for this long = stalled. Longer than the 20 min Claude task limit, so a slow but alive task is never cut. */
export const STALL_MS = 35 * 60_000;
/** After this many stops of the same task the watchdog leaves it alone (the ordinary retry limit and the person take over). */
export const MAX_STALL_ABORTS = 3;

/** Event types that explain a quiet task: it is waiting for a person or for a resting AI, not stuck. */
const WAITING_TYPES = new Set(["APPROVAL_REQUESTED", "TASK_WAITS_ALL_RESTING"]);

export type TaskView = { id: string; status: string; lastEventType: string | null; lastEventMs: number | null; stallAborts: number };

/** Pure: ids of the running, in-process tasks that should be stopped. */
export function stalledTasks(tasks: TaskView[], inFlight: ReadonlySet<string>, nowMs: number, stallMs = STALL_MS): string[] {
  return tasks
    .filter((t) => t.status === "running" && inFlight.has(t.id))
    .filter((t) => !(t.lastEventType && WAITING_TYPES.has(t.lastEventType)))
    .filter((t) => t.lastEventMs !== null && nowMs - t.lastEventMs > stallMs)
    .filter((t) => t.stallAborts < MAX_STALL_ABORTS)
    .map((t) => t.id);
}

/** A request waiting for a person's answer this long gets a reminder, then another every REMIND_EVERY_MS (the client shows it as a notification). */
export const APPROVAL_STALE_MS = 10 * 60_000;
export const REMIND_EVERY_MS = 30 * 60_000;
/** A running request with nothing ready, running or waiting for this long has stopped moving. */
export const NO_PROGRESS_MS = 5 * 60_000;

/** Pure: which pending approvals need a reminder now. `lastRemindedMs` is when each was last reminded (absent = never). */
export function approvalsToRemind(pending: { id: string; createdAt: string }[], nowMs: number, lastRemindedMs: ReadonlyMap<string, number>): { id: string; waitedMinutes: number }[] {
  return pending
    .filter((a) => {
      const waited = nowMs - Date.parse(a.createdAt);
      if (!(waited >= APPROVAL_STALE_MS)) return false;
      const last = lastRemindedMs.get(a.id);
      return last === undefined || nowMs - last >= REMIND_EVERY_MS;
    })
    .map((a) => ({ id: a.id, waitedMinutes: Math.round((nowMs - Date.parse(a.createdAt)) / 60_000) }));
}

const LIVE = new Set(["ready", "running", "validation", "waiting", "paused"]);
/** Pure: a running request has work left but none of it is alive (everything left is pending or blocked behind something that will not finish). */
export function hasNoLiveWork(tasks: { status: string }[]): boolean {
  const left = tasks.filter((t) => t.status !== "completed" && t.status !== "cancelled");
  return left.length > 0 && !left.some((t) => LIVE.has(t.status));
}

export type WatchdogState = { reminded: Map<string, number>; noLiveSince: Map<string, number>; alerted: Set<string> };
export const newWatchdogState = (): WatchdogState => ({ reminded: new Map(), noLiveSince: new Map(), alerted: new Set() });
export type WatchdogResult = { restarted: string[]; stopped: string[]; reminded: string[]; noProgress: string[] };

/** One pass over every running request. Never throws. */
export function watchdogTick(store: Store, engine: MissionEngine, nowMs = Date.now(), opts: { approvals?: { list(): { id: string; projectId: string; taskId: string; createdAt: string; reason: string }[] }; state?: WatchdogState } = {}): WatchdogResult {
  const out: WatchdogResult = { restarted: [], stopped: [], reminded: [], noProgress: [] };
  const state = opts.state ?? newWatchdogState();
  try {
    // a person's answer is being waited for: remind (the request cannot move without it)
    const pending = opts.approvals?.list() ?? [];
    for (const a of approvalsToRemind(pending, nowMs, state.reminded)) {
      const full = pending.find((p) => p.id === a.id)!;
      state.reminded.set(a.id, nowMs);
      store.appendEvent({ projectId: full.projectId, taskId: full.taskId, type: "WATCHDOG_APPROVAL_WAITING", payload: { approvalId: a.id, waitedMinutes: a.waitedMinutes, reason: full.reason.slice(0, 160) } });
      out.reminded.push(a.id);
    }
    for (const id of [...state.reminded.keys()]) if (!pending.some((p) => p.id === id)) state.reminded.delete(id);
    for (const project of store.listProjects()) {
      for (const mission of store.listMissions(project.id).filter((m) => m.status === "running")) {
        const tasks = store.listTasks(project.id).filter((t) => t.missionId === mission.id);
        if (!engine.isDriving(mission.id)) {
          store.appendEvent({ projectId: project.id, type: "WATCHDOG_RESTARTED", payload: { missionId: mission.id, reason: "実行中の依頼を動かす処理が止まっていたため、もう一度動かしました" } });
          void engine.run(project.id, mission.id).catch(() => undefined);
          out.restarted.push(mission.id);
          continue;
        }
        // nothing left is alive although the request is not finished: tell the person once it has lasted a while
        if (hasNoLiveWork(tasks) && pending.every((p) => p.projectId !== project.id)) {
          const since = state.noLiveSince.get(mission.id) ?? nowMs;
          state.noLiveSince.set(mission.id, since);
          if (nowMs - since >= NO_PROGRESS_MS && !state.alerted.has(mission.id)) {
            state.alerted.add(mission.id);
            store.appendEvent({ projectId: project.id, type: "WATCHDOG_NO_PROGRESS", payload: { missionId: mission.id, quietMinutes: Math.round((nowMs - since) / 60_000), left: tasks.filter((t) => t.status !== "completed" && t.status !== "cancelled").map((t) => `${t.id}:${t.status}`).slice(0, 12) } });
            out.noProgress.push(mission.id);
          }
        } else {
          state.noLiveSince.delete(mission.id);
          state.alerted.delete(mission.id);
        }
        const inFlight = new Set(engine.inFlightTaskIds(mission.id));
        const views: TaskView[] = tasks.map((t) => {
          const last = store.db.prepare("SELECT type, created_at FROM events WHERE task_id = ? ORDER BY rowid DESC LIMIT 1").get(t.id) as { type: string; created_at: string } | undefined;
          const aborts = (store.db.prepare("SELECT COUNT(*) AS n FROM events WHERE task_id = ? AND type = 'WATCHDOG_STOPPED_TASK'").get(t.id) as { n: number }).n;
          return { id: t.id, status: t.status, lastEventType: last?.type ?? null, lastEventMs: last ? Date.parse(last.created_at) : null, stallAborts: aborts };
        });
        for (const id of stalledTasks(views, inFlight, nowMs)) {
          store.appendEvent({ projectId: project.id, taskId: id, type: "WATCHDOG_STOPPED_TASK", payload: { missionId: mission.id, quietMinutes: Math.round(STALL_MS / 60_000), reason: "進みがないまま止まっていたため中断しました" } });
          if (engine.abortStalled(mission.id, id)) out.stopped.push(id);
        }
      }
    }
  } catch {
    /* a failed look must never harm the server: try again next minute */
  }
  return out;
}

export function startWatchdog(store: Store, engine: MissionEngine, approvals?: { list(): { id: string; projectId: string; taskId: string; createdAt: string; reason: string }[] }, intervalMs = 60_000, graceMs = 120_000): void {
  const up = Date.now();
  const state = newWatchdogState();
  const tick = () => {
    if (Date.now() - up >= graceMs) watchdogTick(store, engine, Date.now(), { approvals, state });
  };
  setInterval(tick, intervalMs).unref();
}
