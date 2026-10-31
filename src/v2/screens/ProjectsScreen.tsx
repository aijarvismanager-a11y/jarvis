import { useState } from "react";
import { api } from "../api";
import { MISSION_LABEL, formatTime } from "../labels";
import { usePoll } from "../hooks";
import { Badge, Button, Card, GoalText } from "../ui";
import type { ProjectSummary } from "../types";

/** Every project on one page: its newest request, how many requests and files it has, and when it last changed. */
export function ProjectsScreen({ currentId, onOpen }: { currentId: string | null; onOpen: (projectId: string, screen: "mission" | "history" | "artifacts") => void }) {
  const [rows, setRows] = useState<ProjectSummary[] | null>(null);
  usePoll(async () => setRows(await api.projectsSummary()), 5000, []);
  if (!rows) return <p className="text-[13px] text-muted">読み込み中…</p>;
  if (rows.length === 0) return <Card title="プロジェクト一覧">プロジェクトがまだありません。「ホーム」で作りたいものを書くと、ここに並びます。</Card>;
  return (
    <Card title={`プロジェクト一覧(${rows.length}件・最近動いた順)`}>
      <ul className="space-y-2">
        {rows.map((r) => (
          <li key={r.project.id} className={`rounded-lg border px-3 py-2 ${r.project.id === currentId ? "border-accent bg-bg" : "border-borderSoft bg-bg"}`}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-[14px]">{r.project.name}</span>
              {r.project.id === currentId && <Badge tone="info">いま開いている</Badge>}
              {r.latestMission && <Badge tone={r.latestMission.status === "completed" ? "ok" : r.latestMission.status === "failed" ? "bad" : r.latestMission.status === "running" ? "info" : "neutral"}>{MISSION_LABEL[r.latestMission.status]}</Badge>}
              <span className="ml-auto text-[11px] text-muted">最後の動き {formatTime(r.lastActivityAt)}</span>
            </div>
            {r.latestMission ? <GoalText goal={r.latestMission.goal} className="mt-1 text-[13px]" /> : <p className="mt-1 text-[13px]">まだ依頼がありません。</p>}
            <p className="mt-1 text-[12px] text-muted">依頼 {r.missionCount}件 · できたもの {r.artifactCount}件</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button variant="ghost" onClick={() => onOpen(r.project.id, "mission")}>ホームで開く</Button>
              <Button variant="ghost" onClick={() => onOpen(r.project.id, "history")}>これまでの記録</Button>
              <Button variant="ghost" disabled={r.artifactCount === 0} onClick={() => onOpen(r.project.id, "artifacts")}>できたもの</Button>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
