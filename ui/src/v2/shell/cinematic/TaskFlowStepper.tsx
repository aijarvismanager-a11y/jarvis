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
export function TaskFlowStepper({ taskCounts, totalTasks }: { taskCounts: TaskStatusCounts; totalTasks: number }) {
  if (totalTasks === 0) return null;

  const { steps, exceptions } = deriveTaskFlow(taskCounts);

  return (
    <div className="cin-flow" role="group" aria-label="Task flow">
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
