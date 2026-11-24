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

// things the AI really must not or cannot do itself: sign-in, money, agreeing to terms, bot checks, looking with human eyes, approvals
const HUMAN_ONLY = /ログイン|サインイン|パスワード|認証|CAPTCHA|キャプチャ|支払|決済|課金|購入|振込|規約|同意|アカウント(?:の)?(?:作成|登録)|承認|許可|目視|目で|実機|自分の(?:PC|パソコン|スマホ)|スマホ/i;

/** Whether the todo is work only a person can do (with the matching words) or one the AI could probably take over. */
export function humanOnlyKind(todo: Pick<HumanTodoView, "title" | "why" | "steps">): { onlyHuman: boolean; label: string } {
  const text = [todo.title, todo.why, ...todo.steps.map((s) => s.text)].join("\n");
  const hit = text.match(HUMAN_ONLY)?.[0];
  if (hit) return { onlyHuman: true, label: todo.why ? `人にしかできない理由: ${todo.why}` : `人にしかできない作業です(「${hit}」が含まれます)` };
  return { onlyHuman: false, label: "AIに任せられる可能性があります(ログイン・支払い・目視確認などは見当たりません)" };
}

/** The request sent to the AI when a todo is handed over to it. */
export function delegateGoal(todo: Pick<HumanTodoView, "title" | "steps">): string {
  const steps = todo.steps.map((s, i) => `${i + 1}. ${s.text}`).join("\n");
  return `次の作業は、人に頼まず自分で実行・確認してください。\n\n作業: ${todo.title}\n${steps}\n\nログイン・支払い・規約への同意・目視確認など本当に人にしかできない部分だけ、理由つきで HUMAN_TODO.md に残してください。`;
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
    detail: `AI の作業は終わりました。残りは、あなたの操作が必要な作業です(AIに任せられるものには「AIに任せる」ボタンがあります。${todos.length}件${todos.length > 1 ? "。まず1件目から" : ""})。下の「いまやること」を、上のチェックから順に進めてください。終わったら「やりました」を押します。`,
  };
}
