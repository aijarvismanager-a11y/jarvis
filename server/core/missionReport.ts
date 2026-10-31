import type { Store, Task } from "./store.ts";
import { isWriteTask } from "./scheduler.ts";
import { linkKey } from "./projectSync.ts";

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
  /** the deliverable itself says it could not check / could not read what it was asked about (the question is unanswered) */
  inconclusive: boolean;
  /** the deliverable answers, but says some points are still unconfirmed ("確認状況: 一部未確認") */
  partly: boolean;
};
/** A button on a to-do: what it does is decided by the screen, the report only names it. */
export type ReportAction =
  | { kind: "new_request"; label: string; goal: string }
  | { kind: "retry"; label: string; taskId: string }
  | { kind: "artifact"; label: string; path: string }
  | { kind: "copy"; label: string; text: string }
  | { kind: "sync"; label: string };
/** Something the person has to (or may) do, with why and exact steps; `required` ones are the only reason to say "you have to do something". */
export type ReportTodo = { id: string; required: boolean; title: string; why: string; steps: string[]; actions: ReportAction[] };
export type MissionReport = {
  missionId: string;
  goal: string;
  status: string;
  verdict: "verified" | "partial" | "unfinished";
  verdictLabel: string;
  tasks: ReportTask[];
  notChecked: string[];
  /** what the person can do about it, in plain words */
  nextSteps: string[];
  /** what the person has to do (required) or may do to be safer (optional); empty = nothing to do */
  todos: ReportTodo[];
  notes: string[];
  usage: { durationMs: number; costUsd: number | null; runs: number };
  markdown: string;
};

/** Phrases a deliverable uses to admit it did not actually find out what it was asked. */
const ADMISSION = /未確認|読めて(い)?ない|読めなかった|確認できて(い)?ない|確認できなかった|確認でき(ませ|ま)ん|実ファイルが(ない|存在しな)|見つからなかった/g;
export const INCONCLUSIVE_AT = 3;
/** The line a web AI is asked to end a research/review deliverable with. It outranks counting admissions in the text. */
// a few words may sit before the verdict ("確認状況: 設計確定", "確認状況: 調査は確定")
const STATUS_LINE = /確認状況[:：]\s*[^\n確未]{0,12}?(確定|一部未確認|確認できず)/g;
/** The project's own running records (TESTLOG, PLAN, ARCHITECTURE...): they hold old "未確認" lines from earlier work, so they say nothing about whether this task got its answer. */
export const isHistoryFile = (rel: string) => /(^|[\/])(TESTLOG|PLAN|ARCHITECTURE|CHANGELOG|README|STATUS)[^\/]*\.md$/i.test(rel);

/** How many times a deliverable admits it could not read / find / confirm what it was asked about (INCONCLUSIVE_AT or more = no answer). */
export function admissionCount(text: string, objective: string): number {
  const stated = statedStatus(text);
  if (stated) return stated === "none" ? INCONCLUSIVE_AT : 0; // it says how far it got: take its word
  // a deliverable whose job is to LIST the unconfirmed points ("未確認事項一覧") says "未確認" all the time: that is its content, not an admission
  if (/未確認事項/.test(objective)) return 0;
  return text.match(ADMISSION)?.length ?? 0;
}

/** "settled" / "partly" / "none", or null when the deliverable does not say (the last such line counts). */
export function statedStatus(text: string): "settled" | "partly" | "none" | null {
  const all = [...text.matchAll(STATUS_LINE)];
  const last = all[all.length - 1]?.[1];
  return last === "確定" ? "settled" : last === "一部未確認" ? "partly" : last === "確認できず" ? "none" : null;
}

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
    const admissions = readArtifact && t.status === "completed" && !isWriteTask(t) ? files.reduce((n, f) => {
          if (isHistoryFile(f)) return n;
          return n + admissionCount(readArtifact(f) ?? "", t.objective);
        }, 0) : 0;
    // "一部未確認": it answered, and says which points are still open (not the same as having no answer)
    const partly = !!readArtifact && t.status === "completed" && !isWriteTask(t) && files.some((f) => statedStatus(readArtifact(f) ?? "") === "partly");
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
      partly,
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
  const partlyTasks = done.filter((x) => x.partly && !x.inconclusive);
  if (partlyTasks.length) notChecked.unshift(`作業${partlyTasks.map((t) => reportTasks.indexOf(t) + 1).join("・")}の成果物は、答えは出していますが、「確認できていない点が残っている」と書いています。残っている点は、成果物の中の「未確認」の項に出ています`);
  notChecked.push("画面や機能が、あなたの要望どおりかどうかは人の目での確認が必要です");

  const numberOf = (t: ReportTask) => reportTasks.indexOf(t) + 1;
  const shortObjective = (t: ReportTask) => (t.objective.length > 60 ? `${t.objective.slice(0, 60)}…` : t.objective);
  const todos: ReportTodo[] = [];
  const unfinishedMission = !["completed", "cancelled"].includes(mission.status);
  for (const t of reportTasks.filter((x) => (x.status === "failed" || x.status === "blocked") && unfinishedMission && x.status === "failed")) {
    todos.push({
      id: `retry-${t.id}`,
      required: true,
      title: `作業${numberOf(t)}が失敗して止まっています`,
      why: "この作業が終わらないと、後ろの作業に進めません。もう一度やらせれば、たいていは進みます。",
      steps: ["下の「この作業をやり直す」を押します(別のAIに替わることがあります)。", "それでも失敗するときは、「計画をやり直す」を押すか、依頼の範囲を小さくしてください。"],
      actions: [{ kind: "retry", label: "この作業をやり直す", taskId: t.id }],
    });
  }
  // an answer is missing because the AI was not allowed to run the command it needed: asking again cannot fix that
  const CANNOT_RUN = /承認(プロンプト|が必要)|承認できる主体|DESTRUCTIVE|許可が(出|得)|実行(自体)?ができて?(い)?ない|実行できなかった/;
  const COMMAND = /\b((?:dotnet|npm|npx|pnpm|yarn|cargo|go|pytest|python|mvn|gradle|make)\s+[\w.\-]+(?:\s+[\w./\-]+)*)/;
  for (const t of done.filter((x) => x.inconclusive)) {
    const text = readArtifact ? t.files.map((f) => readArtifact(f) ?? "").join("\n") : "";
    if (CANNOT_RUN.test(text)) {
      const command = t.objective.match(COMMAND)?.[1];
      todos.push({
        id: `cannot-run-${t.id}`,
        required: false,
        title: `作業${numberOf(t)}は、AIが実行を許されなかったため、確かめられていません`,
        why: "このアプリは、AIが勝手にコマンドを実行しないよう、許可の出ない操作を止めています。作業が失敗したわけではなく、「確かめられなかった」だけです。あなたがやり直させても、同じ理由で確かめられません。",
        steps: command
          ? [`ご自身で確かめるときは、プロジェクトのフォルダで「${command}」を実行します(元のフォルダに反映済みなら、そこで実行します)。`, "エラーが出なければ、その点は問題ありません。エラーが出たら、その文面を、新しい依頼にそのまま貼ってください。", "確かめなくても、ほかの作業の結果は使えます(確かめないと、動くかどうかが分からないだけです)。"]
          : ["確かめたい操作を、ご自身で実行します。", "エラーが出たら、その文面を、新しい依頼にそのまま貼ってください。"],
        actions: command ? [{ kind: "copy", label: "コマンドをコピー", text: command }, { kind: "sync", label: "元のフォルダへの反映を見る" }] : [{ kind: "sync", label: "元のフォルダへの反映を見る" }],
      });
    } else {
      todos.push({
        id: `unanswered-${t.id}`,
        required: true,
        title: `作業${numberOf(t)}は、聞いたことの答えが出ていません`,
        why: "AIが、調べたいものを読めなかった(または見つけられなかった)と書いています。そのままだと、この作業の結論は使えません。",
        steps: [
          "まず、下の「成果物を読む」で、AIが何を確認できなかったのかを読みます。",
          "答えが要るときは、「範囲を絞ってもう一度頼む」を押します。入力欄に、文面が入ります。",
          "文面の中の「対象」を、ファイルや関数の名前に書き換えてから、「開発を開始」を押します。",
          "答えが要らないときは、何もしなくて大丈夫です。",
        ],
        actions: [
          ...t.files.slice(0, 2).map((path) => ({ kind: "artifact" as const, label: `成果物を読む(${path.split("/").pop()})`, path })),
          { kind: "new_request" as const, label: "範囲を絞ってもう一度頼む", goal: `前回の作業「${shortObjective(t)}」は、答えが出ませんでした。次の対象に絞って、もう一度調べてください。
対象: (ここに、ファイルや関数の名前を書いてください)

元の作業: ${t.objective}` },
        ],
      });
    }
  }
  const partlyTasks2 = done.filter((x) => x.partly && !x.inconclusive);
  if (partlyTasks2.length) {
    todos.push({
      id: "partly",
      required: false,
      title: `作業${partlyTasks2.map(numberOf).join("・")}に、確認できていない点が残っています`,
      why: "失敗ではありません。答えは出ていて、「ここはまだ確かめていない」という点が、成果物の中に書かれているだけです。",
      steps: ["下の「成果物を読む」で、「未確認」と書かれた項を読みます。", "結論が変わりそうな点だけ、「その点を確かめてもらう」を押して、もう一度頼みます。", "結論が変わりそうにない点なら、何もしなくて大丈夫です。"],
      actions: [
        ...partlyTasks2.flatMap((t) => t.files.slice(0, 1).map((path) => ({ kind: "artifact" as const, label: `作業${numberOf(t)}の成果物を読む`, path }))),
        { kind: "new_request" as const, label: "その点を確かめてもらう", goal: `作業${partlyTasks2.map(numberOf).join("・")}の成果物で「未確認」とされた点のうち、次の点だけを確かめてください。
確かめる点: (ここに、確かめたい点を書いてください)` },
      ],
    });
  }
  // The check run after the request was reflected (build, start and measure the real app): when it passed, "try it yourself" is not needed; when it failed, that is a real to-do.
  const verified = store.getSetting<{ at: string; status: string; summary: string; missionId?: string } | null>(`verifyResult:${projectId}`, null);
  const verifiedThis = !!verified && verified.missionId === missionId;
  if (verifiedThis && verified!.status === "passed") notChecked.unshift(`反映後の自動確認は通りました: ${verified!.summary}`);
  if (verifiedThis && verified!.status === "failed") {
    todos.unshift({
      id: "verify-failed",
      required: true,
      title: "反映後の自動確認が失敗しました",
      why: `ビルドして実際に動かして測ったところ、基準に届きませんでした: ${verified!.summary}`,
      steps: ["下の「元のフォルダへの反映を見る」を開き、「反映後の自動確認」の結果を読みます。", "原因が分かるときは、新しい依頼で、その内容を伝えてください(結果の文面をそのまま貼れます)。", "直したあとは、同じ画面の「確認を実行」を押して、もう一度確かめます。"],
      actions: [{ kind: "sync", label: "元のフォルダへの反映を見る" }],
    });
  }
  if (code.length > 0 && finished && !code.some((x) => x.level >= 4) && !(verifiedThis && verified!.status === "passed") && !todos.some((x) => x.id.startsWith("cannot-run"))) {
    todos.push({
      id: "try-it",
      required: false,
      title: "実際に動かして、確かめておくと安心です",
      why: "コードは書き換わっていますが、アプリを起動して画面を開く確認までは、自動では行われていません。",
      steps: ["Webアプリなら、ホームの「動かして確認する」の「起動して見る」を押します。", "Gageのようなデスクトップアプリは、「元のフォルダへの反映を見る」で内容を確かめてから反映し、ご自身でビルドして起動します。", "おかしなところがあれば、その様子を文章にして、新しい依頼で伝えてください。"],
      actions: [{ kind: "sync", label: "元のフォルダへの反映を見る" }],
    });
  }
  if (done.length && !todos.length && done.some((x) => !x.isCode)) {
    todos.push({
      id: "read-deliverables",
      required: false,
      title: "成果物を読んで、おかしな点がないか見ておくと安心です",
      why: "調査・設計・文書の中身が正しいかは、自動では検証していません(ファイルがあることだけ確認しています)。",
      steps: ["下の「成果物を読む」で、内容を読みます。", "おかしな点があれば、新しい依頼で、どこがおかしいかを伝えてください。"],
      actions: done.filter((x) => !x.isCode && x.files.length).slice(0, 3).map((t) => ({ kind: "artifact" as const, label: `作業${numberOf(t)}の成果物を読む`, path: t.files[0]! })),
    });
  }
  // A project made inside the app only reaches its folder (with CHANGELOG.md etc.) when the person presses 反映.
  const link = store.getSetting<{ sourcePath?: string; createdByApp?: boolean } | null>(linkKey(projectId), null);
  if (finished && link?.createdByApp && link.sourcePath && code.length + done.length > 0) {
    todos.push({
      id: "deliver",
      required: true,
      title: "できたものを、保存先のフォルダに入れてください",
      why: `このプロジェクトはアプリの中で作っています。押すまで、成果物と更新履歴(CHANGELOG.md など)は「${link.sourcePath}」に入りません。`,
      steps: ["下のボタンで「保存先のフォルダに入れる」を開きます。", "入れるファイルを確かめて、「反映する」を押します。"],
      actions: [{ kind: "sync", label: "保存先のフォルダに入れる" }],
    });
  }
  // plain-text form of the same advice (Markdown copy, older screens)
  const nextSteps = todos.map((x) => `${x.required ? "【やること】" : "【任意】"}${x.title}。${x.why}`);

  const notes: string[] = [];
  const retried = reportTasks.filter((t) => t.attempts > 1);
  if (retried.length) notes.push(`${retried.length}個の作業は複数回実行しています(再試行・やり直し)`);
  const count = (type: string) => events.filter((e) => e.type === type).length;
  if (count("AI_REVIEW_BY_AUTHOR")) notes.push(`ほかのAIがすべて使えなかったため、書いたAI自身がレビューした作業が${count("AI_REVIEW_BY_AUTHOR")}件あります(別のAIの目では見ていません。大事な変更なら、あとで別のAIに見てもらってください)`);
  if (count("AI_FALLBACK")) notes.push(`失敗により別のAIへ切り替えた作業が${count("AI_FALLBACK")}件あります`);
  if (count("TASK_MANUAL_RETRY")) notes.push(`手動でやり直した作業が${count("TASK_MANUAL_RETRY")}件あります`);
  if (count("TASK_ROLLBACK")) notes.push(`変更を元に戻した作業が${count("TASK_ROLLBACK")}件あります`);
  if (count("APPROVAL_DENIED")) notes.push("AIが実行しようとした操作のうち、許可が出なかったものがあります(許可の出ない操作は止める決まりです。作業全体が失敗したとは限りません)");
  for (const t of reportTasks.filter((x) => x.status === "failed" || x.status === "blocked" || x.status === "cancelled")) notes.push(`作業${reportTasks.indexOf(t) + 1}は完了していません(${t.status})`);

  const verdict: MissionReport["verdict"] = !finished ? "unfinished" : code.length > 0 && code.every((t) => t.level >= 3) && code.some((t) => t.level >= 4) ? "verified" : "partial";
  const inconclusive = done.some((t) => t.inconclusive);
  const verdictLabel = verdict === "verified" ? "検証済み(自動テストと起動確認まで通過)" : verdict === "partial" ? (inconclusive ? "作業は終わったが、答えが出ていない作業がある" : done.some((t) => t.partly) ? "完了(確認できていない点が残っています)" : "完了(ただし検証は一部のみ)") : "未完了";

  const durationMs = runs.reduce((s, r) => s + (Number(r.duration_ms) || 0), 0);
  const costs = runs.map((r) => r.cost_usd).filter((c): c is number => typeof c === "number");
  const usage = { durationMs, costUsd: costs.length ? costs.reduce((s, c) => s + c, 0) : null, runs: runs.length };

  const lines = [
    `# 完了検証レポート: ${mission.goal}`,
    "",
    `判定: **${verdictLabel}**`,
    "",
    "## 作業ごとの結果",
    ...reportTasks.map((t, i) => `- [${t.status === "completed" ? "x" : " "}] 作業${i + 1}: ${t.objective}(${t.status}${t.inconclusive ? " / 答えが出ていない" : t.partly ? " / 一部未確認" : ""}${t.level ? ` / 最高検証 ${LEVEL_LABEL[t.level] ?? `L${t.level}`}` : ""}${t.attempts > 1 ? ` / ${t.attempts}回実行` : ""})`),
    "",
    "## 確認していないこと",
    ...notChecked.map((n) => `- ${n}`),
  ];
  lines.push("", "## あなたがやること", todos.some((x) => x.required) ? "" : "いまは、あなたがやることはありません。");
  for (const x of todos) lines.push(`- ${x.required ? "【やること】" : "【任意】"}${x.title}`, `  - ${x.why}`, ...x.steps.map((st, i) => `  ${i + 1}. ${st}`));
  if (notes.length) lines.push("", "## 注意点", ...notes.map((n) => `- ${n}`));
  lines.push("", `作業時間 ${Math.round(durationMs / 1000)}秒 / 実行${usage.runs}回${usage.costUsd != null ? ` / API換算 $${usage.costUsd.toFixed(2)}` : ""}`);

  return { missionId, goal: mission.goal, status: mission.status, verdict, verdictLabel, tasks: reportTasks, notChecked, nextSteps, todos, notes, usage, markdown: lines.join("\n") };
}
