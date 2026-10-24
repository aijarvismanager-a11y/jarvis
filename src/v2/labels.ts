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

/** "いま何が起きているか" in one phrase per task state, for the progress screen's summary line. */
export const TASK_LABEL_PLAIN: Record<TaskStatus, string> = { ...TASK_LABEL, pending: "順番待ち", ready: "まもなく開始", validation: "チェック中", blocked: "進めない(前の作業の失敗など)" };

export const RUN_STATUS_LABEL: Record<string, string> = { succeeded: "成功", completed: "成功", success: "成功", failed: "失敗", timed_out: "時間切れ", running: "実行中", cancelled: "中止" };

/** Plain-word names for the history log's event codes; unknown codes fall back to a neutral phrase instead of showing the code. */
export const EVENT_LABEL: Record<string, string> = {
  PROJECT_CREATED: "プロジェクトを作成",
  PROJECT_IMPORTED: "フォルダを取り込み",
  LEGACY_PROJECT_IMPORTED: "旧アプリのプロジェクトを取り込み",
  MISSION_CREATED: "依頼を受付",
  MISSION_STATUS_CHANGED: "依頼の状態が変化",
  MISSION_REDIRECTED: "方針を変更",
  PLAN_PROPOSED: "AIが計画を提案",
  PLAN_APPROVED: "計画を承認",
  PLAN_REJECTED: "計画の修正を依頼",
  TASK_CREATED: "作業を追加",
  TASK_STATUS_CHANGED: "作業の状態が変化",
  TASK_TRANSITION: "作業の状態が変化",
  TASK_RETRY: "作業を自動で再試行",
  TASK_MANUAL_RETRY: "作業をやり直し",
  TASK_ROLLBACK: "作業の変更を元に戻した",
  TASK_SNAPSHOT: "変更前の状態を保存",
  ARTIFACT_CREATED: "ファイルが完成",
  APPROVAL_REQUESTED: "許可を求めた",
  APPROVAL_DENIED: "許可しなかった",
  AI_SELECTED: "担当のAIを決定",
  AI_REASSIGNED: "担当のAIを変更",
  AI_FALLBACK: "別のAIに切り替え",
  AI_SELECTION_NONE: "使えるAIが見つからない",
  AI_SELECTION_ERROR: "AIの選択でエラー",
  AI_HEALTH_CHECKED: "AIの動作確認",
  AI_DISCOVERY_RUN: "使えるAIを探索",
  AUTOMATION_LEVEL_SET: "自動化レベルを設定",
  AUTOMATION_DOWNGRADED: "自動化レベルを下げた",
  WEB_HANDOFF_REQUESTED: "ブラウザAIへ依頼(あなたの操作待ち)",
  WEB_HANDOFF_SUBMITTED: "ブラウザAIの返事を受取",
  WEB_AI_SWITCHED: "ブラウザAIの利用を切替",
  WEB_AI_FALLBACK: "ブラウザAIから切り替え",
  WEB_AI_AUTOMATION_FAILED: "ブラウザAIの自動操作に失敗",
  SYNC_RESTORED: "同期の内容を元に戻した",
  LOCK_ACQUIRED: "作業の排他を確保",
  LOCK_RELEASED: "作業の排他を解放",
  ENGINE_ERROR: "内部エラー",
};
export const eventLabel = (type: string) => EVENT_LABEL[type] ?? "その他の出来事";

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
