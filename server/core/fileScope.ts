import type { PlanDraft } from "./taskGraph.ts";

// "ほかのファイルは変えないでください": the request fixes which files may change. The app used to add its own record task anyway
// (CHANGELOG changed) and plans kept their record files under _ai-records/, so the request's own words were not kept.

// Only wording about FILES counts. "それ以外の動作は変えない" is about behaviour, and "ほかのファイルは大きく変えない" allows changes.
const KEEP = "(?:一切|いっさい|何も|絶対に|決して|\\s)*(?:(?:変え|変更し|触ら|さわら|いじら|書き換え|編集し|修正し|作ら|作成し)(?:ない|ず)|変更せず|編集せず|修正せず)";
const OTHERS_STAY = new RegExp(
  [
    `(?:ほか|他|その他|それ以外)の?(?:の)?ファイル(?:は|には|も|を|に)?、?${KEEP}`,
    // "README.md 以外は変更しない" / "README.md 以外のファイルは触らない"
    `(?:\\.[A-Za-z0-9]{1,6}|ファイル)\\s*[」』)）]?\\s*以外(?:の(?:ファイル|もの))?(?:は|には|も|を|に)?、?${KEEP}`,
  ].join("|"),
);

export function keepsOtherFiles(texts: (string | undefined)[]): boolean {
  return texts.some((t) => !!t && OTHERS_STAY.test(t));
}

export const NO_RECORDS_RULE = "依頼で「ほかのファイルは変えない」と指定されている: 記録のファイル(_ai-records、CHANGELOG など)を作らず、書き換えない。結果は答えに書く";
export const NO_RECORDS_NOTE = "ほかのファイルを変えない指定があるため、記録のファイルは作らず、更新履歴も書き換えません。";

export const HISTORY_TASK_KEY = "update_project_history";

/** The plan without record files: no history task, no _ai-records/ deliverable the request did not name, and each task told so. */
export function withoutRecords(draft: PlanDraft, requestText: string): PlanDraft {
  const named = (p: string) => requestText.includes(p) || requestText.includes(p.split(/[\\/]/).pop()!);
  const tasks = draft.tasks.filter((t) => t.key !== HISTORY_TASK_KEY);
  const kept = new Set(tasks.map((t) => t.key));
  return {
    ...draft,
    summary: [draft.summary, NO_RECORDS_NOTE].filter(Boolean).join(" "),
    tasks: tasks.map((t) => ({
      ...t,
      expectedOutputs: t.expectedOutputs.filter((p) => !/^(?:\.[\\/])?_ai-records[\\/]/.test(p.trim()) || named(p.trim())),
      constraints: t.constraints.includes(NO_RECORDS_RULE) ? t.constraints : [...t.constraints, NO_RECORDS_RULE],
      dependsOn: t.dependsOn.filter((d) => kept.has(d)),
    })),
  };
}
