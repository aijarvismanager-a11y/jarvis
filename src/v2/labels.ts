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
  visual_design: "見た目のデザイン",
  "visual design": "見た目のデザイン",
  illustration: "絵・イラスト",
  video: "動画づくり",
  music: "音楽づくり",
  voice: "音声づくり",
};
export const roleLabel = (role: string) => ROLE_LABEL[role] ?? role;

/** "いま何が起きているか" in one phrase per task state, for the progress screen's summary line. */
export const TASK_LABEL_PLAIN: Record<TaskStatus, string> = { ...TASK_LABEL, pending: "順番待ち", ready: "まもなく開始", validation: "チェック中", blocked: "進めない(前の作業の失敗など)" };

export const RUN_STATUS_LABEL: Record<string, string> = { succeeded: "成功", completed: "成功", success: "成功", failed: "失敗", timed_out: "時間切れ", running: "実行中", cancelled: "中止" };

/** Plain-word names for the history log's event codes; unknown codes fall back to a neutral phrase instead of showing the code. */
export const EVENT_LABEL: Record<string, string> = {
  CLAUDE_MD_ARCHIVED: "CLAUDE.md が長くなったため、古い作業履歴を別の場所に移しました(消していません)",
  HUMAN_TODO_DONE: "「あなたがやること」を済ませました",
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
  WATCHDOG_APPROVAL_WAITING: "あなたの許可を待っています(見張り役の知らせ)",
  WATCHDOG_NO_PROGRESS: "動いている作業が無いまま止まっています(見張り役の知らせ)",
  WATCHDOG_STOPPED_TASK: "進みのない作業を中断(見張り役。自動でやり直します)",
  WATCHDOG_RESTARTED: "止まっていた依頼をもう一度動かした(見張り役)",
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
  SYNC_AUTO_APPLIED: "依頼の結果を、元のフォルダへ自動で反映した",
  SYNC_AUTO_SKIPPED: "自動の反映は見送った(理由は詳細に)",
  VERIFY_APPROVED: "反映後の確認の手順を承認した",
  VERIFY_PASSED: "反映後の自動確認が通った",
  VERIFY_FAILED: "反映後の自動確認が失敗した",
  SYNC_AUTO_ON: "自動の反映をオンにした",
  SYNC_AUTO_OFF: "自動の反映をオフにした",
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

/**
 * A short, readable title for a task whose objective is a long technical instruction ("capture.ps1 -Action Start で 1000x600 に起動し、…"):
 * known kinds get a plain name; otherwise the first phrase with command lines and file names taken off the front, at most 28 characters.
 * The full text stays available behind "全文を見る".
 */
export const taskTitle = (objective: string): string => {
  const t = objective.replace(/\s+/g, " ").trim();
  const known: [RegExp, string][] = [
    [/SHA256|Get-FileHash|ハッシュ/i, "設定ファイルの控えを取る"],
    [/-Action\s+Stop|Stop と .*Status|復元.*確認/i, "終了と設定の復元を確かめる"],
    [/-Action\s+Start|アプリを起動|に起動し|起動して/i, "アプリを起動して画面を撮る"],
    [/dotnet\s+build|npm\s+(run\s+)?build|ビルド/i, "ビルドとテストを動かす"],
    [/既存の記録|CLAUDE\.md|作業履歴|へ追記|に追記/i, "記録に結果を書き足す"],
    [/動画モード|sample\.mp4/i, "動画モードを確かめる"],
  ];
  for (const [re, title] of known) if (re.test(t)) return title;
  // command / file names at the front ("capture.ps1 の使い方", "tools/ui-probe(…)") are noise in a heading
  const cleaned = t.replace(/^(?:[\w./\\:%-]+\.(?:ps1|mjs|ts|md|json|cs|csproj|sln)|tools\/[\w./-]+)\s*(?:の|で|を)?\s*/i, "");
  const cut = cleaned.search(/[。、:：(（]/);
  const head = cut > 1 ? cleaned.slice(0, cut) : cleaned;
  return head.length > 28 ? `${head.slice(0, 28)}…` : head;
};

/** Tool error text written for developers, in plain Japanese (the log shows what the AI's tool said as it is). */
export const plainLogText = (text: string): string =>
  /Permission for this tool use was denied|requires approval|no approval surface/i.test(text)
    ? "承認が必要な操作のため、いったん止まりました(この後、許可を求める画面が出ます)"
    : text;

const SHORT_GOAL_AT = 56;
/** A long request as a one-line heading: its first sentence (or the first part), the rest is for "全文を見る". */
export const shortGoal = (goal: string): { head: string; long: boolean } => {
  const t = goalText(goal).replace(/\s+/g, " ").trim();
  // 「答えをもとに新しい依頼を書く」で作った依頼は、先頭が毎回同じ定型文なので、見出しには中身(最初の答え)を出す
  const follow = /^これまでの回答について、次の確認への答えを反映して、やり直し・修正してください:\s*質問:.*?答え:\s*(.+?)(?=\s質問:|\s*【これまでの回答|$)/.exec(t);
  if (follow?.[1]) {
    const a = follow[1].trim();
    return { head: `前回の回答への続き: ${a.length > 60 ? `${a.slice(0, 60)}…` : a}`, long: true };
  }
  if (t.length <= SHORT_GOAL_AT) return { head: t, long: false };
  const cut = t.search(/[。!?！？]/);
  if (cut > 8 && cut < SHORT_GOAL_AT) return { head: t.slice(0, cut + 1), long: true };
  // no sentence end in sight: stop at the last comma before the limit, so the heading does not end mid-phrase
  const comma = t.slice(0, SHORT_GOAL_AT).lastIndexOf("、");
  return { head: comma >= 24 ? `${t.slice(0, comma)}…` : `${t.slice(0, SHORT_GOAL_AT)}…`, long: true };
};

/**
 * 続きの依頼に付ける「これまでの回答(要点)」。先頭の1件だけで字数を使い切って後ろの作業が丸ごと消えたり、
 * 文の途中で切れたりしないよう、作業ごとに同じ字数ずつ割り振り、句点・改行のところで切る。
 */
export function condenseAnswers(combined: string, limit: number): string {
  if (combined.length <= limit) return combined;
  const parts = combined.split(/\n\n(?=【作業\d+:)/);
  const per = Math.floor(limit / parts.length);
  return parts.map((p) => {
    if (p.length <= per) return p;
    const head = p.slice(0, per);
    const at = Math.max(head.lastIndexOf("。"), head.lastIndexOf("\n"));
    return `${at > per * 0.5 ? head.slice(0, at + 1) : head}…(以下略)`;
  }).join("\n\n");
}

export const deriveProjectName =(goal: string) => {
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

/** A task's failure note that says the person did not allow it (they pressed "拒否する"): nothing went wrong, so it is not advice-for-a-failure. */
export const isRefusedNote = (note: string | undefined | null) => /承認されなかった|許可されなかった/.test(note ?? "");

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
    // the plan wanted the AI to widen its own permissions: a person's decision, so say so in plain words (no internal names)
    if (/AI自身の許可設定/.test(detail)) {
      return {
        what: "計画を立て直しましたが、AIが「自分の許可設定を書き換える作業」を入れたため使えませんでした",
        hint: "この作業は、AIに任せず人が決めることです。もう一度「計画をやり直す」を押してください(作業を除いて作り直します)。続くときは、依頼から「許可を直す」内容を外して出し直してください。",
      };
    }
    return {
      what: `計画を立てる段階で失敗しました${detail ? `(${detail.replace(/[::\s]+$/, "")})` : ""}`,
      hint: cause ?? (crashed
        ? "Claude Code が途中で止まりました。Claude Code にログインできているか・利用上限に達していないかを確認してから、「計画をやり直す」を押してください。"
        : "少し待ってから「計画をやり直す」を押してください。何度も失敗するときは、依頼の書き方を具体的にしてみてください。"),
    };
  }
  // a web AI that could not be driven automatically: the engine hands the task to another AI by itself, so there is nothing to redo
  const web = reason?.match(/^(.+?)を自動で操作できませんでした((.*))。ほかのAIに回します/s);
  if (web) {
    const ai = web[1];
    const why = web[2];
    const plain = /手動の設定/.test(why)
      ? `${ai}は、自動で動かさない設定(手動)になっています`
      : /入力欄が見つかりません/.test(why)
        ? `${ai}の画面に、文章を入れる欄が見つかりませんでした(サイトの画面が変わったか、ログインが切れている可能性があります)`
        : /ログイン/.test(why)
          ? `${ai}にログインできていません`
          : /人間確認|ロボット|bot/i.test(why)
            ? `${ai}が「人間かどうかの確認」を出しています`
            : /上限/.test(why)
              ? `${ai}の利用上限に達しています`
              : why;
    return {
      what: `${ai}は、今回は使えませんでした。理由: ${plain}`,
      hint: "あなたがやることはありません。この作業は、アプリが自動で別のAIに回します(「やり直す」も、指示の追加も要りません)。" +
        (/手動の設定/.test(why) ? "このAIを自動で使いたいときだけ、「使うAI」で自動操作を入れてください。" : /入力欄|ログイン|人間確認|ロボット|bot/i.test(why) ? "このAIを使いたいときは、「使うAI」の「試してみる」で、状態を確かめてください。" : ""),
    };
  }
  if (reason && REASON_LABEL[reason]) return { what: REASON_LABEL[reason], hint: "いちばん上の「次にやること」に出ているボタンを押してください(どちらを押すかは、そこに書いてあります)。" };
  if (reason) return { what: reason, hint: cause ?? "いちばん上の「次にやること」に出ているボタンを押してください(どちらを押すかは、そこに書いてあります)。" };
  return { what: "理由の記録が見つかりませんでした", hint: "いちばん上の「次にやること」のボタンを押してください。それでも進まないときは、「新しい依頼」を出してください。" };
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
