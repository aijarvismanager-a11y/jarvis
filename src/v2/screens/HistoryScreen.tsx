import { useState } from "react";
import { api } from "../api";
import type { Ctx } from "../context";
import { MISSION_LABEL, formatTime, progressOf } from "../labels";
import { Badge, Card, Details } from "../ui";
import { usePoll } from "../hooks";
import type { StoredEvent } from "../types";

export function HistoryScreen({ ctx }: { ctx: Ctx }) {
  const [events, setEvents] = useState<StoredEvent[]>([]);
  const projectId = ctx.project?.id;
  usePoll(async () => setEvents(projectId ? [...(await api.events(projectId))].reverse() : []), 5000, [projectId]);

  if (!ctx.project) return <Card>プロジェクトがまだありません。</Card>;
  const missions = [...ctx.overview.missions].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return (
    <div className="space-y-4">
      <Card title="依頼履歴">
        {missions.length === 0 && <p className="text-[13px] text-muted">まだ履歴がありません。</p>}
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
                <p className="mt-1 text-[13px]">{m.goal}</p>
              </li>
            );
          })}
        </ul>
      </Card>
      <Details summary={`操作ログ(${events.length}件)`}>
        <ul className="max-h-80 space-y-0.5 overflow-auto font-mono text-[11.5px]">
          {events.map((e) => (
            <li key={e.id} className="text-muted"><span>{formatTime(e.createdAt)}</span> <span className="text-ink">{e.type}</span></li>
          ))}
        </ul>
      </Details>
    </div>
  );
}
