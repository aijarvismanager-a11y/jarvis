import type { Store, Task } from "./store.ts";
import { isWriteTask } from "./scheduler.ts";

// Completion report: what was done, what was actually checked and how far, and
// what was NOT checked. Built only from recorded facts (tasks, validations,
// runs, events) - no AI is asked, so it cannot flatter the result.

export const LEVEL_LABEL: Record<number, string> = { 1: "L1 成果物の存在", 2: "L2 構文チェック", 3: "L3 自動テスト(npm test)", 4: "L4 結合ゲート(起動して画面を開く)" };

export type ReportTask = {
  id: string;
  role: string;
  objective: string;
  status: string;
  aiId: string | null;
  isCode: boolean;
  /** highest validation level that passed (0 = never validated) */
  level: number;
  checks: string | null;
  attempts: number;
  durationMs: number;
  costUsd: number | null;
  files: string[];
  /** the deliverable itself says it could not check / could not read what it was asked about */
  inconclusive: boolean;
};
export type MissionReport = {
  missionId: string;
  goal: string;
  status: string;
  verdict: "verified" | "partial" | "unfinished";
  verdictLabel: string;
  tasks: ReportTask[];
  notChecked: string[];
  notes: string[];
  usage: { durationMs: number; costUsd: number | null; runs: number };
  markdown: string;
};

/** Phrases a deliverable uses to admit it did not actually find out what it was asked. */
const ADMISSION = /未確認|読めて(い)?ない|読めなかった|確認できて(い)?ない|確認できなかった|確認でき(ませ|ま)ん|実ファイルが(ない|存在しな)|見つからなかった/g;
export const INCONCLUSIVE_AT = 3;

/** readArtifact returns the text of a deliverable (null when unreadable); without it, deliverable contents are not judged. */

export function buildMissionReport(store: Store, projectId: string, missionId: string, readArtifact?: (relPath: string) => string | null): MissionReport {
  const mission = store.getMission(projectId, missionId);
  if (!mission) throw new Error("依頼が見つかりません");
  const tasks = store.listTasks(projectId).filter((t) => t.missionId === missionId).sort((a, b) => a.position - b.position);
  const ids = new Set(tasks.map((t) => t.id));
  const validations = store.listValidations(projectId).filter((v) => ids.has(String(v.task_id)));
  const runs = store.listAiRuns(projectId).filter((r) => r.task_id && ids.has(String(r.task_id)));
  const artifacts = store.listArtifacts(projectId).filter((a) => a.taskId && ids.has(a.taskId));
  const events = store.listEvents({ projectId, limit: 1000 }).filter((e) => e.taskId && ids.has(e.taskId));

  const reportTasks: ReportTask[] = tasks.map((t: Task) => {
    const mine = validations.filter((v) => v.task_id === t.id);
    const passed = mine.filter((v) => v.status === "passed");
    const level = passed.reduce((m, v) => Math.max(m, Number(v.level)), 0);
    const last = passed[passed.length - 1];
    const myRuns = runs.filter((r) => r.task_id === t.id);
    const costs = myRuns.map((r) => r.cost_usd).filter((c): c is number => typeof c === "number");
    const files = [...new Set(artifacts.filter((a) => a.taskId === t.id).map((a) => a.path))];
    const admissions = readArtifact && t.status === "completed" && !isWriteTask(t) ? files.reduce((n, f) => n + ((readArtifact(f) ?? "").match(ADMISSION)?.length ?? 0), 0) : 0;
    return {
      id: t.id,
      role: t.role,
      objective: t.objective,
      status: t.status,
      aiId: t.selectedAi,
      isCode: isWriteTask(t),
      level,
      checks: last?.detail ? String(last.detail) : null,
      attempts: myRuns.length,
      durationMs: myRuns.reduce((s, r) => s + (Number(r.duration_ms) || 0), 0),
      costUsd: costs.length ? costs.reduce((s, c) => s + c, 0) : null,
      files,
      inconclusive: admissions >= INCONCLUSIVE_AT,
    };
  });

  const done = reportTasks.filter((t) => t.status === "completed");
  const code = done.filter((t) => t.isCode);
  const finished = mission.status === "completed";
  const notChecked: string[] = [];
  if (code.some((t) => t.level < 3)) notChecked.push("自動テストが走っていないコード作業があります(プロジェクトにテストスクリプトが無い、または検証が構文チェックまでです)");
  if (code.length > 0 && !code.some((t) => t.level >= 4)) notChecked.push("アプリを実際に起動して画面を開く検証(L4)は通っていません。「動かして見る」で実際に動くか確かめてください");
  if (done.some((t) => !t.isCode)) notChecked.push("調査・設計・ドキュメントの内容が正しいかは自動では検証していません(成果物ファイルの存在のみ確認)");
  for (const t of done.filter((x) => x.inconclusive)) notChecked.unshift(`作業${reportTasks.indexOf(t) + 1}の成果物は、確認できなかったと書いています。聞いたことの答えが出ていません(元のファイルを渡せていない可能性があります)`);
  notChecked.push("画面や機能が、あなたの要望どおりかどうかは人の目での確認が必要です");

  const notes: string[] = [];
  const retried = reportTasks.filter((t) => t.attempts > 1);
  if (retried.length) notes.push(`${retried.length}個の作業は複数回実行しています(再試行・やり直し)`);
  const count = (type: string) => events.filter((e) => e.type === type).length;
  if (count("AI_FALLBACK")) notes.push(`失敗により別のAIへ切り替えた作業が${count("AI_FALLBACK")}件あります`);
  if (count("TASK_MANUAL_RETRY")) notes.push(`手動でやり直した作業が${count("TASK_MANUAL_RETRY")}件あります`);
  if (count("TASK_ROLLBACK")) notes.push(`変更を元に戻した作業が${count("TASK_ROLLBACK")}件あります`);
  if (count("APPROVAL_DENIED")) notes.push("承認されなかった操作があります");
  for (const t of reportTasks.filter((x) => x.status === "failed" || x.status === "blocked" || x.status === "cancelled")) notes.push(`作業${reportTasks.indexOf(t) + 1}は完了していません(${t.status})`);

  const verdict: MissionReport["verdict"] = !finished ? "unfinished" : code.length > 0 && code.every((t) => t.level >= 3) && code.some((t) => t.level >= 4) ? "verified" : "partial";
  const inconclusive = done.some((t) => t.inconclusive);
  const verdictLabel = verdict === "verified" ? "検証済み(自動テストと起動確認まで通過)" : verdict === "partial" ? (inconclusive ? "作業は終わったが、結論が出ていない" : "完了(ただし検証は一部のみ)") : "未完了";

  const durationMs = runs.reduce((s, r) => s + (Number(r.duration_ms) || 0), 0);
  const costs = runs.map((r) => r.cost_usd).filter((c): c is number => typeof c === "number");
  const usage = { durationMs, costUsd: costs.length ? costs.reduce((s, c) => s + c, 0) : null, runs: runs.length };

  const lines = [
    `# 完了検証レポート: ${mission.goal}`,
    "",
    `判定: **${verdictLabel}**`,
    "",
    "## 作業ごとの結果",
    ...reportTasks.map((t, i) => `- [${t.status === "completed" ? "x" : " "}] 作業${i + 1}: ${t.objective}(${t.status}${t.inconclusive ? " / 結論が出ていない" : ""}${t.level ? ` / 最高検証 ${LEVEL_LABEL[t.level] ?? `L${t.level}`}` : ""}${t.attempts > 1 ? ` / ${t.attempts}回実行` : ""})`),
    "",
    "## 確認していないこと",
    ...notChecked.map((n) => `- ${n}`),
  ];
  if (notes.length) lines.push("", "## 注意点", ...notes.map((n) => `- ${n}`));
  lines.push("", `作業時間 ${Math.round(durationMs / 1000)}秒 / 実行${usage.runs}回${usage.costUsd != null ? ` / API換算 $${usage.costUsd.toFixed(2)}` : ""}`);

  return { missionId, goal: mission.goal, status: mission.status, verdict, verdictLabel, tasks: reportTasks, notChecked, notes, usage, markdown: lines.join("\n") };
}
