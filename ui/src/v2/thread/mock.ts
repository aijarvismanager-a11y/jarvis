import type { ThreadItem } from "./types";

/**
 * Realistic morning-brief conversation covering every ThreadItem kind.
 * Used in Phase 3A to drive the UI; replaced by real WS subscription in Phase 3B.
 */
export const MOCK_THREAD: ThreadItem[] = [
  {
    kind: "jarvis-speech",
    id: "s-001",
    text:
      "おはようございます、マーティン。夜間は静かでした — 重大なアラートはありません。10時のAnyaとの予定は確定済みで、午後は集中作業の時間を2時間確保しています。",
    t: "07:32",
    status: "done",
  },
  {
    kind: "user-voice",
    id: "u-001",
    text: "リサーチャーは夜間に何を終わらせた?",
    t: "07:34",
  },
  {
    kind: "jarvis-thought",
    id: "th-001",
    text: "リサーチャーの実行ログとauthority-patternsのブリーフを取得中。",
    t: "07:34",
  },
  {
    kind: "jarvis-speech",
    id: "s-002",
    text:
      "リサーチャーがauthority-patternsのブリーフを完成させました — 4ページ、23件のソース。要点: auto-learn付きのソフトゲート承認が現在の主流の実運用パターンで、厳格なRBACは使われなくなっています。",
    t: "07:35",
    status: "done",
  },
  {
    kind: "card",
    id: "c-001",
    objectType: "memory",
    ref: "mem_auth_patterns_2026",
    title: "Authority patterns 2026 — brief",
    summary:
      "4ページ · Researcher · ソースはAnthropic、Linear、Rampなど20件以上に及びます。主な発見: エージェント型システムではソフトゲート + auto-learnがRBACに取って代わっています。",
    meta: "4ページ · 23件のソース · 18分",
    t: "07:35",
  },
  {
    kind: "user-text",
    id: "u-002",
    text: "木曜2時にAnyaとのフォローアップをレビュー用に予定して。",
    t: "07:36",
  },
  {
    kind: "jarvis-thought",
    id: "th-002",
    text: "Anyaの空き状況とカレンダー書き込みの権限スコープを確認中。",
    t: "07:36",
  },
  {
    kind: "approval",
    id: "a-001",
    intent: "Scheduler を承認 · 木曜2時にAnyaと予約 — 確認が必要ですか?",
    category: "authority.approve",
    impact: "write",
    highlights: ["Scheduler", "book Thu 2pm"],
    t: "07:36",
  },
  {
    kind: "jarvis-speech",
    id: "s-003",
    text: "木曜2時はお二人とも空いているようです。招待を送りましょうか?",
    t: "07:36",
    status: "done",
  },
  {
    kind: "card",
    id: "c-002",
    objectType: "workflow",
    ref: "wf_morning_triage",
    title: "モーニングトリアージ",
    summary: "緊急メールを分類し、低リスクなスレッドには返信を下書きします。",
    meta: "v7 · 1,241回実行 · 平均1.1秒",
    status: { label: "実行中", tone: "ok" },
    t: "07:37",
  },
  {
    kind: "result",
    id: "r-001",
    summary: "モーニングトリアージ完了: 14件のスレッドを分類、3件の下書きをキューに追加。",
    detail:
      "3件の下書きが送信箱でレビュー待ちです。2件のスレッドが緊急としてフラグされています(Anya · OKR下書き)。",
    t: "07:38",
  },
  {
    kind: "card",
    id: "c-003",
    objectType: "agent",
    ref: "ag_researcher",
    title: "リサーチャー",
    summary: "現在「エージェント型authority patterns 2026」を深掘り中。",
    meta: "18分 · 23件のソースを精読",
    status: { label: "稼働中", tone: "ok" },
    t: "07:40",
  },
  {
    kind: "jarvis-speech",
    id: "s-004",
    text: "木曜の招待を下書き中です — 送信準備ができたら承認カードが表示されます。",
    t: "07:41",
    status: "speaking",
  },
];
