import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api } from "../api";
import type { Ctx } from "../context";
import { replySummary } from "../dock";
import { roleLabel, taskStatusLabel, taskTitle } from "../labels";
import type { Artifact, Mission } from "../types";
import { TaskAnswer } from "./MissionScreen";

/** The newest version of each file the request's tasks made. */
function filesOfMission(artifacts: Artifact[], taskIds: Set<string>): Artifact[] {
  const byPath = new Map<string, Artifact>();
  for (const a of artifacts) if (a.taskId && taskIds.has(a.taskId) && (byPath.get(a.path)?.version ?? -1) < a.version) byPath.set(a.path, a);
  return [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
}

function Report({ projectId, missionId }: { projectId: string; missionId: string }) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    api.missionReport(projectId, missionId).then((r) => alive && setText(r.markdown)).catch(() => alive && setText("完了レポートを読めませんでした。画面を開き直して、もう一度試してください。"));
    return () => { alive = false; };
  }, [projectId, missionId]);
  return text === null ? <p className="text-[12px] text-muted">読み込み中…</p> : <div className="prose-artifact max-h-96 overflow-auto text-[12.5px]"><ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown></div>;
}

/** What came of one past request: its answers, its files and its report, to read (nothing here changes anything). */
export function PastResult({ ctx, mission }: { ctx: Ctx; mission: Mission }) {
  const [report, setReport] = useState(false); // read from the server only when asked for
  const tasks = ctx.overview.tasks.filter((t) => t.missionId === mission.id).sort((a, b) => a.position - b.position);
  const files = filesOfMission(ctx.overview.artifacts, new Set(tasks.map((t) => t.id)));
  return (
    <div className="mt-2 space-y-2 rounded-lg border border-borderSoft bg-bg px-3 py-2 text-[12.5px]">
      <p className="font-semibold">{replySummary(tasks, mission.status, 0, ctx.overview.taskNotes).did}</p>
      <ul className="space-y-1.5">
        {tasks.map((t) => (
          <li key={t.id}>
            {t.status !== "completed" && <span className="mr-1.5 font-semibold text-muted">[{taskStatusLabel(t.status, mission.status, ctx.overview.taskNotes?.[t.id])}]</span>}
            <span className="text-muted">{roleLabel(t.role)} / </span>{taskTitle(t.objective)}
            {t.status === "completed" && <TaskAnswer taskId={t.id} ctx={ctx} />}
          </li>
        ))}
      </ul>
      {files.length > 0 && (
        <div>
          <p className="font-semibold">この依頼で作った・変えたファイル({files.length}件)</p>
          <ul className="mt-0.5">
            {files.map((a) => <li key={a.path}><button type="button" className="break-all text-left text-accent hover:underline" onClick={() => ctx.openArtifact(a)}>{a.path}</button></li>)}
          </ul>
        </div>
      )}
      {["completed", "failed", "cancelled"].includes(mission.status) ? <div>
        <button type="button" aria-expanded={report} className="text-accent hover:underline" onClick={() => setReport(!report)}>{report ? "完了レポートを閉じる" : "完了レポートを読む"}</button>
        {report && (
          <div className="mt-1">
            <p className="mb-1 text-[11.5px] text-muted">読むためだけの表示です。やることのボタンは、ホームにあります。</p>
            <Report projectId={mission.projectId} missionId={mission.id} />
          </div>
        )}
      </div> : <p className="text-muted">まだ終わっていません。いまの進み具合は、ホームで確認できます。</p>}
    </div>
  );
}
