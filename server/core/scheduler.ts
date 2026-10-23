import type { Store, Task } from "./store.ts";

// Scheduler (spec §38): at most `maxParallel` tasks run at once, and of those
// at most one may edit code. The code write lock lives in the locks table
// (resource `code:<projectId>`) so a stale owner can be detected after a crash.

export const DEFAULT_MAX_PARALLEL = 2;
export const DEFAULT_LOCK_TTL_MS = 30 * 60_000;

/** Roles that modify the project's code (everything else is read/review/suggest only). */
const WRITE_ROLES = new Set(["coding", "code", "implement", "implementation", "refactor", "fix", "bugfix", "integration", "実装", "コーディング", "修正", "リファクタリング", "統合"]);

export function isWriteTask(task: Pick<Task, "role">): boolean {
  return WRITE_ROLES.has(task.role.trim().toLowerCase());
}

export const writeLockResource = (projectId: string) => `code:${projectId}`;
export const writeLockOwner = (taskId: string) => `task:${taskId}`;

export class Scheduler {
  readonly maxParallel: number;
  private readonly lockTtlMs: number;

  constructor(
    private readonly store: Store,
    opts: { maxParallel?: number; lockTtlMs?: number } = {},
  ) {
    this.maxParallel = Math.max(1, Math.floor(opts.maxParallel ?? DEFAULT_MAX_PARALLEL));
    this.lockTtlMs = opts.lockTtlMs ?? DEFAULT_LOCK_TTL_MS;
  }

  /**
   * Picks tasks to start now from `ready` (already in priority order).
   * `inFlight` counts every running task of this engine, across projects.
   * A chosen write task has already taken the project's write lock.
   */
  select(projectId: string, ready: Task[], inFlight: number): Task[] {
    const picked: Task[] = [];
    let slots = this.maxParallel - inFlight;
    for (const task of ready) {
      if (slots <= 0) break;
      if (isWriteTask(task)) {
        // Only one write task per project; acquireLock fails while another task owns it.
        if (!this.store.acquireLock({ resource: writeLockResource(projectId), projectId, owner: writeLockOwner(task.id), ttlMs: this.lockTtlMs })) continue;
        this.store.appendEvent({ projectId, taskId: task.id, type: "LOCK_ACQUIRED", payload: { resource: writeLockResource(projectId) } });
      }
      picked.push(task);
      slots--;
    }
    return picked;
  }

  release(projectId: string, task: Task): void {
    if (!isWriteTask(task)) return;
    if (this.store.releaseLock(writeLockResource(projectId), writeLockOwner(task.id))) {
      this.store.appendEvent({ projectId, taskId: task.id, type: "LOCK_RELEASED", payload: { resource: writeLockResource(projectId) } });
    }
  }
}
