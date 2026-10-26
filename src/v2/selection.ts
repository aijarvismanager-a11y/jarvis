import { aiNameOf } from "./context";
import type { AiService, StoredEvent } from "./types";

/** What the Broker looked for, in plain words (the registry's capability names). */
export const CAPABILITY_LABEL: Record<string, string> = {
  research: "調査",
  architecture: "設計",
  coding: "コードを書く",
  debugging: "不具合の調査・修正",
  testing: "テスト",
  ux_review: "レビュー(第二の目)",
  documentation: "文書づくり",
  translation: "翻訳",
  ideation: "アイデア出し",
  seo: "SEO",
  unclassified: "種類を決めにくい作業",
};

const CONFIDENCE_LABEL: Record<string, string> = { high: "高", medium: "中", low: "低" };

type Selected = {
  capability: string;
  confidence?: number;
  confidenceLabel?: string;
  needsReview?: boolean;
  selected: string | null;
  excluded?: { aiId: string; name: string; reason: string }[];
  chosen?: { name: string; score10: number; fit: number; quality: number; automation: number; safety: number } | null;
  ranked?: { aiId: string; name: string; score10: number }[];
  shared?: { aiId: string; name: string; mission: number; recent: number }[];
};

export type SelectionWhy = { headline: string; lines: string[] };

const short = (name: string) => name.replace(/\s*\((Web|CLI)\)\s*$/, "");

/** Why a task has the AI it has: one sentence, and the details behind it. Null when nothing was recorded (an AI chosen by hand, an older run). */
export function explainSelection(events: StoredEvent[], taskId: string, services: AiService[]): SelectionWhy | null {
  const own = events.filter((e) => e.taskId === taskId);
  const current = [...own].reverse().find((e) => e.type === "AI_SELECTED");
  if (!current) return null;
  const p = current.payload as Selected;
  const cap = CAPABILITY_LABEL[p.capability] ?? p.capability;
  const name = p.chosen?.name ?? aiNameOf(services, p.selected);
  const shared = p.shared ?? [];

  const headline =
    shared.length > 1
      ? `${short(name)}が担当: 「${cap}」に同じくらい向いているAIが${shared.length}つ(${shared.map((s) => short(s.name)).join("、")})あったので、この依頼での利用が少ない順に選びました`
      : `${short(name)}が担当: 「${cap}」に最も向いているAIです${p.chosen ? `(点数 ${p.chosen.score10}/10)` : ""}`;

  const lines: string[] = [`作業の種類: ${cap}`];
  if (p.ranked && p.ranked.length > 1) lines.push(`候補の点数(10点満点): ${p.ranked.map((c) => `${short(c.name)} ${c.score10}`).join(" ／ ")}。点数は初期の仮定値で、実際の成否に合わせて調整していきます`);
  if (shared.length > 1) lines.push(`利用の状況: ${shared.map((s) => `${short(s.name)}は、この依頼で${s.mission}回・直近24時間で${s.recent}回`).join(" ／ ")}`);
  if (p.chosen) lines.push(`${short(p.chosen.name)}の内訳(各5点満点): 得意分野 ${p.chosen.fit}・品質 ${p.chosen.quality}・自動で動かせる度合い ${p.chosen.automation}・安全性 ${p.chosen.safety}`);
  if (p.confidenceLabel) lines.push(`選んだ自信: ${CONFIDENCE_LABEL[p.confidenceLabel] ?? p.confidenceLabel}${p.needsReview ? "(点数のデータが少ないため、参考程度です)" : ""}`);
  const excluded = p.excluded ?? [];
  if (excluded.length > 0) lines.push(`使えなかったAI: ${excluded.slice(0, 3).map((x) => `${short(x.name)}(${x.reason})`).join("、")}${excluded.length > 3 ? ` ほか${excluded.length - 3}件` : ""}`);
  for (const e of own) {
    const q = e.payload as { from?: string; to?: string };
    if (e.type === "AI_FALLBACK" && q.from && q.to) lines.push(`切り替え: ${short(aiNameOf(services, q.from))}が失敗したため、${short(aiNameOf(services, q.to))}に切り替えました`);
    if (e.type === "AI_REASSIGNED" && q.from && q.to) lines.push(`切り替え: ${short(aiNameOf(services, q.from))}から${short(aiNameOf(services, q.to))}に変更されました`);
  }
  return { headline, lines };
}
