import type { Store, Task } from "./store.ts";

// Scheduler (spec §38): at most `maxParallel` tasks run at once, and of those
// at most one may edit code. The code write lock lives in the locks table
// (resource `code:<projectId>`) so a stale owner can be detected after a crash.

export const DEFAULT_MAX_PARALLEL = 2;
export const DEFAULT_LOCK_TTL_MS = 30 * 60_000;

/** Roles that modify the project's code (everything else is read/review/suggest only). */
// "analysis" (reading an imported project) is listed so it runs only on Claude Code, which can read the folder; a web AI cannot.
const WRITE_ROLES = new Set(["coding", "code", "implement", "implementation", "refactor", "fix", "bugfix", "integration", "analysis", "実装", "コーディング", "修正", "リファクタリング", "統合"]);

export function isWriteTask(task: Pick<Task, "role">): boolean {
  return WRITE_ROLES.has(task.role.trim().toLowerCase());
}

/** A test-role task whose wording says to RUN a build or tests (dotnet build, npm test, ...). It edits nothing, but it needs the shell, so it must go to the code executor and get the build/test commands allowed (a web AI cannot run anything; a headless run refuses unlisted commands). */
export function runsBuildOrTests(task: Pick<Task, "role"> & Partial<Pick<Task, "objective">>): boolean {
  return /^(test|tests|testing|tester|qa|テスト|検証)$/i.test(task.role.trim()) && /dotnet\s+(build|test)|npm\s+(run\s+)?(build|test)|cargo\s+(build|test)|go\s+(build|test)|pytest|ビルド|テストを実行|実行し/i.test(task.objective ?? "");
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
