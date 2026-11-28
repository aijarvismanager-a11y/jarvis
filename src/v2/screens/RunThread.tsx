import type { ReactNode } from "react";
import { runThread } from "../dock";
import { TASK_LABEL, elapsedSince, isRefusedNote, roleLabel, taskTitle, WAIT_TEXT } from "../labels";
import type { Task, TaskWait } from "../types";

const SAID: Partial<Record<Task["status"], string>> = { completed: "が終わりました", failed: "は、うまくいきませんでした", blocked: "は、進められません", cancelled: "は、新しい計画で置き換えました" }; // this thread is only shown while the request goes on
const DOING: Partial<Record<Task["status"], string>> = { running: "を進めています", validation: "の結果をチェックしています", waiting: "は、あなたの操作を待っています", paused: "は、一時停止しています" };

function Bubble({ task, no, line, side, renderTitle, children }: { task: Task; no: number; line: string; side?: string; renderTitle: (t: Task) => ReactNode; children: ReactNode }) {
  const bad = task.status === "failed" || task.status === "blocked";
  const now = !!DOING[task.status];
  return (
    <li className={`max-w-[94%] rounded-2xl rounded-tl-sm border px-3.5 py-2.5 ${now ? "border-accent/50 bg-white" : "border-borderSoft bg-white"}`}>
      <p className="flex flex-wrap items-baseline gap-x-2 text-[13px]">
        <span className={`font-semibold ${bad ? "text-[#9B2C2C]" : task.status === "cancelled" ? "text-muted" : ""}`}>作業{no}({roleLabel(task.role)}){line}</span>
        {side && <span className="text-[11.5px] text-muted">{side}</span>}
      </p>
      <div className="mt-0.5 text-[13px]">{renderTitle(task)}</div>
      <div className="[&>div]:ml-0 [&>p]:ml-0">{children}</div>
    </li>
  );
}

/**
 * The running request as messages that arrive one after another: what has finished (in the order it finished), what is
 * being done now, and one short line for what comes after.
 */
export function RunThread({ tasks, asked, notes, waits, renderTitle, renderDetail, timeOf }: {
  tasks: Task[];
  /** ids of the tasks that wait for the person's permission */
  asked: string[];
  notes?: Record<string, string>;
  waits?: Record<string, TaskWait>;
  renderTitle: (t: Task) => ReactNode;
  renderDetail: (t: Task) => ReactNode;
  timeOf: (taskId: string) => string;
}) {
  const { said, now, next } = runThread(tasks);
  const no = (t: Task) => tasks.indexOf(t) + 1;
  return (
    <section aria-label="作業の流れ" className="mt-3 space-y-2">
      <ul className="space-y-2">
        {said.map((t) => <Bubble key={t.id} task={t} no={no(t)} line={t.status === "failed" && isRefusedNote(notes?.[t.id]) ? "は、許可しなかったため行っていません" : SAID[t.status] ?? `: ${TASK_LABEL[t.status]}`} side={timeOf(t.id)} renderTitle={renderTitle}>{renderDetail(t)}</Bubble>)}
        {now.map((t) => <Bubble key={t.id} task={t} no={no(t)} line={asked.includes(t.id) ? "は、あなたの許可を待っています" : waits?.[t.id] ? WAIT_TEXT[waits[t.id]!].line : DOING[t.status] ?? `: ${TASK_LABEL[t.status]}`} side={!asked.includes(t.id) && !waits?.[t.id] && (t.status === "running" || t.status === "validation") ? elapsedSince(t.updatedAt) : ""} renderTitle={renderTitle}>{renderDetail(t)}</Bubble>)}
      </ul>
      {next.length > 0 && (
        <details className="text-[12.5px] text-muted">
          <summary className="cursor-pointer">このあと{next.length}件(次は「{taskTitle(next[0]!.objective)}」)</summary>
          <ul className="mt-1 space-y-0.5 pl-4">
            {next.map((t) => <li key={t.id}>作業{no(t)}({roleLabel(t.role)}){renderTitle(t)}</li>)}
          </ul>
        </details>
      )}
    </section>
  );
}
