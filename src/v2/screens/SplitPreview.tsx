import { useMemo, useState } from "react";
import { api } from "../api";
import type { Ctx } from "../context";
import { Badge, Button, Card, useAction, usePoll } from "../ui";
import type { Preview, SnapshotInfo } from "../types";

type Mode = "split" | "before" | "after";
const MODES: { id: Mode; label: string }[] = [
  { id: "split", label: "並べて比較" },
  { id: "before", label: "ビフォー" },
  { id: "after", label: "アフター" },
];

function Pane({ title, tone, src, frameKey, empty }: { title: string; tone: "neutral" | "ok"; src: string | null; frameKey: string; empty: string }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="mb-1 flex items-center gap-2"><Badge tone={tone}>{title}</Badge></div>
      {src ? (
        // allow-same-origin is deliberately absent: generated pages cannot reach the orchestrator's own API.
        <iframe key={frameKey} src={src} title={title} sandbox="allow-scripts allow-forms allow-popups" className="h-[60vh] w-full rounded-lg border border-border bg-white" />
      ) : (
        <div className="flex h-[60vh] w-full items-center justify-center rounded-lg border border-dashed border-border bg-bg px-4 text-center text-[13px] text-muted">{empty}</div>
      )}
    </div>
  );
}

/** Live view of what is being built next to how it looked before a chosen task, in the same screen. */
export function SplitPreview({ ctx }: { ctx: Ctx }) {
  const projectId = ctx.project!.id;
  const [snaps, setSnaps] = useState<SnapshotInfo[]>([]);
  const [picked, setPicked] = useState<string>("");
  const [mode, setMode] = useState<Mode>("split");
  const [auto, setAuto] = useState(true);
  const [reloads, setReloads] = useState(0);
  const [preview, setPreview] = useState<Preview | null>(null);
  const { busy, run } = useAction(ctx.setError);

  const refreshSnaps = usePoll(async () => setSnaps(await api.snapshots(projectId)), 4000, [projectId]);
  const refreshPreview = usePoll(async () => setPreview(await api.preview(projectId)), 2500, [projectId]);

  // Default baseline: the state before the first task (what the user started from).
  const effective = snaps.some((s) => s.name === picked) ? picked : (snaps[0]?.name ?? "");

  // Reload the live pane whenever the files being built change (new artifact, new version, task state).
  const stamp = useMemo(() => {
    const latest = ctx.overview.artifacts.reduce((m, a) => (a.createdAt > m ? a.createdAt : m), "");
    return `${ctx.overview.artifacts.length}|${latest}|${ctx.overview.tasks.map((t) => t.status).join(",")}`;
  }, [ctx.overview.artifacts, ctx.overview.tasks]);
  const liveKey = `${auto ? stamp : "fixed"}|${reloads}`;

  const state = preview?.state ?? "stopped";
  const running = state === "running" && preview?.url;
  const baseline = effective;
  const beforeSrc = baseline ? api.snapshotSiteUrl(projectId, baseline, "before") : null;
  const chosen = snaps.find((s) => s.name === baseline);

  return (
    <Card title="リアルタイムプレビュー(分割表示)">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex overflow-hidden rounded-lg border border-border" role="group" aria-label="表示モード">
          {MODES.map((m) => (
            <button key={m.id} aria-pressed={mode === m.id} onClick={() => setMode(m.id)} className={`px-3 py-1.5 text-[12.5px] font-semibold ${mode === m.id ? "bg-accent text-white" : "bg-panel hover:bg-sidebar"}`}>{m.label}</button>
          ))}
        </div>
        <label className="flex items-center gap-1.5 text-[12.5px]">
          <span className="text-muted">ビフォーの基準</span>
          <select value={baseline} onChange={(e) => setPicked(e.target.value)} disabled={snaps.length === 0} className="max-w-[18rem] rounded-lg border border-border bg-panel px-2 py-1 text-[12.5px]">
            {snaps.length === 0 && <option value="">(まだありません)</option>}
            {snaps.map((s, i) => <option key={s.name} value={s.name}>{i === 0 ? "最初の状態 → " : ""}{s.objective ? `「${s.objective.slice(0, 24)}」の前` : s.taskId}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1 text-[12.5px]"><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />変更で自動更新</label>
        <Button variant="ghost" onClick={() => { setReloads((n) => n + 1); refreshSnaps(); }}>再読み込み</Button>
        {running ? (
          <Button variant="ghost" disabled={busy} onClick={() => run(async () => { setPreview(await api.stopPreview(projectId)); })}>停止</Button>
        ) : (
          <Button disabled={busy || state === "starting"} onClick={() => run(async () => { setPreview(await api.startPreview(projectId)); refreshPreview(); })}>{state === "starting" ? "起動中…" : "ライブを起動"}</Button>
        )}
      </div>
      {preview?.message && !running && state !== "stopped" && <p className="mt-2 text-[12.5px]">{preview.message}</p>}
      <div className={`mt-3 flex gap-3 ${mode === "split" ? "flex-col md:flex-row" : "flex-col"}`}>
        {mode !== "after" && <Pane title="ビフォー" tone="neutral" src={beforeSrc} frameKey={`b|${baseline}|${reloads}`} empty="タスクが始まると、その直前の状態がここに残ります。" />}
        {mode !== "before" && <Pane title="アフター(ライブ)" tone="ok" src={running ? preview!.url : null} frameKey={`a|${preview?.url}|${liveKey}`} empty={state === "starting" ? "起動しています…" : "「ライブを起動」を押すと、作りかけの画面がここに映ります。"} />}
      </div>
      <p className="mt-2 text-[11.5px] text-muted">
        ビフォーは{chosen ? `「${chosen.objective || chosen.taskId}」を始める直前` : "(基準なし)"}のファイルをそのまま表示します。アフターは作りかけの実物で、ファイルが変わるたびに自動で読み込み直します。HTMLなど画面のあるものだけ見られます。
      </p>
    </Card>
  );
}
