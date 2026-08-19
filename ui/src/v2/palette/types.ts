/**
 * Shape returned by `GET /api/palette/search`. Mirrors the daemon-side
 * `PaletteResult` in `src/daemon/api-routes.ts`. Designed to map directly
 * onto `<InlineCard>` props when the user picks an object result.
 */
export type PaletteResultType =
  | "workflow"
  | "memory"
  | "tool"
  | "agent"
  | "authority"
  | "log";

export type PaletteResult = {
  type: PaletteResultType;
  id: string;
  ref: string;
  title: string;
  summary?: string;
  meta?: string;
  status?: { label: string; tone: "ok" | "warn" | "neutral" | "accent" };
};

/**
 * Room navigation entries shown in the palette when the query is empty
 * or matches a Room name. Selecting one opens the Room (Phase 6 stub for
 * now). The `key` becomes the navigation route; the `label` matches the
 * Room build order from the roadmap.
 */
export type PaletteNavEntry = {
  key:
    | "tools"
    | "logs"
    | "agents"
    | "workflows"
    | "memory"
    | "authority"
    | "calendar"
    | "goals"
    | "tasks"
    | "content"
    | "workspaces"
    | "usage"
    | "settings";
  label: string;
  hint: string;
};

export const ROOM_NAV_ENTRIES: PaletteNavEntry[] = [
  { key: "workflows", label: "ワークフロー", hint: "保存済みのエージェントフローを実行・編集" },
  { key: "memory", label: "メモリ", hint: "Jarvisが知っていることを呼び出す" },
  { key: "agents", label: "エージェント", hint: "一覧、ステータス、最終実行" },
  { key: "authority", label: "権限", hint: "スコープ、許可リスト、承認" },
  { key: "tools", label: "ツール", hint: "カタログ + 機能フラグ" },
  { key: "logs", label: "ログ", hint: "フィルタ可能なイベントストリーム" },
  { key: "calendar", label: "カレンダー", hint: "今週の予定 + コミットメント" },
  { key: "goals", label: "目標", hint: "OKR階層 + スコアリング" },
  { key: "tasks", label: "タスク", hint: "かんばん + 期限 + 優先度" },
  { key: "content", label: "コンテンツ", hint: "下書き、予約済み、公開済み" },
  { key: "workspaces", label: "ワークスペース", hint: "開発プロジェクト、git、開発サーバー" },
  { key: "usage", label: "使用状況", hint: "LLMトークン使用量、ティア/モデル/タスク/日付で絞り込み可能" },
  { key: "settings", label: "設定", hint: "プロバイダー、音声、ショートカット" },
];

/**
 * Map a palette Room nav key to the `ObjectType` used by `<InlineCard>`.
 * 1:1 except `workflows` → `workflow`, `agents` → `agent`, `logs` → `log`.
 */
export function navKeyToObjectType(
  key: PaletteNavEntry["key"],
):
  | "workflow"
  | "memory"
  | "tool"
  | "agent"
  | "authority"
  | "log"
  | "calendar"
  | "goals"
  | "tasks"
  | "content"
  | "workspaces"
  | "usage"
  | "settings" {
  switch (key) {
    case "workflows":
      return "workflow";
    case "agents":
      return "agent";
    case "logs":
      return "log";
    case "tools":
      return "tool";
    default:
      return key;
  }
}
