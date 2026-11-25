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
const HUMAN_ONLY = /ログイン|サインイン|パスワード|認証|CAPTCHA|キャプチャ|支払|決済|課金|購入|振込|規約|同意|アカウント(?:の)?(?:作成|登録)|承認|許可|目視|(?<![項細種科])目で|実機|自分の(?:PC|パソコン|スマホ)|スマホ|実際に(?:操作|確か|確認|開)|実際の画面|画面(?:を|で)(?:見|確認|目)|画面の(?:確認|操作)|ブラウザで開|ダブルクリック|人が(?:一度|実際|見)|人の(?:目|手|操作)|自動では(?:確認|確か)|音が出る|人が貼る|AI\s*(?:は|が)[^。]{0,40}(?:できない|できず|行えず)/i;

/** Whether the todo is work only a person can do (with the matching words) or one the AI could probably take over. */
export function humanOnlyKind(todo: Pick<HumanTodoView, "title" | "why" | "steps">): { onlyHuman: boolean; label: string } {
  const text = [todo.title, todo.why, ...todo.steps.map((s) => s.text)].join("\n");
  const hit = text.match(HUMAN_ONLY)?.[0];
  if (hit) return { onlyHuman: true, label: todo.why ? `人にしかできない理由: ${todo.why}` : `人にしかできない作業です(「${hit}」が含まれます)` };
  return { onlyHuman: false, label: "AIに任せられる可能性があります(ログイン・支払い・目視確認などは見当たりません)" };
}

// a step that records or reports what the person saw can only be done after the person did their part
const PERSON_RESULT = /結果|書き留め|控え|報告|伝え/;

// inside a person-only todo, a step that looks, listens, photographs, opens a page or writes something down is the person's part
const LOOKING = /確認|確かめ|見る|見て|見え|聞|撮|開き|開く|記録|書/;

// commands that only start or stop something for the person to look at (a local server, a screen-capture helper): pointless without the person
const SETS_UP_A_LOOK = /\bserve\b|-Action\s+(?:Start|Stop|Status|Shot)\b/i;

/**
 * Whether one step can be handed to the AI. Inside a todo the person has to do, only a step that runs a command is offered
 * (real to-dos are mostly "open it and look" steps: those stay with the person), and never one that looks, records or reports.
 */
export function stepDelegable(step: { text: string; command: string | null }): boolean {
  return step.command !== null && !SETS_UP_A_LOOK.test(step.command) &&!HUMAN_ONLY.test(step.text) && !PERSON_RESULT.test(step.text) && !LOOKING.test(step.text);
}

/** Indexes of the steps (not ticked yet) that the AI could take over. */
export function delegableSteps(todo: Pick<HumanTodoView, "steps">, ticks: boolean[]): number[] {  return todo.steps.flatMap((s, i) => (!ticks[i] && stepDelegable(s) ? [i] : []));
}

/** The request sent to the AI when a todo (or only some of its steps, `only`) is handed over to it. */
export function delegateGoal(todo: Pick<HumanTodoView, "title" | "steps">, only?: number[]): string {
  const picked = only && only.length < todo.steps.length ? only : null;
  const steps = todo.steps.flatMap((s, i) => (!picked || picked.includes(i) ? [`${i + 1}. ${s.text}`] : [])).join("\n");
  const rest = picked ? "\n\nここに書いていない手順は、人が行います。手を出さず、HUMAN_TODO.md の元の案内も書き換えないでください。" : "";
  return `次の作業は、人に頼まず自分で実行・確認してください。\n\n作業: ${todo.title}\n${steps}${rest}\n\nログイン・支払い・規約への同意・目視確認など本当に人にしかできない部分だけ、理由つきで HUMAN_TODO.md に残してください。`;
}

/** The step to do next: the first one not ticked yet (null when all are ticked). */
export function nextOpenStep(ticks: boolean[], count: number): number | null {
  for (let i = 0; i < count; i++) if (!ticks[i]) return i;
  return null;
}

/** How the request handed to the AI stands for step `i` (null when none covers it). A request that ended without finishing is "failed". */
export function aiStepState(todo: Pick<HumanTodoView, "delegation">, i: number): "active" | "completed" | "failed" | null {
  const d = todo.delegation;
  return d && (d.steps === null || d.steps.includes(i)) ? d.state : null;
}

/** The ticks as shown: the person's own, plus the steps the AI is doing or has finished (never the ones whose request failed). */
export function shownTicks(todo: Pick<HumanTodoView, "delegation" | "steps">, ticks: boolean[]): boolean[] {
  return todo.steps.map((_, i) => !!ticks[i] || ["active", "completed"].includes(aiStepState(todo, i) ?? ""));
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
