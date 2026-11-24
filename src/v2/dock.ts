import type { Task } from "./types";

/** What the pinned prompt box at the bottom does when Enter is pressed, depending on where the request stands. */
export type DockMode = {
  kind: "new" | "redirect" | "plan-feedback";
  placeholder: string;
  hint: string;
  button: string;
  /** asks "really?" first: sending stops work that is running */
  confirm?: string;
};

export function dockMode(status: string | null, planWaiting: boolean): DockMode {
  if (planWaiting) {
    return { kind: "plan-feedback", placeholder: "計画を直してほしい点を書いて Enter(合っていれば、上の「この計画で開始」を押します)", hint: "Enter で送信 / Shift+Enter で改行。AIが計画を作り直します", button: "計画を直す" };
  }
  if (status === "running" || status === "paused") {
    return {
      kind: "redirect",
      placeholder: "変えたいことがあれば書いて Enter(いまの作業は止まります)",
      hint: "Enter で送信 / Shift+Enter で改行。止まった作業の代わりに、新しい計画を提案します",
      button: "止めて変える",
      confirm: "いま実行中の作業を止めて、新しい計画を作ります。よろしいですか?(終わった作業は残ります)",
    };
  }
  return { kind: "new", placeholder: "次に頼みたいことを書いて Enter", hint: "Enter で送信 / Shift+Enter で改行。条件を細かく指定したいときは、画面上の「新しい依頼」から", button: "送る" };
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
  else if (status === "completed") next = "あなたがやることはありません。次に頼みたいことを、下の欄に書いてください";
  else if (status === "failed") next = "上の「次にやること」から、やり直すか、下の欄に新しい依頼を書いてください";
  else if (status === "cancelled") next = "下の欄に、新しい依頼を書いてください";
  else next = "終わるまでお待ちください(終わると、ここに結果が出ます)";
  return { did, result, next };
}
