import React from "react";
import type { TaskStatusCounts } from "../JarvisStateContext";
import { deriveTaskFlow, TASK_FLOW_STEP_LABELS } from "./taskFlow";
import "./TaskFlowStepper.css";

/**
 * Cinematic UI Task Flow (spec §7-13). Renders the pinned project's real
 * per-status task counts as a horizontal pipeline, plus exception badges
 * for WAITING/BLOCKED/FAILED/CANCELLED when any are present. See
 * taskFlow.ts's doc comment for why this shows per-step counts rather than
 * a single "current step" — tasks run in parallel waves, not one at a time.
 */
function TaskFlowStepperImpl({ taskCounts, totalTasks }: { taskCounts: TaskStatusCounts; totalTasks: number }) {
  if (totalTasks === 0) return null;

  const { steps, exceptions } = deriveTaskFlow(taskCounts);

  return (
    <div className="cin-flow" role="group" aria-label="タスクフロー">
      <ol className="cin-flow__steps">
        {steps.map((step) => (
          <li key={step.status} className="cin-flow__step" data-active={step.count > 0}>
            <span className="cin-flow__dot" aria-hidden="true" />
            <span className="cin-flow__label">{TASK_FLOW_STEP_LABELS[step.status]}</span>
            {step.count > 0 && <span className="cin-flow__count">{step.count}</span>}
          </li>
        ))}
      </ol>
      {exceptions.length > 0 && (
        <div className="cin-flow__exceptions">
          {exceptions.map((e) => (
            <span key={e.status} className="cin-flow__ex" data-status={e.status.toLowerCase()}>
              {TASK_FLOW_STEP_LABELS[e.status]} · {e.count}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// activeProjectDetail (the source of taskCounts) is a freshly-allocated
// object on every poll tick even when the counts themselves haven't
// changed, so memoize on the actual scalar values rather than object
// identity — otherwise this re-renders/recomputes every poll indefinitely
// while Cinematic mode is open.
export const TaskFlowStepper = React.memo(TaskFlowStepperImpl, (prev, next) => {
  if (prev.totalTasks !== next.totalTasks) return false;
  const keys = new Set([...Object.keys(prev.taskCounts), ...Object.keys(next.taskCounts)]);
  for (const k of keys) {
    const key = k as keyof TaskStatusCounts;
    if (prev.taskCounts[key] !== next.taskCounts[key]) return false;
  }
  return true;
});
