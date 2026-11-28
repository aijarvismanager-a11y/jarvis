import { useState, type ReactNode } from "react";
import type { PastExchange } from "../dock";
import { formatTime, roleLabel, taskStatusLabel, taskTitle } from "../labels";
import { GoalText } from "../ui";
import { Requester } from "./MissionBriefCard";

const SHOWN = 1; // only the exchange just before stays visible (two pushed the current reply off the screen); older ones come in with a button
const STEP = 5;

function Exchange({ item, notes, renderAnswer }: { item: PastExchange; notes?: Record<string, string>; renderAnswer: (taskId: string) => ReactNode }) {
  const [open, setOpen] = useState(false); // answers are read from files, so only when asked for
  const { mission, tasks } = item;
  return (
    <li className="space-y-1.5">
      <div className="ml-auto w-fit max-w-[88%] rounded-2xl rounded-tr-sm bg-[#F3EEE6] px-3.5 py-2">
        <p className="text-[11px] text-muted"><Requester mission={mission} /> ・ {formatTime(mission.createdAt)}</p>
        <GoalText goal={mission.goal} className="break-words text-[13.5px]" />
      </div>
      <div className="w-fit max-w-[88%] rounded-2xl rounded-tl-sm border border-borderSoft bg-white px-3.5 py-2">
        <p className="text-[13px]">
          <span className={mission.status === "failed" ? "font-semibold text-[#9B2C2C]" : "font-semibold"}>{item.result}</span>
          <span className="ml-2 text-muted">{item.did}</span>
        </p>
        {tasks.length > 0 && <button type="button" aria-expanded={open} className="text-[12px] text-accent hover:underline" onClick={() => setOpen(!open)}>{open ? "閉じる" : "中身を見る"}</button>}
        {open && (
          <ul className="mt-1.5 space-y-1.5">
            {tasks.map((t) => (
              <li key={t.id} className="text-[12.5px]">
                {t.status !== "completed" && <span className={`mr-1.5 font-semibold ${t.status === "failed" || t.status === "blocked" ? "text-[#9B2C2C]" : "text-muted"}`}>[{taskStatusLabel(t.status, mission.status, notes?.[t.id])}]</span>}
                <span className="text-muted">{roleLabel(t.role)} / </span>{taskTitle(t.objective)}
                {t.status === "completed" && renderAnswer(t.id)}
              </li>
            ))}
          </ul>
        )}
      </div>
    </li>
  );
}

/** The earlier exchanges, above the current request, so the screen reads as one conversation from top to bottom. */
export function ThreadHistory({ items, notes, renderAnswer }: { items: PastExchange[]; notes?: Record<string, string>; renderAnswer: (taskId: string) => ReactNode }) {
  const [count, setCount] = useState(SHOWN);
  const hidden = Math.max(0, items.length - count);
  return (
    <section aria-label="これまでのやり取り" className="space-y-3">
      {hidden > 0 && (
        <div className="text-center">
          <button type="button" className="text-[12.5px] text-accent hover:underline" onClick={() => setCount(count + STEP)}>↑ もっと前のやり取りを見る(あと{hidden}件)</button>
        </div>
      )}
      <ul className="space-y-3">
        {items.slice(hidden).map((x) => <Exchange key={x.mission.id} item={x} notes={notes} renderAnswer={renderAnswer} />)}
      </ul>
    </section>
  );
}
