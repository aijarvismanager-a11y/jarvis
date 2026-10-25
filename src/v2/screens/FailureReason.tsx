import { useState } from "react";
import { api } from "../api";
import { explainFailure, missionFailureReason } from "../labels";
import { usePoll } from "../hooks";

/** Why a mission failed, read from the project's event log. Renders nothing unless the mission failed. */
export function FailureReason({ projectId, missionId, failed, className = "" }: { projectId: string; missionId: string; failed: boolean; className?: string }) {
  const [reason, setReason] = useState<string | null | undefined>(undefined);
  usePoll(async () => {
    if (failed) setReason(missionFailureReason(await api.events(projectId), missionId));
  }, 15000, [projectId, missionId, failed]);
  if (!failed || reason === undefined) return null;
  const { what, hint } = explainFailure(reason);
  return (
    <div className={`rounded-lg border border-[#E7C4C4] bg-[#FBEFEF] px-3 py-2 ${className}`} role="alert">
      <p className="text-[12px] font-semibold text-[#9B2C2C]">失敗の理由</p>
      <p className="mt-0.5 break-words text-[13px] text-[#9B2C2C]">{what}</p>
      <p className="mt-1 text-[12px] text-[#4a473f]">{hint}</p>
    </div>
  );
}
