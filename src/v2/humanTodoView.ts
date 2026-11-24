import type { HumanTodoView } from "./types";

type Step = HumanTodoView["steps"][number];

const LONG_COMMAND = /[A-Za-z][\w\-.\\/:]*(?:\s+-{1,2}[\w-]+(?:\s+[^\s、。]+)?)+/g;

/**
 * One short line for a step ("コマンドを1回実行し"), so a list of steps can be read at a glance.
 * The full text stays available under "くわしく". Commands are replaced by the word コマンド: they are copied with a button.
 */
export function stepHeadline(step: Step, max = 48): string {
  let text = step.text.replace(/`/g, "").replace(/\s+/g, " ").trim();
  if (step.command && text.includes(step.command)) text = text.replace(step.command, "コマンド");
  text = text.replace(LONG_COMMAND, "コマンド").replace(/（[^）]*）|\([^)]*\)/g, "").replace(/\s+/g, " ").trim();
  let head = text.split("。")[0];
  if (head.length > max) {
    const cut = head.indexOf("、", 12);
    head = cut > 0 && cut <= max ? head.slice(0, cut) : `${head.slice(0, max - 1)}…`;
  }
  return head.replace(/[、,:：\s]+$/, "") || text.slice(0, max);
}

/** The step to do next: the first one not ticked yet (null when all are ticked). */
export function nextOpenStep(ticks: boolean[], count: number): number | null {
  for (let i = 0; i < count; i++) if (!ticks[i]) return i;
  return null;
}

/** The one-line "your turn" for the top of the screen when the AI's part is finished and a person's part is left. */
export function humanTurnLine(todos: HumanTodoView[]): { title: string; detail: string } | null {
  if (todos.length === 0) return null;
  const first = todos[0];
  return {
    title: `あなたの番です: ${first.title}`,
    detail: `AI の作業は終わりました。残りは、人にしかできない作業です(${todos.length}件${todos.length > 1 ? "。まず1件目から" : ""})。下の「いまやること」を、上のチェックから順に進めてください。終わったら「やりました」を押します。`,
  };
}
