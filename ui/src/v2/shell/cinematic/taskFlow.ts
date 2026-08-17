import type { TaskStatusCounts } from "../JarvisStateContext";
import type { ProjectTaskStatus } from "../../rooms/aiManager/useAIManagerData";
import { TASK_COLUMNS } from "../../rooms/aiManager/AIManagerRoom";

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

// Not part of the linear happy path — pauses/failures that can interrupt
// any step above. Shown as separate exception badges instead of steps.
const TASK_FLOW_EXCEPTION_SET = new Set<ProjectTaskStatus>([
  "WAITING", "BLOCKED", "FAILED", "CANCELLED",
]);

// Derived from the AI Manager Kanban's canonical status order (TASK_COLUMNS)
// instead of a second hand-maintained list, so a status added there can't
// silently be missing from the stepper.
export const TASK_FLOW_STEPS: ProjectTaskStatus[] = TASK_COLUMNS.filter(
  (status) => !TASK_FLOW_EXCEPTION_SET.has(status),
);
export const TASK_FLOW_EXCEPTIONS: ProjectTaskStatus[] = TASK_COLUMNS.filter(
  (status) => TASK_FLOW_EXCEPTION_SET.has(status),
);

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

// Exhaustiveness guard: TASK_FLOW_STEP_LABELS is a Record<ProjectTaskStatus,
// string>, so it's a compile-time-checked complete list of every status.
// TASK_COLUMNS/TASK_FLOW_EXCEPTION_SET are plain arrays/sets and aren't — if
// a new ProjectTaskStatus is added to the type (and to the labels record
// above, or that line fails to compile) without also updating TASK_COLUMNS,
// this catches the drift immediately instead of letting the status silently
// vanish from the stepper.
if (TASK_FLOW_STEPS.length + TASK_FLOW_EXCEPTIONS.length !== Object.keys(TASK_FLOW_STEP_LABELS).length) {
  throw new Error(
    "taskFlow: TASK_COLUMNS is out of sync with ProjectTaskStatus — a status is missing from the Task Flow stepper.",
  );
}

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
