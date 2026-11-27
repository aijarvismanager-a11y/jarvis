import type { Mission, Task } from "./types";

/** What the pinned prompt box at the bottom does when Enter is pressed, depending on where the request stands. */
export type DockMode = {
  kind: "new" | "redirect" | "plan-feedback";
  placeholder: string;
  /** for a narrow (phone) screen, where a long placeholder makes the box several lines tall */
  shortPlaceholder: string;
  /** what sending does here; the keyboard help is added by the box on screens wide enough to have a keyboard */
  hint: string;
  button: string;
  /** asks "really?" first: sending stops work that is running */
  confirm?: string;
};

/** `form`: the long request form is open above ("questions" = it is asking the questions to answer before starting). */
export function dockMode(status: string | null, planWaiting: boolean, form?: "open" | "questions"): DockMode {
  if (planWaiting) {
    return { kind: "plan-feedback", placeholder: "計画を直してほしい点を書いて Enter(合っていれば、上の「この計画で開始」を押します)", shortPlaceholder: "計画の直したい点を書く", hint: "AIが計画を作り直します", button: "計画を直す" };
  }
  if (status === "running" || status === "paused") {
    return {
      kind: "redirect",
      placeholder: "変えたいことがあれば書いて Enter(いまの作業は止まります)",
      shortPlaceholder: "変えたいことを書く",
      hint: "止まった作業の代わりに、新しい計画を提案します",
      button: "止めて変える",
      confirm: "いま実行中の作業を止めて、新しい計画を作ります。よろしいですか?(終わった作業は残ります)",
    };
  }
  // the place where conditions can be given differs: the open form, the "新しい依頼" button of a finished request, or the folded
  // form; while a plan is being made there is none of them
  const finished = status === "completed" || status === "failed";
  const hint = form === "questions" ? "確認の質問には、上のフォームで答えます。ここから送ると、別の依頼になります"
    : form === "open" ? "条件の指定は、上のフォームの「詳細設定(任意)」で"
    : status === "planning" ? ""
    : `条件の指定は、上の${finished ? "「新しい依頼」" : "「条件や使う技術も指定して、くわしく依頼する」"}から`;
  return { kind: "new", placeholder: status ? "次に頼みたいことを書いて Enter" : "作りたいものを書いて Enter", shortPlaceholder: status ? "次に頼みたいことを書く" : "作りたいものを書く", hint, button: "送る" };
}

/** Enter sends; Shift+Enter makes a new line; Enter while a Japanese conversion is still open (IME) only confirms the conversion. */
export function isSendKey(e: { key: string; shiftKey: boolean; isComposing?: boolean; keyCode?: number }): boolean {
  if (e.key !== "Enter" || e.shiftKey) return false;
  if (e.isComposing || e.keyCode === 229) return false;
  return true;
}

/** The three short lines at the top of the AI's reply: what was done, how it went, what comes next. */
export type ReplySummaryLines = { did: string; result: string; next: string };

export function replySummary(tasks: Task[], status: string, humanTodoCount: number): ReplySummaryLines {
  const count = (s: Task["status"]) => tasks.filter((t) => t.status === s).length;
  const done = count("completed");
  const failed = count("failed") + count("blocked");
  const did = tasks.length === 0 ? "まだ作業は始まっていません" : `${tasks.length}件の作業のうち、${done}件が終わりました`;
  let result: string;
  if (status === "completed") result = failed > 0 ? `できました(ただし${failed}件はうまくいきませんでした)` : "最後まで、うまくできました";
  else if (status === "failed") result = `途中で止まりました(うまくいかなかった作業 ${failed}件)`;
  else if (status === "cancelled") result = "途中でやめました";
  else result = "進めています";
  let next: string;
  if (humanTodoCount > 0) next = `あなたの番です。人にしかできない作業が${humanTodoCount}件あります(上の「いまやること」)`;
  else if (status === "completed" && failed > 0) next = "「各作業の中身と回答を見る」で、うまくいかなかった作業の理由を確かめてください。必要なら、下の欄で頼み直せます";
  else if (status === "completed") next = "あなたがやることはありません。次に頼みたいことを、下の欄に書いてください";
  else if (status === "failed") next = "上の「次にやること」から、やり直すか、下の欄に新しい依頼を書いてください";
  else if (status === "cancelled") next = "下の欄に、新しい依頼を書いてください";
  else next = "終わるまでお待ちください(終わると、ここに結果が出ます)";
  return { did, result, next };
}

/** One earlier exchange in the conversation: what was asked, and in two short phrases how it ended. */
export type PastExchange = { mission: Mission; tasks: Task[]; result: string; did: string };

/** The requests made before the one on screen, oldest first (the newest sits right above the current one, like a chat). */
export function pastExchanges(missions: Mission[], tasks: Task[], current: Mission | null): PastExchange[] {
  if (!current) return [];
  return missions
    .filter((m) => m.id !== current.id && m.createdAt <= current.createdAt)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((mission) => ({ mission, tasks: tasks.filter((t) => t.missionId === mission.id).sort((a, b) => a.position - b.position) }))
    .filter((x) => !(x.mission.status === "draft" && x.tasks.length === 0)) // never planned: nothing was said back
    .map((x) => {
      const ended = ["completed", "failed", "cancelled"].includes(x.mission.status);
      const s = replySummary(x.tasks, x.mission.status, 0);
      return { ...x, did: s.did, result: ended ? s.result : "終わっていません" };
    });
}

/** A running request read as a conversation: ended tasks in the order they ended, then the ones in hand, then the rest. */
export function runThread(tasks: Task[]): { said: Task[]; now: Task[]; next: Task[] } {
  const of = (...s: Task["status"][]) => tasks.filter((t) => s.includes(t.status)); // keeps the plan's order
  return {
    said: of("completed", "failed", "blocked", "cancelled").sort((a, b) => a.updatedAt.localeCompare(b.updatedAt)),
    now: of("running", "validation", "waiting", "paused"),
    next: of("pending", "ready"),
  };
}
