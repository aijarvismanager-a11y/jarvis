import type { TaskStatusCounts } from "../JarvisStateContext";
import type { ProjectTaskStatus } from "../../rooms/aiManager/useAIManagerData";

/**
 * Cinematic UI Task Flow stepper (spec §7-13's "Task Flow" alongside the
 * Core + Agent Orbit). Derived from the same real `taskCounts` snapshot
 * `coreStatus.ts` uses — no separate data source, no invented progress.
 *
 * Deliberately does NOT compute a single "current step" or per-task
 * done/pending checkmarks: the Manager Agent's wave scheduler
 * (src/ai-manager/manager-agent.ts) runs subtasks in parallel, so a project
 * can genuinely have tasks in PENDING, RUNNING, and QA at the same time.
 * Showing one artificial "current stage" would misrepresent that as a
 * strictly linear pipeline. Instead each step just shows its own real count
 * — true for any mix of parallel task states, per the spec's anti-dummy-data
 * rule the rest of this Cinematic-series work follows.
 */
export const TASK_FLOW_STEPS: ProjectTaskStatus[] = [
  "PENDING", "PLANNING", "READY", "RUNNING", "REVIEW", "QA", "COMPLETED",
];

// Not part of the linear happy path — pauses/failures that can interrupt
// any step above. Shown as separate exception badges instead of steps.
export const TASK_FLOW_EXCEPTIONS: ProjectTaskStatus[] = [
  "WAITING", "BLOCKED", "FAILED", "CANCELLED",
];

export const TASK_FLOW_STEP_LABELS: Record<ProjectTaskStatus, string> = {
  PENDING: "Pending",
  PLANNING: "Planning",
  READY: "Ready",
  RUNNING: "Running",
  WAITING: "Waiting",
  BLOCKED: "Blocked",
  REVIEW: "Review",
  QA: "QA",
  COMPLETED: "Completed",
  FAILED: "Failed",
  CANCELLED: "Cancelled",
};

export interface TaskFlowEntry {
  status: ProjectTaskStatus;
  count: number;
}

export function deriveTaskFlow(taskCounts: TaskStatusCounts): {
  steps: TaskFlowEntry[];
  exceptions: TaskFlowEntry[];
} {
  const steps = TASK_FLOW_STEPS.map((status) => ({ status, count: taskCounts[status] ?? 0 }));
  const exceptions = TASK_FLOW_EXCEPTIONS
    .map((status) => ({ status, count: taskCounts[status] ?? 0 }))
    .filter((entry) => entry.count > 0);
  return { steps, exceptions };
}
