import type { ProjectTask, ProjectTaskStatus } from "../../rooms/aiManager/useAIManagerData";

/**
 * Cinematic UI Phase 35 — Focus Mode's "which task should be shown first"
 * ranking. Adapted from `coreStatus.ts`'s `deriveCoreStatus()` priority
 * order (Phase 31) — that function ranks an aggregate project status from
 * task-status *counts*; this is the per-task version of the same idea
 * (most-actionable-to-a-human first, not pipeline order), used to pick one
 * task out of `activeProjectDetail.tasks` rather than to summarize all of
 * them into one Core state.
 */
const URGENCY_RANK: Record<ProjectTaskStatus, number> = {
  FAILED: 0,
  BLOCKED: 1,
  WAITING: 2,
  QA: 3,
  REVIEW: 3,
  RUNNING: 4,
  PLANNING: 5,
  PENDING: 6,
  READY: 6,
  COMPLETED: 7,
  CANCELLED: 7,
};

/** Lower is more urgent. Unknown/null status ranks alongside PENDING/READY. */
export function taskUrgencyRank(status: ProjectTaskStatus | null): number {
  return status ? URGENCY_RANK[status] : 6;
}

/** The most urgent task in a project's task list, or null if there are none. */
export function pickDefaultFocusTask(tasks: ProjectTask[]): ProjectTask | null {
  let best: ProjectTask | null = null;
  let bestRank = Infinity;
  for (const t of tasks) {
    const rank = taskUrgencyRank(t.project_status);
    if (rank < bestRank) {
      bestRank = rank;
      best = t;
    }
  }
  return best;
}
