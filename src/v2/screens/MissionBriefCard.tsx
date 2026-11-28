import { useState } from "react";
import { api } from "../api";
import type { Ctx } from "../context";
import { usePoll } from "../hooks";
import { missionBrief, requesterLabel } from "../missionBrief";
import type { Mission } from "../types";

type Origins = Record<string, { from: string; depth: number }>;

/** Which requests of the project the app made itself; null until read for this request. */
function useFollowUpOrigins(projectId: string, missionId: string): Origins | null {
  // kept with the request it was read for: a list read for another request may not have this one yet. A failed read keeps what is there.
  const [read, setRead] = useState<{ missionId: string; origins: Origins } | null>(null);
  usePoll(async () => setRead({ missionId, origins: await api.followUpOrigins(projectId) }), 30_000, [projectId, missionId]);
  return read?.missionId === missionId ? read.origins : null;
}

/** "あなたの依頼", or that the app made this one: shown over the request wherever the conversation draws it. */
export function Requester({ mission }: { mission: Mission }) {
  return <>{requesterLabel(useFollowUpOrigins(mission.projectId, mission.id), mission.id)}</>;
}

/** What this request is for, who started it, and the signs that it may not be needed: so the person can tell whether to keep or stop it. */
export function MissionBrief({ ctx, mission, compact = false }: { ctx: Ctx; mission: Mission; compact?: boolean }) {
  const brief = missionBrief(mission, ctx.overview.missions, useFollowUpOrigins(mission.projectId, mission.id));
  return (
    <div className={`rounded-lg border border-borderSoft bg-bg px-3 py-2 text-[12.5px] leading-relaxed ${compact ? "mt-1" : "mt-2"}`}>
      <p><span className="font-semibold text-muted">何の依頼か</span>　{brief.purpose}</p>
      {brief.finish && <p><span className="font-semibold text-muted">終わると</span>　{brief.finish}</p>}
      <p><span className="font-semibold text-muted">出した人</span>　{brief.origin}</p>
      {brief.notes.length > 0 && (
        <ul className="mt-1 space-y-0.5 text-[#8A6212]">
          {brief.notes.map((n) => <li key={n}>・{n}</li>)}
        </ul>
      )}
    </div>
  );
}
