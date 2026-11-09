import { useMemo, useState } from "react";
import { api } from "../api";
import type { Ctx } from "../context";
import { Badge, Button, Card } from "../ui";
import { useAction, usePoll } from "../hooks";
import type { DesktopCompareInfo, Preview, SnapshotInfo } from "../types";

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
  const [cmp, setCmp] = useState<DesktopCompareInfo | null>(null);
  const refreshCmp = usePoll(async () => setCmp(await api.desktopCompare(projectId)), 3000, [projectId]);

  // Default baseline: the state before the first task (what the user started from).
  const effective = snaps.some((s) => s.name === picked) ? picked : (snaps[0]?.name ?? "");

  // Reload the live pane whenever the files being built change (new artifact, new version, task state).
  const stamp = useMemo(() => {
    const latest = ctx.overview.artifacts.reduce((m, a) => (a.createdAt > m ? a.createdAt : m), "");
    return `${ctx.overview.artifacts.length}|${latest}|${ctx.overview.tasks.map((t) => t.status).join(",")}`;
  }, [ctx.overview.artifacts, ctx.overview.tasks]);
  const liveKey = `${auto ? stamp : "fixed"}|${reloads}`;

  if (cmp?.supported) {
    const working = cmp.state === "working";
    const stamp2 = cmp.startedAt ?? "0";
    const chosenSnap = snaps.find((x) => x.name === effective);
    return (
      <Card fold title="作る前と今を並べて見る(ビフォー/アフター)">
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex min-w-0 max-w-full flex-wrap items-center gap-1.5 text-[12.5px]">
            <span className="shrink-0 whitespace-nowrap text-muted">ビフォーの基準</span>
            <select value={effective} onChange={(e) => setPicked(e.target.value)} disabled={snaps.length === 0 || working} className="min-w-0 max-w-full rounded-lg border border-border bg-panel px-2 py-1 text-[12.5px] sm:max-w-[18rem]">
              {snaps.length === 0 && <option value="">(まだありません)</option>}
              {snaps.map((s2, i) => <option key={s2.name} value={s2.name}>{i === 0 ? "最初の状態 → " : ""}{s2.objective ? `「${s2.objective.slice(0, 24)}」の前` : s2.taskId}</option>)}
            </select>
          </label>
          <Button disabled={busy || working || !effective} onClick={() => run(async () => { setCmp(await api.startDesktopCompare(projectId, effective)); refreshCmp(); })}>{working ? "撮影中…" : cmp.state === "idle" ? "撮って並べる" : "もう一度撮る"}</Button>
        </div>
        {cmp.message && <p className={`mt-2 text-[12.5px] ${cmp.state === "error" ? "text-[#9B2C2C]" : ""}`}>{cmp.message}</p>}
        {cmp.state === "error" && cmp.log && <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-[11.5px]">{cmp.log}</pre>}
        <div className="mt-3 flex flex-col gap-3 md:flex-row">
          {([["before", "ビフォー", "neutral"], ["after", "アフター(今)", "ok"]] as const).map(([which, title, tone]) => (
            <div key={which} className="flex min-w-0 flex-1 flex-col">
              <div className="mb-1 flex items-center gap-2"><Badge tone={tone}>{title}</Badge></div>
              {cmp[which] ? (
                <img src={api.desktopCompareImage(projectId, which, stamp2)} alt={`${title}のウィンドウ`} className="w-full rounded-lg border border-border bg-white" />
              ) : (
                <div className="flex h-48 w-full items-center justify-center rounded-lg border border-dashed border-border bg-bg px-4 text-center text-[13px] text-muted">{working ? "撮っています…" : "「撮って並べる」を押すと、ここに映ります。"}</div>
              )}
            </div>
          ))}
        </div>
        <p className="mt-2 text-[11.5px] text-muted">
          {chosenSnap ? `ビフォーは「${chosenSnap.objective || chosenSnap.taskId}」を始める直前のフォルダ` : "ビフォーは選んだ時点のフォルダ"}をビルドして開いたウィンドウの画像です。アフターは今のフォルダの画像です。それぞれ1〜数分かかり、撮り終えるとアプリは自動で閉じます。画像は静止画です(操作はできません)。
        </p>
      </Card>
    );
  }

  const state = preview?.state ?? "stopped";
  const running = state === "running" && preview?.url;
  const live = state === "running";
  const baseline = effective;
  const beforeSrc = baseline ? api.snapshotSiteUrl(projectId, baseline, "before") : null;
  const chosen = snaps.find((s) => s.name === baseline);

  return (
    <Card fold title="作る前と今を並べて見る(ビフォー/アフター)">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex overflow-hidden rounded-lg border border-border" role="group" aria-label="表示モード">
          {MODES.map((m) => (
            <button key={m.id} aria-pressed={mode === m.id} onClick={() => setMode(m.id)} className={`px-3 py-1.5 text-[12.5px] font-semibold ${mode === m.id ? "bg-accent text-white" : "bg-panel hover:bg-sidebar"}`}>{m.label}</button>
          ))}
        </div>
        <label className="flex min-w-0 max-w-full flex-wrap items-center gap-1.5 text-[12.5px]">
          <span className="shrink-0 whitespace-nowrap text-muted">ビフォーの基準</span>
          <select value={baseline} onChange={(e) => setPicked(e.target.value)} disabled={snaps.length === 0} className="min-w-0 max-w-full rounded-lg border border-border bg-panel px-2 py-1 text-[12.5px] sm:max-w-[18rem]">
            {snaps.length === 0 && <option value="">(まだありません)</option>}
            {snaps.map((s, i) => <option key={s.name} value={s.name}>{i === 0 ? "最初の状態 → " : ""}{s.objective ? `「${s.objective.slice(0, 24)}」の前` : s.taskId}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1 text-[12.5px]"><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />変更で自動更新</label>
        <Button variant="ghost" onClick={() => { setReloads((n) => n + 1); refreshSnaps(); }}>再読み込み</Button>
        {live ? (
          <Button variant="ghost" disabled={busy} onClick={() => run(async () => { setPreview(await api.stopPreview(projectId)); })}>停止</Button>
        ) : (
          <Button disabled={busy || state === "starting"} onClick={() => run(async () => { setPreview(await api.startPreview(projectId)); refreshPreview(); })}>{state === "starting" ? "起動中…" : "ライブを起動"}</Button>
        )}
      </div>
      {preview?.message && (!running || preview.kind === "desktop") && state !== "stopped" && <p className="mt-2 text-[12.5px]">{preview.message}</p>}
      <div className={`mt-3 flex gap-3 ${mode === "split" ? "flex-col md:flex-row" : "flex-col"}`}>
        {mode !== "after" && <Pane title="ビフォー" tone="neutral" src={beforeSrc} frameKey={`b|${baseline}|${reloads}`} empty="作業が始まると、その直前の状態がここに残ります。" />}
        {mode !== "before" && <Pane title="アフター(ライブ)" tone="ok" src={running ? preview!.url : null} frameKey={`a|${preview?.url}|${liveKey}`} empty={preview?.kind === "desktop" && state === "running" ? "デスクトップアプリは、別のウィンドウで開いています(この枠には映りません)。" : state === "starting" ? "起動しています…" : "「ライブを起動」を押すと、作りかけの画面がここに映ります。"} />}
      </div>
      <p className="mt-2 text-[11.5px] text-muted">
        ビフォーは{chosen ? `「${chosen.objective || chosen.taskId}」を始める直前` : "(基準なし)"}のファイルをそのまま表示します。アフターは作りかけの実物で、ファイルが変わるたびに自動で読み込み直します。HTMLなど画面のあるものだけ見られます。
      </p>
    </Card>
  );
}
