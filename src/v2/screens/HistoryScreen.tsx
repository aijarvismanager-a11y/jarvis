import { useState } from "react";
import { api } from "../api";
import type { Ctx } from "../context";
import { isRefusedNote, MISSION_LABEL, describeEvent, explainFailure, formatTime, missionFailureReason, progressOf } from "../labels";
import { Badge, Card, Details, GoalText } from "../ui";
import { usePoll } from "../hooks";
import { MissionBrief } from "./MissionBriefCard";
import { PastResult } from "./PastResult";
import type { StoredEvent } from "../types";

/** How many events the server sends at most. */
const EVENT_LIMIT = 200;

export function HistoryScreen({ ctx }: { ctx: Ctx }) {
  const [events, setEvents] = useState<StoredEvent[]>([]);
  const [showAll, setShowAll] = useState(false);
  const projectId = ctx.project?.id;
  const [openId, setOpenId] = useState<string | null>(null);
  // kept oldest first, as the server sends them (the reason of a failure is the newest one); shown newest first
  usePoll(async () => setEvents(projectId ? await api.events(projectId) : []), 5000, [projectId]);
  const shownEvents = events.filter((e) => e.type !== "TASK_STATUS_CHANGED").reverse();

  if (!ctx.project) return <Card title="これまでの記録">プロジェクトがまだありません。「ホーム」で作りたいものを書くと、ここに記録が残ります。</Card>;
  const missions = [...ctx.overview.missions].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return (
    <div className="space-y-4">
      <Card title="これまでに出した依頼(新しい順)">
        {missions.length === 0 && <p className="text-[13px] text-muted">まだ依頼を出していません。「ホーム」から最初の依頼を出すと、ここに残ります。</p>}
        <ul className="divide-y divide-borderSoft">
          {(showAll ? missions : missions.slice(0, 10)).map((m) => {
            const { done, total } = progressOf(ctx.overview.tasks.filter((t) => t.missionId === m.id), m.status === "cancelled");
            return (
              <li key={m.id} className="py-2">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-[11.5px] tabular-nums text-muted">{formatTime(m.createdAt)}</span>
                  <Badge tone={m.status === "completed" ? "ok" : m.status === "failed" ? "bad" : "neutral"}>{MISSION_LABEL[m.status]}</Badge>
                  {total > 0 && (m.status !== "completed" || done < total) && <span className="text-[11px] text-muted">{done}/{total}作業</span>}
                </div>
                <GoalText goal={m.goal} className="mt-1 text-[13px]" />
                {m.status !== "completed" && <MissionBrief ctx={ctx} mission={m} compact />}
                {m.status === "failed" && (ctx.overview.tasks.some((t) => t.missionId === m.id && t.status === "failed" && isRefusedNote(ctx.overview.taskNotes?.[t.id]))
                  ? <p className="mt-1 text-[12px] text-muted">あなたが許可しなかった作業があるため、止まっています。</p>
                  : <p className="mt-1 text-[12px] text-[#9B2C2C]">理由: {explainFailure(missionFailureReason(events, m.id)).what}</p>)}
                {ctx.overview.tasks.some((t) => t.missionId === m.id) && (
                  <>
                    <button type="button" aria-expanded={openId === m.id} className="mt-1 text-[12.5px] text-accent hover:underline" onClick={() => setOpenId(openId === m.id ? null : m.id)}>{openId === m.id ? "結果を閉じる" : "結果を見る"}</button>
                    {openId === m.id && <PastResult ctx={ctx} mission={m} />}
                  </>
                )}
              </li>
            );
          })}
        </ul>
        {missions.length > 10 && <button type="button" className="mt-2 text-[12.5px] text-accent hover:underline" onClick={() => setShowAll(!showAll)}>{showAll ? "古い依頼をたたむ" : `古い依頼もすべて見る(あと${missions.length - 10}件)`}</button>}
      </Card>
      <Details summary={`何が起きたかの履歴(${shownEvents.length}件・困ったときの確認用)`}>
        {events.length >= EVENT_LIMIT && <p className="mb-1 text-[12px] text-muted">新しいものから{EVENT_LIMIT}件までを読み込んでいます。これより古い出来事は、ここには出ません(依頼そのものは、上の一覧にすべて残っています)。</p>}
        {events.length === 0 && <p className="text-[12px] text-muted">まだありません。</p>}
        <ul className="max-h-80 space-y-0.5 overflow-auto text-[12px]">
          {shownEvents.map((e) => (
            <li key={e.id} className="text-muted"><span>{formatTime(e.createdAt)}</span> <span className="text-ink" title={e.type}>{describeEvent(e)}</span></li>
          ))}
        </ul>
      </Details>
    </div>
  );
}
