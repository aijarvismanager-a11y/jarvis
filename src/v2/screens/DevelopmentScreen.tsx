import { useState } from "react";
import { aiNameOf, type Ctx } from "../context";
import { LEVEL_LABEL, TASK_LABEL, formatTime, roleLabel } from "../labels";
import { Badge, Card, Details } from "../ui";
import type { Task, TaskStatus } from "../types";

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

function TaskRow({ task, ctx, label }: { task: Task; ctx: Ctx; label: (id: string) => string }) {
  const [open, setOpen] = useState(task.status === "failed" || task.status === "running" || task.status === "waiting");
  const runs = ctx.overview.aiRuns.filter((r) => r.task_id === task.id);
  const outputs = ctx.overview.artifacts.filter((a) => a.taskId === task.id);
  return (
    <li className="rounded-lg border border-borderSoft bg-bg">
      <button onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-center gap-2 px-3 py-2 text-left">
        <span className="text-muted">{open ? "▾" : "▸"}</span>
        <span className="text-[13px] font-semibold">{roleLabel(task.role)}</span>
        <Badge tone={TONE[task.status]}>{TASK_LABEL[task.status]}</Badge>
        {task.retryCount > 0 && <span className="text-[11px] text-muted">再試行 {task.retryCount}回</span>}
        <span className="ml-auto text-[12px] text-muted">{aiNameOf(ctx.services, task.selectedAi)}</span>
      </button>
      {open && (
        <div className="space-y-2 border-t border-borderSoft px-3 py-2 text-[12.5px]">
          <p>{task.objective}</p>
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
          <Details summary="AIの詳細">
            <dl className="grid grid-cols-[6rem_1fr] gap-y-1 text-[12px]">
              <dt className="text-muted">使用AI</dt><dd>{aiNameOf(ctx.services, task.selectedAi)}</dd>
              <dt className="text-muted">自動化レベル</dt><dd>{LEVEL_LABEL[task.automationLevel] ?? task.automationLevel}</dd>
              <dt className="text-muted">期待する成果物</dt><dd className="break-all">{task.expectedOutputs.join("、") || "なし"}</dd>
            </dl>
            {runs.length > 0 && (
              <ul className="mt-2 space-y-1 text-[12px]">
                {runs.map((r) => (
                  <li key={r.id} className="text-muted">
                    {formatTime(r.started_at)} · {r.executor} · Level {r.automation_level} · {r.status}
                    {r.summary && <span className="block whitespace-pre-wrap text-ink">{r.summary.slice(0, 400)}</span>}
                  </li>
                ))}
              </ul>
            )}
            {task.validation != null && <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-[11.5px]">{JSON.stringify(task.validation, null, 2)}</pre>}
          </Details>
        </div>
      )}
    </li>
  );
}

export function DevelopmentScreen({ ctx }: { ctx: Ctx }) {
  const tasks = ctx.mission ? ctx.overview.tasks.filter((t) => t.missionId === ctx.mission!.id).sort((a, b) => a.position - b.position) : [];
  const names = new Map(tasks.map((t) => [t.id, roleLabel(t.role)]));
  if (!ctx.mission) return <Card>まだミッションがありません。「Mission」画面で開発を開始してください。</Card>;
  return (
    <Card title="開発の進行状況">
      {tasks.length === 0 ? (
        <p className="text-[13px] text-muted">計画の承認後にタスクが表示されます。</p>
      ) : (
        <ul className="space-y-2">
          {tasks.map((t) => <TaskRow key={t.id} task={t} ctx={ctx} label={(id) => names.get(id) ?? id} />)}
        </ul>
      )}
    </Card>
  );
}
