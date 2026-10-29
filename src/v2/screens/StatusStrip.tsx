import { aiNameOf, type Ctx } from "../context";
import { MISSION_LABEL, isActiveMission, progressOf, roleLabel, goalText } from "../labels";

/** A slim line under the tabs: where the running request stands, so other screens need not be left to check. */
export function StatusStrip({ ctx, onOpen }: { ctx: Ctx; onOpen: () => void }) {
  const { mission } = ctx;
  if (!mission || !isActiveMission(mission) || mission.status === "draft") return null;
  const tasks = ctx.overview.tasks.filter((t) => t.missionId === mission.id);
  const { done, total, percent } = progressOf(tasks);
  const doing = tasks.find((t) => t.status === "running" || t.status === "validation" || t.status === "waiting");
  const now = doing ? `${aiNameOf(ctx.services, doing.selectedAi)} が${roleLabel(doing.role)}${doing.status === "waiting" ? "の回答待ち" : "中"}` : MISSION_LABEL[mission.status];
  return (
    <button onClick={onOpen} className="flex w-full items-center gap-3 border-t border-border bg-panel px-4 py-1.5 text-left text-[12.5px] hover:bg-sidebar" title="ホームで詳しく見る">
      <span className="shrink-0 font-semibold">進行中</span>
      <span className="min-w-0 flex-1 truncate">{goalText(mission.goal)} — {now}</span>
      {total > 0 && (
        <>
          <span className="h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-sidebar" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
            <span className="block h-full bg-accent transition-all" style={{ width: `${percent}%` }} />
          </span>
          <span className="shrink-0 text-muted">{percent}%({done}/{total})</span>
        </>
      )}
    </button>
  );
}
