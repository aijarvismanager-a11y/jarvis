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
  architecture: "設計",
  ideation: "アイデア出し",
  image: "画像づくり",
  image_generation: "画像づくり",
  integration: "つなぎ合わせ",
  frontend: "画面の実装",
  backend: "裏側の実装",
  database: "データの設計・実装",
  fix: "不具合の修正",
  bugfix: "不具合の修正",
  debugging: "不具合の調査",
  translation: "翻訳",
  seo: "検索対策(SEO)",
  qa: "テスト",
  "final review": "最終レビュー",
  "ui design": "画面の設計",
};
export const roleLabel = (role: string) => ROLE_LABEL[role] ?? role;

/** "いま何が起きているか" in one phrase per task state, for the progress screen's summary line. */
export const TASK_LABEL_PLAIN: Record<TaskStatus, string> = { ...TASK_LABEL, pending: "順番待ち", ready: "まもなく開始", validation: "チェック中", blocked: "進めない(前の作業の失敗など)" };

export const RUN_STATUS_LABEL: Record<string, string> = { succeeded: "成功", completed: "成功", success: "成功", failed: "失敗", timed_out: "時間切れ", running: "実行中", cancelled: "中止" };

/** Plain-word names for the history log's event codes; unknown codes fall back to a neutral phrase instead of showing the code. */
export const EVENT_LABEL: Record<string, string> = {
  PROJECT_CREATED: "プロジェクトを作成",
  PROJECT_IMPORTED: "フォルダを取り込み",
  HISTORY_CARRIED: "Claude Code の会話履歴を要約して引き継いだ",
  AI_REVIEW_REQUESTED: "別のAIに追加レビューを依頼",
  AI_REVIEW_DONE: "別のAIの追加レビューが完了",
  AI_REVIEW_SKIPPED: "追加レビューは見送り",
  AI_REVIEW_SWITCHED: "追加レビューの使用を切替",
  HISTORY_CARRY_FAILED: "会話履歴の引き継ぎに失敗",
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
  SYNC_AUTO_PULLED: "元のフォルダの変更を自動で取り込んだ",
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

/** A short project name from the first request: its first phrase (up to the first 、。!?), at most 20 characters. */
/** A request's text as shown: requests carried over from the old app had a "(旧プロジェクトから移行)" marker added in front, which says nothing to the person. */
export const goalText = (goal: string) => {
  const rest = goal.replace(/^\s*\(旧プロジェクトから移行\)\s*/, "").trim();
  return rest === goal.trim() ? goal : `旧アプリから引き継いだプロジェクト「${rest}」`;
};

export const deriveProjectName = (goal: string) => {
  const t = goal.trim().replace(/\s+/g, " ");
  if (!t) return "新しいプロジェクト";
  const cut = t.search(/[、。!?！？,.]/);
  const phrase = (cut >= 4 ? t.slice(0, cut) : t).trim();
  return phrase.length > 20 ? `${phrase.slice(0, 20)}…` : phrase;
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

/** What an AI is for, from its capabilities: used to sort the AI list by purpose. */
export const AI_GROUPS = [
  { id: "chat", label: "調べもの・文章・なんでも相談" },
  { id: "dev", label: "コード・開発" },
  { id: "design", label: "画面デザイン" },
  { id: "image", label: "画像づくり" },
  { id: "video", label: "動画づくり" },
  { id: "music", label: "音楽づくり" },
  { id: "voice", label: "音声づくり" },
] as const;
export type AiGroupId = (typeof AI_GROUPS)[number]["id"];

export function aiGroupOf(s: { capabilities: string[]; accessMode: string }): AiGroupId {
  const caps = new Set(s.capabilities);
  const only = (...allowed: string[]) => caps.size > 0 && [...caps].every((c) => allowed.includes(c));
  if (only("image_generation")) return "image";
  if (only("video_generation")) return "video";
  if (only("music_generation")) return "music";
  if (only("voice_generation")) return "voice";
  if (s.accessMode === "cli") return "dev";
  if (caps.has("design") && only("design", "ux_review")) return "design";
  if (caps.has("coding") && only("coding", "debugging", "testing", "architecture", "ux_review")) return "dev";
  return "chat";
}

/** Plain-word version of the engine's English reason strings; unknown reasons are shown as recorded. */
const REASON_LABEL: Record<string, string> = {
  "fixed plan": "固定の計画で開始",
  "fixed plan started": "固定の計画で作業を開始",
  "planner requested": "AIに計画づくりを依頼",
  "replan": "計画のやり直しを依頼",
  "task retried by user": "作業のやり直しを依頼",
  "all tasks completed": "すべての作業が完了",
  "dependencies completed": "前の作業が完了",
  scheduled: "作業を開始",
  executed: "実行が終わり、検証へ",
  "write lock unavailable": "ほかの作業がこのフォルダを使用中でした",
  "no runnable tasks (retries exhausted or blocked)": "再試行しても進められない作業があり、止まりました",
};

/** The cause, when the reason's own words give it away: what to do differs a lot (wait, sign in, shorten the request). */
function causeHint(reason: string): string | null {
  if (/利用上限|上限に達|rate limit|usage limit|quota|overloaded|429/i.test(reason)) return "Claude の利用上限が原因のようです。画面の上の赤い枠で「リセットまで待つ」か「ほかのAIに回す」を選んでから、「やり直す」を押してください。";
  if (/ログイン|not logged in|authentication|unauthorized|401/i.test(reason)) return "Claude Code のログインが切れているようです。「使うAI」タブで状態を確認し、ターミナルで claude と入力してログインし直してから、「やり直す」を押してください。";
  if (/タイムアウト|timed? ?out/i.test(reason)) return "時間がかかりすぎて止まりました。依頼を小さく分けて(例: 画面ごとに)出し直すと、うまくいきやすくなります。";
  if (/見つかりません|not recognized|enoent/i.test(reason)) return "Claude Code が見つかりません。インストールされているか、ホームの「準備」の表示を確認してください。";
  return null;
}

/** One failed mission in plain words: what went wrong and what to do about it. */
export function explainFailure(reason: string | null): { what: string; hint: string } {
  const cause = reason ? causeHint(reason) : null;
  const planner = reason?.match(/^(?:planner|replan) error:\s*(.*)$/s);
  if (planner) {
    const detail = planner[1].trim();
    const crashed = /異常終了|code=\d+/.test(detail);
    return {
      what: `計画を立てる段階で失敗しました${detail ? `(${detail.replace(/[::\s]+$/, "")})` : ""}`,
      hint: cause ?? (crashed
        ? "Claude Code が途中で止まりました。Claude Code にログインできているか・利用上限に達していないかを確認してから、「計画をやり直す」を押してください。"
        : "少し待ってから「計画をやり直す」を押してください。何度も失敗するときは、依頼の書き方を具体的にしてみてください。"),
    };
  }
  if (reason && REASON_LABEL[reason]) return { what: REASON_LABEL[reason], hint: "「計画をやり直す」か、失敗した作業の「この作業をやり直す」を押してください。" };
  if (reason) return { what: reason, hint: cause ?? "「計画をやり直す」か、失敗した作業の「この作業をやり直す」を押してください。" };
  return { what: "理由の記録が見つかりませんでした", hint: "「計画をやり直す」を押すか、「新しい依頼」を出してください。" };
}

/** The recorded reason of the newest transition of a mission into "failed". */
export function missionFailureReason(events: { type: string; payload: unknown }[], missionId: string): string | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    const p = e.payload as { missionId?: string; to?: string; reason?: string } | null;
    if (e.type === "MISSION_STATUS_CHANGED" && p?.missionId === missionId && p.to === "failed") return p.reason ?? null;
  }
  return null;
}

/** Events in a mission/task transition, spelled out ("進行中 → 失敗 — 理由"); other events keep their plain label. */
export function describeEvent(e: { type: string; payload: unknown }): string {
  const p = e.payload as { from?: string; to?: string; reason?: string } | null;
  if ((e.type === "MISSION_STATUS_CHANGED" || e.type === "TASK_TRANSITION") && p?.to) {
    const labels = (e.type === "MISSION_STATUS_CHANGED" ? MISSION_LABEL : TASK_LABEL) as Record<string, string>;
    const head = e.type === "MISSION_STATUS_CHANGED" ? "依頼" : "作業";
    const why = p.reason ? ` — ${explainFailure(p.reason).what}` : "";
    return `${head}: ${p.from ? `${labels[p.from] ?? p.from} → ` : ""}${labels[p.to] ?? p.to}${why}`;
  }
  return eventLabel(e.type);
}

/** "あと2時間15分でリセット" from a reset time (empty when it has passed or is unknown). */
export const resetIn = (iso: string | null, now = Date.now()) => {
  if (!iso) return "";
  const ms = new Date(iso).getTime() - now;
  if (!Number.isFinite(ms) || ms <= 0) return "";
  const min = Math.ceil(ms / 60_000);
  return min < 60 ? `あと${min}分でリセット` : min < 24 * 60 ? `あと${Math.floor(min / 60)}時間${min % 60}分でリセット` : `あと${Math.floor(min / 1440)}日${Math.floor((min % 1440) / 60)}時間でリセット`;
};
