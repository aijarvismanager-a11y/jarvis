import { useState } from "react";
import { api } from "../api";
import type { Ctx } from "../context";
import { MISSION_LABEL, describeEvent, explainFailure, formatTime, missionFailureReason, progressOf } from "../labels";
import { Badge, Card, Details, GoalText } from "../ui";
import { usePoll } from "../hooks";
import type { StoredEvent } from "../types";

export function HistoryScreen({ ctx }: { ctx: Ctx }) {
  const [events, setEvents] = useState<StoredEvent[]>([]);
  const projectId = ctx.project?.id;
  usePoll(async () => setEvents(projectId ? [...(await api.events(projectId))].reverse() : []), 5000, [projectId]);

  if (!ctx.project) return <Card title="これまでの記録">プロジェクトがまだありません。「ホーム」で作りたいものを書くと、ここに記録が残ります。</Card>;
  const missions = [...ctx.overview.missions].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return (
    <div className="space-y-4">
      <Card title="これまでに出した依頼(新しい順)">
        {missions.length === 0 && <p className="text-[13px] text-muted">まだ依頼を出していません。「ホーム」から最初の依頼を出すと、ここに残ります。</p>}
        <ul className="space-y-2">
          {missions.map((m) => {
            const { done, total } = progressOf(ctx.overview.tasks.filter((t) => t.missionId === m.id));
            return (
              <li key={m.id} className="rounded-lg border border-borderSoft bg-bg px-3 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={m.status === "completed" ? "ok" : m.status === "failed" ? "bad" : "neutral"}>{MISSION_LABEL[m.status]}</Badge>
                  <span className="text-[11px] text-muted">{formatTime(m.createdAt)}</span>
                  {total > 0 && <span className="text-[11px] text-muted">{done}/{total}作業完了</span>}
                </div>
                <GoalText goal={m.goal} className="mt-1 text-[13px]" />
                {m.status === "failed" && <p className="mt-1 text-[12px] text-[#9B2C2C]">理由: {explainFailure(missionFailureReason(events, m.id)).what}</p>}
              </li>
            );
          })}
        </ul>
      </Card>
      <Details summary={`何が起きたかの履歴(${events.filter((e) => e.type !== "TASK_STATUS_CHANGED").length}件・困ったときの確認用)`}>
        {events.length === 0 && <p className="text-[12px] text-muted">まだありません。</p>}
        <ul className="max-h-80 space-y-0.5 overflow-auto text-[12px]">
          {events.filter((e) => e.type !== "TASK_STATUS_CHANGED").map((e) => (
            <li key={e.id} className="text-muted"><span>{formatTime(e.createdAt)}</span> <span className="text-ink" title={e.type}>{describeEvent(e)}</span></li>
          ))}
        </ul>
      </Details>
    </div>
  );
}
