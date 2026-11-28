import { useState } from "react";
import { api } from "../api";
import { MISSION_LABEL, formatTime, shortGoal } from "../labels";
import { usePoll } from "../hooks";
import { Badge, Button, Card, GoalText } from "../ui";
import type { ProjectSummary } from "../types";
import { IDLE_DAYS, idleProjects } from "../idleProjects";
import { waitingLabel, type Waiting } from "../waitingElsewhere";

/** Every project on one page: its newest request, how many requests and files it has, and when it last changed. */
export function ProjectsScreen({ currentId, waiting = {}, onOpen }: { currentId: string | null; waiting?: Record<string, Waiting>; onOpen: (projectId: string, screen: "mission" | "history" | "artifacts") => void }) {
  const [rows, setRows] = useState<ProjectSummary[] | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [error, setError] = useState<{ projectId: string; text: string } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const reload = usePoll(async () => setRows(await api.projectsSummary()), 5000, []);
  const archive = async (id: string, archived: boolean) => {
    setError(null);
    try {
      await api.archiveProject(id, archived);
      reload();
    } catch (e) {
      setError({ projectId: id, text: e instanceof Error ? e.message : "しまえませんでした" });
    }
  };
  if (!rows) return <p className="text-[13px] text-muted">読み込み中…</p>;
  if (rows.length === 0) return <Card title="プロジェクト一覧">プロジェクトがまだありません。「ホーム」で作りたいものを書くと、ここに並びます。</Card>;
  const cancelOpen = async (projectId: string, missionId: string) => {
    setError(null);
    try {
      await api.missionAction(projectId, missionId, "cancel");
      reload();
    } catch (e) {
      setError({ projectId, text: e instanceof Error ? e.message : "中止できませんでした" });
    }
  };
  const idle = idleProjects(rows, currentId);
  const archiveIdle = async () => {
    setError(null);
    setNote(null);
    let done = 0;
    const skipped: string[] = [];
    for (const r of idle) {
      try {
        await api.archiveProject(r.project.id, true);
        done++;
      } catch {
        skipped.push(r.project.name); // e.g. an older request of it still says "running"
      }
    }
    setNote(`${done}件をしまいました。「しまったプロジェクトも表示する」から、いつでも戻せます。${skipped.length ? `「${skipped.join("」「")}」は、実行中の依頼が残っているため、しまえませんでした。` : ""}`);
    reload();
  };
  const archivedCount = rows.filter((r) => r.project.status === "archived").length;
  const shown = showArchived ? rows : rows.filter((r) => r.project.status !== "archived");
  return (
    <Card title={`プロジェクト一覧(${shown.length}件・最近動いた順)`}>
      {archivedCount > 0 && (
        <label className="mb-2 flex items-center gap-2 text-[12px] text-muted">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          しまったプロジェクトも表示する({archivedCount}件)
        </label>
      )}
      {idle.length > 0 && (
        <div className="mb-2 flex flex-wrap items-center gap-2 text-[12px] text-muted">
          <Button variant="ghost" onClick={() => void archiveIdle()}>動いていない{idle.length}件をまとめてしまう</Button>
          <span>完了・中止・失敗で、{IDLE_DAYS}日以上動いていないものだけです(消えません)</span>
        </div>
      )}
      {note && <p className="mb-2 text-[12px] text-muted">{note}</p>}
      <ul className="space-y-2">
        {shown.map((r) => (
          <li key={r.project.id} className={`rounded-lg border px-3 py-2 ${r.project.id === currentId ? "border-accent bg-bg" : "border-borderSoft bg-bg"}`}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-[14px]">{r.project.name}</span>
              {r.project.id === currentId && <Badge tone="info">いま開いている</Badge>}
              {r.project.status === "archived" && <Badge tone="neutral">しまってある</Badge>}
              {waiting[r.project.id] && <Badge tone="warn">{waitingLabel(waiting[r.project.id])}</Badge>}
              {r.latestMission && <Badge tone={r.latestMission.status === "completed" ? "ok" : r.latestMission.status === "failed" ? "bad" : r.latestMission.status === "running" ? "info" : "neutral"}>{MISSION_LABEL[r.latestMission.status]}</Badge>}
              <span className="ml-auto text-[11px] text-muted">最後の動き {formatTime(r.lastActivityAt)}</span>
            </div>
            {r.latestMission ? <GoalText goal={r.latestMission.goal} className="mt-1 text-[13px]" /> : <p className="mt-1 text-[13px]">まだ依頼がありません。</p>}
            {r.openMissions.filter((m) => Date.now() - Date.parse(m.updatedAt) >= 86_400_000).map((m) => (
              <div key={m.id} className="mt-1 flex flex-wrap items-center gap-2 rounded-md bg-[#FBF1DC] px-2 py-1 text-[12px] text-[#8A6212]">
                <span>「{shortGoal(m.goal).head}」が、{Math.floor((Date.now() - Date.parse(m.updatedAt)) / 86_400_000)}日前から{m.status === "planning" ? "計画の段階" : "実行中"}のまま止まっています。このままだと、このプロジェクトはしまえません。</span>
                <Button variant="ghost" onClick={() => void cancelOpen(r.project.id, m.id)}>この依頼を中止する</Button>
              </div>
            ))}
            <p className="mt-1 text-[12px] text-muted">依頼 {r.missionCount}件 · できたもの {r.artifactCount}件</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {waiting[r.project.id] ? (
                <Button onClick={() => onOpen(r.project.id, "mission")}>開いて確認する</Button>
              ) : (
                <Button variant="ghost" onClick={() => onOpen(r.project.id, "mission")}>ホームで開く</Button>
              )}
              <Button variant="ghost" onClick={() => onOpen(r.project.id, "history")}>これまでの記録</Button>
              <Button variant="ghost" disabled={r.artifactCount === 0} onClick={() => onOpen(r.project.id, "artifacts")}>できたもの</Button>
              {r.project.status === "archived" ? (
                <Button variant="ghost" onClick={() => archive(r.project.id, false)}>もとに戻す</Button>
              ) : r.openMissions.length > 0 ? (
                <span className="self-center text-[11px] text-muted">終わっていない依頼があるため、しまえません(終わるか中止するとしまえます)</span>
              ) : (
                r.project.id === currentId ? (
                <span className="self-center text-[11px] text-muted">いま開いているため、しまえません(ほかを開くとしまえます)</span>
              ) : (
                <Button variant="ghost" title="一覧から隠します(消えません)" onClick={() => archive(r.project.id, true)}>しまう</Button>
              )
              )}
            </div>
            {error?.projectId === r.project.id && <p role="alert" className="mt-1 text-[12px] text-[#9B2C2C]">{error.text}</p>}
          </li>
        ))}
      </ul>
    </Card>
  );
}
