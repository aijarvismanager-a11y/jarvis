import { useState } from "react";
import { aiNameOf, type Ctx } from "../context";
import { LEVEL_LABEL, MISSION_LABEL, RUN_STATUS_LABEL, TASK_LABEL_PLAIN, formatCost, formatDuration, formatTime, progressOf, roleLabel, shortGoal } from "../labels";
import { Badge, Card, Details, GoalText } from "../ui";
import type { Task, TaskStatus } from "../types";
import { FailureReason } from "./FailureReason";
import { api } from "../api";
import { usePoll } from "../hooks";
import { explainSelection, type SelectionWhy } from "../selection";
import type { StoredEvent } from "../types";

const TONE: Record<TaskStatus, "neutral" | "ok" | "warn" | "bad" | "info"> = {
  pending: "neutral",
  ready: "neutral",
  running: "info",
  waiting: "warn",
  validation: "info",
  completed: "ok",
  failed: "bad",
  blocked: "bad",
  cancelled: "neutral",
  paused: "warn",
};

function TaskRow({ task, ctx, label, why }: { task: Task; ctx: Ctx; label: (id: string) => string; why: SelectionWhy | null }) {
  const [open, setOpen] = useState(task.status === "failed" || task.status === "running" || task.status === "waiting");
  const runs = ctx.overview.aiRuns.filter((r) => r.task_id === task.id);
  const outputs = ctx.overview.artifacts.filter((a) => a.taskId === task.id);
  return (
    <li className="rounded-lg border border-borderSoft bg-bg">
      <button onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full flex-wrap items-center gap-x-2 gap-y-0.5 px-3 py-2 text-left">
        <span className="text-muted">{open ? "▾" : "▸"}</span>
        <span className="text-[13px] font-semibold">{roleLabel(task.role)}</span>
        <Badge tone={TONE[task.status]}>{TASK_LABEL_PLAIN[task.status]}</Badge>
        {task.retryCount > 0 && <span className="text-[11px] text-muted">再試行 {task.retryCount}回</span>}
        <span className="ml-auto text-[12px] text-muted">{task.selectedAi || !["pending", "ready", "blocked"].includes(task.status) ? aiNameOf(ctx.services, task.selectedAi) : "担当は始めるときに決まります"}</span>
        <span className="w-full pl-5 text-[12px] leading-snug text-muted">{shortGoal(task.objective).head}</span>
      </button>
      {open && (
        <div className="space-y-2 border-t border-borderSoft px-3 py-2 text-[12.5px]">
          <p>{task.objective}</p>
          {task.selectedAi && (
            <div className="rounded-lg border border-borderSoft bg-panel px-2.5 py-1.5">
              <p className="font-semibold">なぜこのAI?</p>
              {why ? (
                <>
                  <p>{why.headline}</p>
                  <Details summary="くわしい理由">
                    <ul className="list-disc space-y-0.5 pl-5 text-[12px] text-muted">
                      {why.lines.map((l) => <li key={l}>{l}</li>)}
                    </ul>
                  </Details>
                </>
              ) : (
                <p className="text-muted">選んだ理由の記録はありません(AIを直接指定した作業や、以前の版で動かした作業です)。</p>
              )}
            </div>
          )}
          {(() => {
            // AI B Review: a second AI of another maker checked this task (see the settings)
            const review = runs.filter((r) => r.executor === "ai-review").pop();
            return review ? <p className="rounded-lg border border-borderSoft bg-panel px-2.5 py-1.5"><span className="mr-1.5 font-semibold">別のAIの追加レビュー</span>{review.summary?.replace(/^追加レビュー/, "")}</p> : null;
          })()}
          {task.dependsOn.length > 0 && <p className="text-muted">先に必要: {task.dependsOn.map(label).join("、")}</p>}
          {outputs.length > 0 && (
            <ul>
              {outputs.map((a) => (
                <li key={a.id}>
                  <button onClick={() => ctx.openArtifact(a)} className="text-accent hover:underline">{a.path}</button>
                  <span className="ml-2 text-muted">v{a.version}</span>
                </li>
              ))}
            </ul>
          )}
          <Details summary="くわしい情報(ふだんは見なくて大丈夫です)">
            <dl className="grid grid-cols-[6rem_1fr] gap-y-1 text-[12px]">
              <dt className="text-muted">使用AI</dt><dd>{aiNameOf(ctx.services, task.selectedAi)}</dd>
              <dt className="text-muted">自動化レベル</dt><dd>{LEVEL_LABEL[task.automationLevel] ?? task.automationLevel}</dd>
              <dt className="text-muted">期待する成果物</dt><dd className="break-all">{task.expectedOutputs.join("、") || "なし"}</dd>
            </dl>
            {runs.length > 0 && (
              <ul className="mt-2 space-y-1 text-[12px]">
                {runs.map((r) => (
                  <li key={r.id} className="text-muted">
                    {formatTime(r.started_at)} · {r.executor === "ai-review" ? "追加レビュー" : r.executor} · {LEVEL_LABEL[r.automation_level] ?? r.automation_level} · {RUN_STATUS_LABEL[r.status] ?? r.status}{r.duration_ms != null && ` · ${formatDuration(r.duration_ms)}`}{r.cost_usd != null && ` · ${formatCost(r.cost_usd)}`}
                    {r.summary && <span className="block whitespace-pre-wrap text-ink">{r.summary.slice(0, 400)}</span>}
                  </li>
                ))}
              </ul>
            )}
            {task.validation != null && <pre aria-label="検証結果" className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-[11.5px]">{JSON.stringify(task.validation, null, 2)}</pre>}
          </Details>
        </div>
      )}
    </li>
  );
}

/** One sentence on where the request stands, so the screen can be read without opening any row. */
export function summaryLine(tasks: Task[], ctx: Ctx, resting = false): string {
  const by = (st: TaskStatus) => tasks.filter((t) => t.status === st);
  const failed = [...by("failed"), ...by("blocked")];
  if (failed.length > 0) return `うまくいかなかった作業が${failed.length}件あります。下の赤い印の作業を開くと理由が見られます(ホームの「次にやること」にも出ます)。`;
  const waiting = by("waiting");
  if (waiting.length > 0) return `「${roleLabel(waiting[0].role)}」があなたの操作を待っています。ホームの「次にやること」を見てください。`;
  const running = by("running");
  if (running.length > 0 && resting) return `「${roleLabel(running[0].role)}」は、使えるAIが戻るのを待っています(自動で再開します)。`;
  if (running.length > 0) return `いま「${roleLabel(running[0].role)}」を ${aiNameOf(ctx.services, running[0].selectedAi)} が進めています。`;
  if (tasks.length > 0 && tasks.every((t) => t.status === "completed" || t.status === "cancelled")) return "すべての作業が終わりました。「できたもの」で結果を読めます。";
  return "次の作業の開始を待っています。";
}

export function DevelopmentScreen({ ctx }: { ctx: Ctx }) {
  // why each task has its AI: the selection events of the whole request (the history list only keeps the latest ones)
  const [selections, setSelections] = useState<StoredEvent[]>([]);
  const missionProject = ctx.mission?.projectId;
  usePoll(async () => setSelections(missionProject ? await api.aiSelections(missionProject) : []), 6000, [missionProject, ctx.mission?.id]);
  const tasks = ctx.mission ? ctx.overview.tasks.filter((t) => t.missionId === ctx.mission!.id).sort((a, b) => a.position - b.position) : [];
  const names = new Map(tasks.map((t) => [t.id, roleLabel(t.role)]));
  if (!ctx.mission) return <Card title="進み具合">まだ依頼がありません。「ホーム」で作りたいものを書いて「開発を開始」を押すと、ここに進み具合が出ます。</Card>;
  const { done, total, percent } = progressOf(tasks);
  return (
    <div className="space-y-4">
      <Card title="いまの依頼">
        <GoalText goal={ctx.mission.goal} className="text-[14px] font-semibold" />
        <p className="mt-1 text-[12px] text-muted">状態: {MISSION_LABEL[ctx.mission.status]}{total > 0 && ` · ${total}件の作業のうち ${done}件が完了`}</p>
        {total > 0 && (
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-sidebar" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label="全体の進み具合">
            <div className="h-full bg-accent transition-all" style={{ width: `${percent}%` }} />
          </div>
        )}
        {total > 0 && <p className="mt-3 text-[13px]">{summaryLine(tasks, ctx)}</p>}
        <FailureReason projectId={ctx.mission.projectId} missionId={ctx.mission.id} failed={ctx.mission.status === "failed"} className="mt-3" />
      </Card>
      <Card title="作業の一覧(上から順に進みます)">
        {tasks.length === 0 ? (
          <p className="text-[13px] text-muted">{ctx.mission.status === "planning" ? "計画の承認待ちです。ホームで計画を読んで「この計画で開始」を押すと、作業がここに並びます。" : ctx.mission.status === "failed" || ctx.mission.status === "cancelled" ? "この依頼は、作業が始まる前に終わりました。理由は上の「いまの依頼」に出ています。やり直すときは「ホーム」で「計画をやり直す」か「新しい依頼」を使ってください。" : "計画を承認すると、作業がここに並びます。"}</p>
        ) : (
          <>
            <p className="mb-2 text-[12px] text-muted">各行を押すと、その作業の内容と、できたファイルが見られます。</p>
            <ul className="space-y-2">
              {tasks.map((t) => <TaskRow key={t.id} task={t} ctx={ctx} label={(id) => names.get(id) ?? id} why={explainSelection(selections, t.id, ctx.services)} />)}
            </ul>
          </>
        )}
      </Card>
    </div>
  );
}
