import type { TaskStatusCounts } from "../JarvisStateContext";

/**
 * Cinematic UI Phase 31 — the Central Core's state (spec §8, §36-38: "Core
 * state reflects real system state"). The spec's Core enum
 * (IDLE/ANALYZING/PLANNING/EXECUTING/WAITING/VERIFYING/BLOCKED/ERROR) has no
 * 1:1 backend field — it's derived from the pinned project's real task-status
 * counts (`ProjectTaskStatus`, the existing 11-state enum in
 * `useAIManagerData.ts`, surfaced via `JarvisStateContext.activeProjectDetail`
 * from Phase 29), not new state, per the spec's anti-dummy-data rule.
 *
 * Priority order below (first match wins) reflects what a human glancing at
 * the Core would want to know first — a failure or a block on a project
 * outranks "still running fine" — not the order tasks pass through the
 * pipeline.
 */
export type CoreStatus =
  | "IDLE"
  | "ANALYZING"
  | "PLANNING"
  | "EXECUTING"
  | "WAITING"
  | "VERIFYING"
  | "BLOCKED"
  | "ERROR";

export interface CoreStatusInput {
  hasActiveProject: boolean;
  totalTasks: number;
  taskCounts: TaskStatusCounts;
}

export const CORE_STATUS_LABEL: Record<CoreStatus, string> = {
  IDLE: "待機中",
  ANALYZING: "分析中",
  PLANNING: "計画中",
  EXECUTING: "実行中",
  WAITING: "承認待ち",
  VERIFYING: "検証中",
  BLOCKED: "ブロック中",
  ERROR: "エラー",
};

export function deriveCoreStatus({ hasActiveProject, totalTasks, taskCounts }: CoreStatusInput): CoreStatus {
  if (!hasActiveProject || totalTasks === 0) return "IDLE";
  if ((taskCounts.FAILED ?? 0) > 0) return "ERROR";
  if ((taskCounts.BLOCKED ?? 0) > 0) return "BLOCKED";
  if ((taskCounts.WAITING ?? 0) > 0) return "WAITING";
  if ((taskCounts.QA ?? 0) > 0 || (taskCounts.REVIEW ?? 0) > 0) return "VERIFYING";
  if ((taskCounts.RUNNING ?? 0) > 0) return "EXECUTING";
  if ((taskCounts.PLANNING ?? 0) > 0) return "PLANNING";
  if ((taskCounts.PENDING ?? 0) > 0 || (taskCounts.READY ?? 0) > 0) return "ANALYZING";
  // Only COMPLETED/CANCELLED tasks remain — nothing left to do.
  return "IDLE";
}
