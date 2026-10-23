import type { Mission, MissionStatus, Task, TaskStatus } from "./types";

export const MISSION_LABEL: Record<MissionStatus, string> = {
  draft: "準備中",
  planning: "計画の承認待ち",
  running: "進行中",
  paused: "一時停止中",
  completed: "完了",
  failed: "失敗",
  cancelled: "中止",
};

export const TASK_LABEL: Record<TaskStatus, string> = {
  pending: "待機",
  ready: "実行待ち",
  running: "実行中",
  waiting: "あなたの操作待ち",
  validation: "検証中",
  completed: "完了",
  failed: "失敗",
  blocked: "ブロック",
  cancelled: "中止",
  paused: "一時停止",
};

export const ROLE_LABEL: Record<string, string> = {
  requirements: "要件分析",
  research: "技術調査",
  design: "設計",
  ux_review: "UIレビュー",
  coding: "実装",
  implementation: "実装",
  testing: "テスト",
  review: "最終レビュー",
};
export const roleLabel = (role: string) => ROLE_LABEL[role] ?? role;

export const FREE_LABEL: Record<string, string> = { free: "無料", free_tier: "無料枠あり", trial: "試用のみ", paid: "有料", unknown: "未確認" };
export const LEVEL_LABEL: Record<number, string> = { 1: "手動", 2: "半自動", 3: "全自動" };

export const isActiveMission = (m: Mission) => ["draft", "planning", "running", "paused"].includes(m.status);

/** The mission the Mission screen is about: the newest unfinished one, else the newest overall. */
export function currentMission(missions: Mission[]): Mission | null {
  const sorted = [...missions].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return sorted.find(isActiveMission) ?? sorted[0] ?? null;
}

export function progressOf(tasks: Task[]): { done: number; total: number; percent: number } {
  const counted = tasks.filter((t) => t.status !== "cancelled");
  const done = counted.filter((t) => t.status === "completed").length;
  return { done, total: counted.length, percent: counted.length ? Math.round((done / counted.length) * 100) : 0 };
}

export const deriveProjectName = (goal: string) => {
  const t = goal.trim().replace(/\s+/g, " ");
  return t.length > 24 ? `${t.slice(0, 24)}…` : t || "新しいプロジェクト";
};

export const formatTime = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
};
