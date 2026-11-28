import { useState } from "react";
import { api } from "../api";
import { Button } from "../ui";
import { explainFailure, missionFailureReason } from "../labels";
import { usePoll } from "../hooks";

/** Why a mission failed, read from the project's event log. Renders nothing unless the mission failed. */
export function FailureReason({ projectId, missionId, failed, refused = false, quiet = false, causes = [], onOpenHome, className = "" }: { projectId: string; missionId: string; failed: boolean; refused?: boolean; quiet?: boolean; /** the failed tasks' own reasons */ causes?: string[]; /** given on a screen without the retry button: a way to it */ onOpenHome?: () => void; className?: string }) {
  const [reason, setReason] = useState<string | null | undefined>(undefined);
  usePoll(async () => {
    if (failed) setReason(missionFailureReason(await api.events(projectId), missionId));
  }, 15000, [projectId, missionId, failed]);
  if (!failed) return null;
  // the person said no to a permission: not a failure to explain (nothing broke), only a stop they chose
  if (refused) {
    return (
      <div className={`rounded-lg border border-borderSoft bg-bg px-3 py-2 ${className}`}>
        <p className="text-[12px] font-semibold">止まっている理由</p>
        <p className="mt-0.5 text-[13px]">あなたが許可しなかった作業があるため、依頼がここで止まっています。</p>
        <p className="mt-1 text-[12px] text-[#4a473f]">続けたいときだけ、{onOpenHome ? "ホームの" : "上の"}「この作業をやり直す」を押すと、もう一度許可を聞きます。やめるときは、何もしなくて大丈夫です。</p>
        {onOpenHome && <div className="mt-2"><Button variant="ghost" onClick={onOpenHome}>ホームを開く</Button></div>}
      </div>
    );
  }
  if (reason === undefined) return null;
  const { what, hint } = explainFailure(reason);
  return (
    <div className={`rounded-lg border border-[#E7C4C4] bg-[#FBEFEF] px-3 py-2 ${className}`} role="alert">
      <p className="text-[12px] font-semibold text-[#9B2C2C]">失敗の理由</p>
      <p className="mt-0.5 break-words text-[13px] text-[#9B2C2C]">{what}</p>
      {causes.map((c) => <p key={c} className="mt-0.5 break-words text-[13px] text-[#9B2C2C]">{c}</p>)}
      {!quiet && !hint.startsWith("いちばん上の") && <p className="mt-1 text-[12px] text-[#4a473f]">{hint}</p>}
      {onOpenHome && <div className="mt-2"><Button onClick={onOpenHome}>ホームを開いてやり直す</Button></div>}
    </div>
  );
}
