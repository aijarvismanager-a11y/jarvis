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
  test: "テスト",
  review: "最終レビュー",
  analysis: "現状分析",
  document: "ドキュメント作成",
  documentation: "ドキュメント作成",
  debug: "不具合の調査",
  refactor: "コードの整理",
  deploy: "公開の準備",
  security: "安全性の確認",
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

/** "3分12秒" style elapsed time since an ISO timestamp. */
export const elapsedSince = (iso: string, now = Date.now()) => {
  const sec = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  return sec < 60 ? `${sec}秒` : sec < 3600 ? `${Math.floor(sec / 60)}分${sec % 60}秒` : `${Math.floor(sec / 3600)}時間${Math.floor((sec % 3600) / 60)}分`;
};

export const formatTime = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
};

export const formatDuration = (ms: number) => {
  const sec = Math.round(ms / 1000);
  return sec < 60 ? `${sec}秒` : sec < 3600 ? `${Math.floor(sec / 60)}分${sec % 60}秒` : `${Math.floor(sec / 3600)}時間${Math.floor((sec % 3600) / 60)}分`;
};
export const formatCost = (usd: number) => `$${usd < 0.01 ? usd.toFixed(4) : usd.toFixed(2)}`;
export const formatTokens = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));

export type Usage = { runs: number; failedRuns: number; durationMs: number; costUsd: number; hasCost: boolean; inputTokens: number; outputTokens: number };
/** Totals over the AI runs of the given tasks (all runs, including failed attempts: they cost time and money too). */
export function summarizeUsage(runs: { task_id: string | null; status: string; duration_ms: number | null; cost_usd: number | null; input_tokens: number | null; output_tokens: number | null }[], taskIds: Set<string>): Usage {
  const u: Usage = { runs: 0, failedRuns: 0, durationMs: 0, costUsd: 0, hasCost: false, inputTokens: 0, outputTokens: 0 };
  for (const r of runs) {
    if (!r.task_id || !taskIds.has(r.task_id)) continue;
    u.runs++;
    if (r.status === "failed" || r.status === "timed_out") u.failedRuns++;
    u.durationMs += r.duration_ms ?? 0;
    if (r.cost_usd != null) { u.costUsd += r.cost_usd; u.hasCost = true; }
    u.inputTokens += r.input_tokens ?? 0;
    u.outputTokens += r.output_tokens ?? 0;
  }
  return u;
}
