import { useState } from "react";
import { api } from "../api";
import type { Ctx } from "../context";
import { usePoll } from "../hooks";
import { missionBrief } from "../missionBrief";
import type { Mission } from "../types";

type Origins = Record<string, { from: string; depth: number }>;

/** What this request is for, who started it, and the signs that it may not be needed: so the person can tell whether to keep or stop it. */
export function MissionBrief({ ctx, mission, compact = false }: { ctx: Ctx; mission: Mission; compact?: boolean }) {
  // kept with the request it was read for: a list read for another request may not have this one yet. A failed read keeps what is there.
  const [read, setRead] = useState<{ missionId: string; origins: Origins } | null>(null);
  const { id: missionId, projectId } = mission;
  usePoll(async () => setRead({ missionId, origins: await api.followUpOrigins(projectId) }), 30_000, [projectId, missionId]);
  const brief = missionBrief(mission, ctx.overview.missions, read?.missionId === missionId ? read.origins : null);
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
