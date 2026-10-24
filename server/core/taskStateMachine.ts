import { transaction } from "./db.ts";
import type { Store, Task } from "./store.ts";
import type { MissionStatus, TaskStatus } from "./schema.ts";

// Task state machine (spec §17). Every status change in the orchestrator goes
// through transitionTask so an illegal move (e.g. completed -> running) throws
// instead of silently corrupting the graph.

export const MAX_RETRIES = 5; // spec §32: infinite retry is forbidden.

const TASK_TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  pending: ["ready", "blocked", "paused", "cancelled"],
  ready: ["running", "pending", "blocked", "paused", "cancelled"],
  running: ["waiting", "validation", "failed", "paused", "cancelled", "ready"], // running -> ready = crash recovery
  waiting: ["running", "validation", "failed", "paused", "cancelled", "ready"],
  validation: ["completed", "failed", "paused", "cancelled", "ready"],
  completed: [],
  failed: ["ready", "blocked", "cancelled"], // failed -> ready is a retry (see retryTask)
  blocked: ["pending", "ready", "cancelled"],
  paused: ["ready", "pending", "cancelled"],
  cancelled: [],
};

const MISSION_TRANSITIONS: Record<MissionStatus, readonly MissionStatus[]> = {
  draft: ["planning", "cancelled"],
  planning: ["running", "cancelled", "failed"],
  running: ["paused", "completed", "failed", "cancelled", "planning"], // running -> planning = replan
  paused: ["running", "cancelled", "planning"],
  completed: [],
  failed: ["planning", "running", "cancelled"], // failed -> running after a manual retry / replan
  cancelled: [],
};

export const TERMINAL_TASK_STATUSES: readonly TaskStatus[] = ["completed", "cancelled"];

export class IllegalTransitionError extends Error {
  constructor(
    readonly kind: "task" | "mission",
    readonly from: string,
    readonly to: string,
  ) {
    super(`不正な状態遷移です(${kind}: ${from} -> ${to})`);
    this.name = "IllegalTransitionError";
  }
}

export function canTransitionTask(from: TaskStatus, to: TaskStatus): boolean {
  return TASK_TRANSITIONS[from].includes(to);
}

export function canTransitionMission(from: MissionStatus, to: MissionStatus): boolean {
  return MISSION_TRANSITIONS[from].includes(to);
}

export function transitionTask(store: Store, projectId: string, taskId: string, to: TaskStatus, reason?: string): Task {
  return transaction(store.db, () => {
    const task = store.getTask(projectId, taskId);
    if (!task) throw new Error("作業が見つかりません");
    if (task.status === to) return task;
    if (!canTransitionTask(task.status, to)) throw new IllegalTransitionError("task", task.status, to);
    store.setTaskStatus(projectId, taskId, to);
    if (reason) store.appendEvent({ projectId, taskId, type: "TASK_TRANSITION", payload: { from: task.status, to, reason } });
    return store.getTask(projectId, taskId)!;
  });
}

export function transitionMission(store: Store, projectId: string, missionId: string, to: MissionStatus, reason?: string): void {
  transaction(store.db, () => {
    const mission = store.getMission(projectId, missionId);
    if (!mission) throw new Error("依頼が見つかりません");
    if (mission.status === to) return;
    if (!canTransitionMission(mission.status, to)) throw new IllegalTransitionError("mission", mission.status, to);
    store.setMissionStatus(projectId, missionId, to);
    store.appendEvent({ projectId, type: "MISSION_STATUS_CHANGED", payload: { missionId, from: mission.status, to, reason } });
  });
}

/**
 * failed -> ready with retry_count + 1. Refuses once MAX_RETRIES is used up;
 * the DB CHECK (retry_count <= 5) is the second line of defence.
 */
export function retryTask(store: Store, projectId: string, taskId: string): Task {
  return transaction(store.db, () => {
    const task = store.getTask(projectId, taskId);
    if (!task) throw new Error("作業が見つかりません");
    if (task.status !== "failed") throw new IllegalTransitionError("task", task.status, "ready");
    if (task.retryCount >= MAX_RETRIES) throw new Error(`リトライ上限(${MAX_RETRIES}回)に達しています`);
    store.db.prepare("UPDATE tasks SET retry_count = retry_count + 1 WHERE id = ? AND project_id = ?").run(taskId, projectId);
    store.appendEvent({ projectId, taskId, type: "TASK_RETRY", payload: { attempt: task.retryCount + 1, max: MAX_RETRIES } });
    return transitionTask(store, projectId, taskId, "ready", "retry");
  });
}
