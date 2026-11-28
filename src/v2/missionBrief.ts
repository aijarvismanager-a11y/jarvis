import type { Mission, Task } from "./types";

/** Where a request came from: typed by the person, or made by the app as the "next step" of an earlier one. */
export type MissionOrigin = { from: string; depth: number } | null;

export type MissionBrief = {
  /** one sentence: what this request is for */
  purpose: string;
  /** "終わりの目安" of the request, when it says one */
  finish: string | null;
  /** who started it */
  origin: string;
  /** what the person should look at before deciding to keep or stop it (empty = nothing special) */
  notes: string[];
};

const FILE_RE = /[\w.\-/\\]+\.(?:md|ps1|json|ts|tsx|js|cs|py|html|css|txt|svg)\b/gi;

/** The line over a request in the conversation. Until the origins are read it claims neither. */
export function requesterLabel(origins: Record<string, { from: string; depth: number }> | null, missionId: string): string {
  if (!origins) return "依頼";
  return origins[missionId] ? "アプリが自動で作った続きの依頼" : "あなたの依頼";
}

/** File names a request talks about (just the last part, so "docs/a.md" and "a.md" count as the same file). */
export function filesOf(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.match(FILE_RE) ?? []) out.add(m.split(/[\\/]/).pop()!.toLowerCase());
  return [...out];
}

/** The first sentence of the request, without the lead-in "プロジェクト名 で、". */
export function purposeOf(goal: string): string {
  const flat = goal.replace(/\s+/g, " ").trim();
  const first = flat.split(/[。\n]/)[0] ?? flat;
  const body = first.replace(/^[^、]{1,30}で、/, "");
  const text = body.length > 0 ? body : first;
  return text.length > 110 ? `${text.slice(0, 108)}…` : text;
}

export function finishOf(goal: string): string | null {
  const m = goal.match(/終わりの目安[:：]\s*([^。\n]+)/);
  if (!m) return null;
  const t = m[1].trim();
  return t.length > 110 ? `${t.slice(0, 108)}…` : t;
}

/**
 * A plain-language card for one request: what it is for, who started it, and the signs that it may not be needed.
 * Built only from the request's own text and the project's history (no AI call), so it can be shown for every request.
 */
export function missionBrief(mission: Mission, all: Mission[], origins: Record<string, { from: string; depth: number }> | null, tasks: Task[] = []): MissionBrief {
  const origin = origins?.[mission.id] ?? null;
  const notes: string[] = [];
  const files = filesOf(mission.goal);
  const sameFile = files.length > 0 ? all.filter((o) => o.id !== mission.id && o.createdAt <= mission.createdAt && filesOf(o.goal).some((f) => files.includes(f))) : [];
  if (sameFile.length >= 2) {
    const first = sameFile.map((o) => o.createdAt).sort()[0];
    const days = Math.max(1, Math.round((Date.parse(mission.createdAt) - Date.parse(first)) / 86_400_000));
    notes.push(`同じファイルを扱う依頼は、これで${sameFile.length + 1}件目です(${days}日間)。細かい直しが続いているだけなら、止めて構いません。`);
  }
  if (origin) notes.push(`前の依頼の続きとして、アプリが自動で作りました(${origin.depth}回目の続き)。必要なければ却下してください。`);
  if (/人が|ユーザーが|手動で/.test(mission.goal)) notes.push("人の操作や、人が貼る値に頼る依頼です。値がまだ無いと、AIは「未判定」と書いて終わり、整理の依頼が続きやすくなります。");
  if (/(そろえ|揃え|統一|文言|書き直|整え|表記)/.test(purposeOf(mission.goal)) && !/(実行|テスト|ビルド|確認して|撮影|起動)/.test(purposeOf(mission.goal))) notes.push("記録の文章を整える依頼です。実際の動作の確認や修正は含まれません。");
  void tasks;
  return {
    purpose: purposeOf(mission.goal),
    finish: finishOf(mission.goal),
    // not read yet: saying "typed by the person" then would be a guess (it showed for a moment on requests the app had made)
    origin: !origins ? "確認しています…" : origin ? "アプリが自動で作った続き" : "自動の続きではない依頼(画面から出された依頼)",
    notes,
  };
}
