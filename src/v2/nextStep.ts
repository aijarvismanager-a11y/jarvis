import type { Ctx } from "./context";
import { WAIT_TEXT, isRefusedNote, roleLabel } from "./labels";
import type { Task } from "./types";

/** What the failed-mission banner can do for the person (the screen supplies these). */
export type FailedActions = { replan: () => void; retry: (taskId: string) => void };
/** After this many failed tries the app stops retrying by itself: doing the same task again repeats the same result. */
export const RETRIES_BEFORE_REPLAN = 3;

/** One clear answer for a failed request: which single button to press, and why (not a list of options). */
export function failedAdvice(tasks: Task[], actions?: FailedActions, notes?: Record<string, string>): Step {
  const bad = tasks.filter((t) => t.status === "failed");
  const worst = bad.slice().sort((a, b) => b.retryCount - a.retryCount)[0];
  // the person pressed "拒否する" themselves: nothing went wrong, so do not push "やり直す"
  const refused = bad.find((t) => isRefusedNote(notes?.[t.id]));
  if (refused) {
    return {
      tone: "wait", title: "許可しなかったため、この作業は行っていません",
      detail: "あなたが「拒否する」を押した作業です。やめるときは、このままで大丈夫です(「新しい依頼」で別の依頼を出せます)。やっぱり行うときだけ、「この作業をやり直す」を押すと、もう一度許可を聞きます。",
      action: actions ? { label: "この作業をやり直す(もう一度許可を聞く)", run: () => actions.retry(refused.id) } : undefined,
    };
  }
  if (!worst) {
    return {
      tone: "bad", title: "計画を作る段階で止まりました",
      detail: "作業はまだ始まっていません。「計画をやり直す」を押してください。理由は下の赤い枠にあります。何度も続くときだけ、依頼の書き方を具体的にしてください。",
      action: actions ? { label: "計画をやり直す", run: actions.replan } : undefined,
    };
  }
  if (worst.retryCount >= RETRIES_BEFORE_REPLAN) {
    return {
      tone: "bad", title: "同じ作業が何度も失敗したので、計画から立て直します",
      detail: "この作業は、同じ理由で繰り返し失敗したため、自動のやり直しを止めました。同じ作業をもう一度やっても同じ結果になりやすいので、「計画をやり直す」を押してください(別のやり方で作り直します)。理由は下の赤い枠にあります。",
      action: actions ? { label: "計画をやり直す", run: actions.replan } : undefined,
    };
  }
  return {
    tone: "bad", title: `作業が${bad.length > 1 ? `${bad.length}つ` : "1つ"}止まりました。まず、やり直してください`,
    detail: "ほとんどは、もう一度で通ります。「この作業をやり直す」を押してください。それでも止まるときは、下の「計画をやり直す」を使います。理由は下の赤い枠にあります。",
    action: actions ? { label: "この作業をやり直す", run: () => actions.retry(worst.id) } : undefined,
  };
}

export type Step = { tone: "go" | "wait" | "bad" | "done"; title: string; detail: string; action?: { label: string; run: () => void } };

/** What the person should do right now, in one sentence. The rest of the screen is detail. */
export function nextStep(ctx: Ctx, tasks: Task[], onNewRequest: () => void, planReady = true, resting = false, nowMs = Date.now(), failed?: FailedActions): Step {
  const { project, mission, approvals, handoffs } = ctx;
  const mine = <T extends { projectId: string }>(xs: T[]) => xs.filter((x) => x.projectId === project?.id);
  if (!project || !mission) return { tone: "go", title: "作りたいものを書いてください", detail: "いちばん下の入力欄に、作りたいものを普通の言葉で書いて「送る」を押します。AI が確認の質問をすることがあり、そのあと計画を立てます。" };
  if (mine(approvals).length > 0) {
    // an approval for one command (the AI was refused it) reads differently from one for a deletion / publishing
    const command = mine(approvals).some((a) => a.command);
    // the work cannot move without this answer: after a while say so, and how long it has been
    const oldest = Math.max(...mine(approvals).map((a) => nowMs - Date.parse(a.createdAt)).filter((n) => !Number.isNaN(n)), 0);
    if (oldest >= 10 * 60_000) return { tone: "bad", title: `あなたの許可を ${Math.round(oldest / 60_000)} 分待っています`, detail: "返事があるまで、この依頼は先へ進みません。下のカードの内容を読んで、「許可して続ける」か「拒否する」を選んでください。" };
    return { tone: "go", title: "あなたの許可が必要です", detail: command ? "AI が、まだ許可されていないコマンドを実行しようとしています。下のカードのコマンドを読んで、よければ「許可して続ける」、だめなら「拒否する」を選んでください。" : "AI が、削除や公開などを伴う作業をしようとしています。内容を読んで「許可して続ける」か「拒否する」を選んでください。" };
  }
  if (mine(handoffs).length > 0) return { tone: "go", title: "あなたの操作が必要です", detail: "別の AI(ChatGPT など)に、指示文を貼り付けて送り、返ってきた回答をここへ貼り付けてください。下のカードの手順どおりに進めます。" };
  switch (mission.status) {
    case "planning":
      if (!planReady) return { tone: "wait", title: "AI が計画を作っています", detail: "新しいアイデアは 1〜2 分、大きな既存プロジェクトは 10 分以上かかることがあります。できあがると、この画面が自動で切り替わるので、そのままお待ちください。" };
      return { tone: "go", title: "計画を確認して、よければ開始してください", detail: "AI が立てた作業の予定です。これでよければ「この計画で開始」を押します。直したい点があれば「直してほしい点があるとき」に書いて「修正して再提案」を押します。" };
    case "running": {
      // every AI is resting: the work is waiting, not being done (the yellow box above says when it goes on)
      if (resting) return { tone: "wait", title: "いまは使えるAIがありません。自動で再開します", detail: "使えるAIが戻りしだい、続きから自動で進みます。何もしなくて大丈夫です。再開の目安は、画面上部の黄色い枠にあります。" };
      const doing = tasks.find((t) => t.status === "running" || t.status === "validation" || t.status === "waiting");
      const waits = ctx.overview?.taskWaits ?? {};
      const active = tasks.filter((t) => t.status === "running" || t.status === "validation" || t.status === "waiting");
      // only when nothing is actually being worked on: say what it waits for
      if (active.length > 0 && active.every((t) => waits[t.id])) {
        const kind = waits[active[0]!.id]!;
        return { tone: kind === "login" ? "go" : "wait", title: kind === "login" ? "ログイン用の窓を閉じてください" : WAIT_TEXT[kind].badge, detail: `「${roleLabel(active[0]!.role)}」は、${WAIT_TEXT[kind].sentence}${kind === "login" ? "" : "何もしなくて大丈夫です。"}` };
      }
      return { tone: "wait", title: "AI が作業しています", detail: `${doing ? `いまは「${roleLabel(doing.role)}」の作業中です。` : ""}終わるまでこの画面を開いたままで大丈夫です。途中で止めたい・方針を変えたいときは、下のボタンを使います。` };
    }
    case "paused":
      return { tone: "go", title: "一時停止中です", detail: "「再開」を押すと、続きから作業を再開します。やめるときは「中止」を押します。" };
    case "failed":
      return failedAdvice(tasks, failed, ctx.overview?.taskNotes);
    case "completed":
      return {
        tone: "done",
        title: "できあがりました",
        detail: "「動かして確認」で実際に動かして見られます。ほかのフォルダを引き継いだ場合は、ホームの「元のフォルダに反映する」を押すと、変更が元のフォルダに入ります(押すまでは入りません)。続きを頼むときは「新しい依頼」を押します。",
        action: { label: "新しい依頼を出す", run: onNewRequest },
      };
    case "cancelled":
      return { tone: "go", title: "中止しました", detail: "新しい依頼を、下の入力欄から出せます。", action: { label: "新しい依頼を出す", run: onNewRequest } };
    default:
      return { tone: "go", title: "新しい依頼を出せます", detail: "下の入力欄に、やってほしいことを書いてください。" };
  }
}

