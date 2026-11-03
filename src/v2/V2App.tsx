import { useCallback, useMemo, useRef, useState } from "react";
import { api } from "./api";
import type { Ctx } from "./context";
import { currentMission } from "./labels";
import { ArtifactScreen } from "./screens/ArtifactScreen";
import { DevelopmentScreen } from "./screens/DevelopmentScreen";
import { HistoryScreen } from "./screens/HistoryScreen";
import { MissionScreen } from "./screens/MissionScreen";
import { ProjectsScreen } from "./screens/ProjectsScreen";
import { SettingsScreen } from "./screens/SettingsScreen";
import { getAutoRestart, useAutoRestartChoice } from "./autoRestart";
import type { AiService, Approval, Artifact, Handoff, Overview, Project, SyncSummary } from "./types";
import { diffNotices, notifyEnabled, notifySupported, setNotifyEnabled, showNotices, snapshotOf, type NotifyState } from "./notify";
import { usePoll } from "./hooks";
import { HelpDialog } from "./HelpDialog";
import { QuotaChip } from "./screens/QuotaChip";
import { LimitBanner } from "./screens/LimitBanner";
import { RestingBanner } from "./screens/RestingBanner";
import { ChangelogDialog } from "./ChangelogDialog";
import { StatusStrip } from "./screens/StatusStrip";
import { ImportBar } from "./ImportBar";
import { Button, ErrorBar } from "./ui";

/** Button text that gives way to the icon alone on a narrow window, so the header stays one or two lines. */
const Label = ({ children }: { children: string }) => <span className="ml-1 hidden sm:inline">{children}</span>;

const SCREENS = [
  { id: "mission", label: "ホーム" },
  { id: "development", label: "進み具合" },
  { id: "history", label: "これまでの記録" },
  { id: "artifacts", label: "できたもの" },
  { id: "projects", label: "プロジェクト一覧" },
  { id: "ais", label: "使うAI" },
  { id: "settings", label: "設定" },
] as const;
type ScreenId = (typeof SCREENS)[number]["id"];

const EMPTY: Overview = { missions: [], tasks: [], artifacts: [], aiRuns: [] };
const STORAGE_KEY = "orchestrator.projectId";
const readStored = () => {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
};

export default function V2App() {
  const [screen, setScreen] = useState<ScreenId>("mission");
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<string | null>(readStored);
  const [loaded, setLoaded] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [overview, setOverview] = useState<Overview>(EMPTY);
  const [services, setServices] = useState<AiService[]>([]);
  const [handoffs, setHandoffs] = useState<Handoff[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [selectedArtifact, setSelectedArtifact] = useState<Artifact | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [notifyOn, setNotifyOn] = useState(notifyEnabled);
  // what the last poll saw, per project: the next poll announces only the difference
  const seen = useRef<{ projectId: string | null; state: NotifyState | null }>({ projectId: null, state: null });

  const choose = useCallback((id: string | null) => {
    setProjectId(id);
    setSelectedArtifact(null);
    setOverview(EMPTY);
    try {
      if (id) localStorage.setItem(STORAGE_KEY, id);
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      // storage unavailable: the choice just won't be remembered
    }
  }, []);

  const project = useMemo(() => projects.find((p) => p.id === projectId) ?? null, [projects, projectId]);

  const [offline, setOffline] = useState(false);
  const [help, setHelp] = useState(false);
  // The server keeps running old code after the source changes; ask for a restart when that is the case.
  const [outdated, setOutdated] = useState(false);
  const [appVersion, setAppVersion] = useState("");
  // the desktop window adds its own version to the browser's user agent (see electron/main.cjs); the plain browser has none
  const windowVersion = typeof navigator !== "undefined" ? /AIOrchestratorDesktop\/([\d.]+)/.exec(navigator.userAgent)?.[1] ?? "" : "";
  const [changelog, setChangelog] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const restartingRef = useRef(false);
  const [autoRestart, setAutoRestart] = useAutoRestartChoice();
  const restartServer = async () => {
    setRestarting(true);
    try {
      try {
        await api.restartServer();
      } catch (e) {
        // running missions: ask first, since the restart interrupts them (they resume afterwards)
        const m = e instanceof Error ? e.message : String(e);
        if (!m.includes("実行中の依頼")) throw e;
        if (!window.confirm(`${m}

それでも再起動しますか?`)) return void setRestarting(false);
        await api.restartServer(true);
      }
      // the server is gone for a few seconds; the offline banner covers that. Check until a fresh one answers.
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        const v = await api.serverVersion().catch(() => undefined);
        if (v && !v.stale) {
          setOutdated(false);
          break;
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRestarting(false);
    }
  };
  usePoll(async () => {
    const v = await api.serverVersion();
    setOutdated(v === null || v.stale);
    if (v?.version) setAppVersion(v.version);
    // a running request refuses the restart ("実行中の依頼"): that is simply tried again at the next check
    if (v?.stale && getAutoRestart() && !restartingRef.current) {
      restartingRef.current = true;
      try {
        await api.restartServer();
      } catch {
        /* busy or failed: try again later */
      } finally {
        restartingRef.current = false;
      }
    }
  }, 30000, []);
  // a sign-in window of the dedicated browser profile left open stops the browser AIs: say so, and that closing it continues the work
  const [browserWindow, setBrowserWindow] = useState<{ loginWindowOpen: boolean; waiting: number } | null>(null);
  usePoll(async () => setBrowserWindow(await api.browserStatus().catch(() => null)), 4000, []);
  const pollCount = useRef(0);
  // Differences between the working copy and the folder it was imported from (cheap on the server, so polled slowly).
  const [syncOf, setSyncOf] = useState<{ projectId: string; summary: SyncSummary } | null>(null);
  // A slow answer for the project that was open before must not show on the one open now (a big folder takes seconds to compare).
  const sync = syncOf && syncOf.projectId === projectId ? syncOf.summary : null;
  // Hashing a big folder blocks the server for seconds, so wait until the first screen has loaded.
  usePoll(async () => {
    if (!projectId || !loaded) return void setSyncOf(null);
    const asked = projectId;
    setSyncOf({ projectId: asked, summary: await api.syncSummary(asked) });
  }, 30000, [projectId, loaded]);

  const refresh = usePoll(
    async () => {
      let list: Project[];
      try {
        list = await api.projects();
        setOffline(false);
      } catch {
        // server unreachable: keep what is on screen, say so, and let the next poll retry
        setOffline(true);
        setLoaded(true);
        return;
      }
      setProjects(list);
      // A stored id may point at a project that no longer exists; fall back to the newest one.
      const active = list.find((p) => p.id === projectId) ?? (!loaded && !list.some((p) => p.id === projectId) ? list[list.length - 1] : undefined);
      if (active && active.id !== projectId) choose(active.id);
      setLoaded(true);
      // The AI list is ~20KB and rarely changes (Settings refreshes it on demand): fetch it on the first poll and then every 8th.
      const cycle = pollCount.current++;
      const [ov, svc, hand, appr] = await Promise.all([active ? api.overview(active.id) : Promise.resolve(EMPTY), cycle % 8 === 0 ? api.aiServices() : Promise.resolve(null), api.handoffs().catch(() => [] as Handoff[]), api.approvals().catch(() => [] as Approval[])]);
      setOverview(ov);
      const mine = (x: { projectId: string }) => x.projectId === active?.id;
      const missionsNow = ov.missions;
      const prev = seen.current.projectId === (active?.id ?? null) ? seen.current.state : null;
      showNotices(diffNotices(prev, appr.filter(mine), hand.filter(mine), missionsNow));
      seen.current = { projectId: active?.id ?? null, state: snapshotOf(appr.filter(mine), hand.filter(mine), missionsNow) };
      if (svc) setServices(svc);
      setHandoffs(hand);
      setApprovals(appr);
    },
    2500,
    [projectId],
  );

  const ensureProject = useCallback(
    async (nameHint: string) => {
      if (project) return project;
      const created = await api.createProject(nameHint);
      setProjects((ps) => [...ps, created]);
      choose(created.id);
      return created;
    },
    [project, choose],
  );

  const mission = useMemo(() => currentMission(overview.missions), [overview.missions]);
  const ctx: Ctx = {
    project,
    overview,
    services,
    handoffs,
    approvals,
    mission,
    refresh,
    setError,
    ensureProject,
    openHelp: () => setHelp(true),
    projectCount: projects.length,
    openArtifact: (a) => {
      setSelectedArtifact(a);
      setScreen("artifacts");
    },
  };
  const waiting = handoffs.filter((h) => h.projectId === project?.id).length + approvals.filter((a) => a.projectId === project?.id).length;

  return (
    <div className="min-h-screen bg-bg text-ink">
      <header className="border-b border-border bg-sidebar">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-3 px-4 py-3">
          <h1 className="flex items-center gap-2 font-serif text-[17px] font-bold"><img src="/favicon.svg" alt="" className="h-6 w-6" />AIオーケストラ{appVersion && <span className="text-[11px] font-normal text-muted">v{appVersion}</span>}{windowVersion && appVersion && windowVersion !== appVersion && <span className="rounded border border-[#EBD9A8] bg-[#FBF1DC] px-1.5 py-0.5 text-[11px] font-normal text-[#8A6212]" title="この窓(インストーラ)の版と、画面を出しているサーバーの版が違います。窓を開き直すと、自動で揃います">窓は v{windowVersion}</span>}</h1>
          <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2 [&_button]:whitespace-nowrap">
            <Button variant="ghost" disabled={importOpen} onClick={() => setImportOpen(true)} title="ほかで作っているものを引き継ぐ" aria-label="ほかで作っているものを引き継ぐ">📁<Label>ほかで作っているものを引き継ぐ</Label></Button>
            {notifySupported() && (
              <Button variant="ghost" aria-pressed={notifyOn} onClick={() => { void setNotifyEnabled(!notifyOn).then(setNotifyOn); }}>
                {notifyOn ? "🔔" : "🔕"}<Label>{notifyOn ? "通知オン" : "通知オフ"}</Label>
              </Button>
            )}
            <Button variant="ghost" onClick={() => window.location.reload()} title="画面を最新の状態に読み込み直します(F5 / Ctrl+R でも同じです)" aria-label="画面を更新">🔄<Label>画面を更新</Label></Button>
            <Button variant="ghost" onClick={() => setChangelog(true)} title="更新履歴" aria-label="更新履歴">🆕<Label>更新履歴</Label></Button>
            <Button variant="ghost" onClick={() => setHelp(true)} title="使い方" aria-label="使い方">？<Label>使い方</Label></Button>
            <Button variant="ghost" disabled={projectId === null} onClick={() => { choose(null); setScreen("mission"); }} title="新しいプロジェクト" aria-label="新しいプロジェクト">＋<Label>新しいプロジェクト</Label></Button>
            <QuotaChip onOpen={() => setScreen("ais")} />
            <select aria-label="プロジェクト" value={projectId ?? ""} onChange={(e) => choose(e.target.value || null)} className="min-w-0 max-w-[16rem] rounded-lg border border-border bg-panel px-2 py-1.5 text-[13px]">
              <option value="">(新しいプロジェクト)</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        </div>
        <ImportBar open={importOpen} setOpen={setImportOpen} setError={setError} onImported={(p) => { setProjects((ps) => (ps.some((x) => x.id === p.id) ? ps : [...ps, p])); choose(p.id); setScreen("mission"); }} />
        <nav className="mx-auto flex max-w-[1600px] gap-1 overflow-x-auto px-3" aria-label="画面">
          {SCREENS.map((s) => (
            <button
              key={s.id}
              onClick={() => setScreen(s.id)}
              aria-current={screen === s.id ? "page" : undefined}
              className={`whitespace-nowrap border-b-2 px-3 py-2 text-[13px] font-semibold ${screen === s.id ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink"}`}
            >
              {s.label}
              {s.id === "mission" && waiting > 0 && <span className="ml-1.5 rounded-full bg-accent px-1.5 py-0.5 text-[10px] text-white">{waiting}</span>}
              {s.id === "mission" && sync?.linked && sync.push + sync.pull > 0 && (
                <span className="ml-1.5 rounded-full border border-accent px-1.5 py-0.5 text-[10px] text-accent" title={`元のフォルダとの違い: 元のフォルダ側の変更 ${sync.pull}件・このアプリ側の変更 ${sync.push}件。ホームの「元のフォルダに反映する」で確認できます`}>元のフォルダと違いあり {sync.push + sync.pull}</span>
              )}
            </button>
          ))}
        </nav>
        {screen !== "mission" && <StatusStrip ctx={ctx} onOpen={() => setScreen("mission")} />}
      </header>
      {changelog && <ChangelogDialog version={appVersion} onClose={() => setChangelog(false)} />}
      {help && <HelpDialog version={appVersion} onClose={() => setHelp(false)} />}
      <main className="mx-auto max-w-[1600px] px-4 py-5 lg:px-6">
        {outdated && !offline && (
          <div role="alert" className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-[#EBD9A8] bg-[#FBF1DC] px-3 py-2 text-[13px] text-[#8A6212]">
            <span className="min-w-0 flex-1">サーバーが古いコードのまま動いています。再起動すると最新になります(実行中の依頼は再起動後に自動で再開します)。</span>
            <label className="flex items-center gap-1.5 text-[12.5px]">
              <input type="checkbox" checked={autoRestart} onChange={(e) => setAutoRestart(e.target.checked)} />
              <span>実行中の依頼がないときは、自動で再起動する</span>
            </label>
            <Button variant="ghost" disabled={restarting} onClick={() => void restartServer()}>{restarting ? "再起動中…" : "サーバーを再起動"}</Button>
          </div>
        )}
        {browserWindow?.loginWindowOpen && (
          <div role="status" className="mb-3 rounded-lg border border-[#EBD9A8] bg-[#FBF1DC] px-3 py-2 text-[13px] text-[#8A6212]">
            <p className="font-semibold">ログイン用の窓が開いています</p>
            <p className="mt-0.5">
              {browserWindow.waiting > 0
                ? `この窓のため、ブラウザ上のAIの作業${browserWindow.waiting}件が待っています。ログインが終わったら、窓を完全に閉じてください。閉じると、待っている作業が自動で再開します。`
                : "ログインが終わったら、窓を完全に閉じてください。開いたままだと、ブラウザ上のAIの作業を始められません(始めた作業は、窓が閉じられるまで待ちます)。"}
            </p>
          </div>
        )}
        {offline && <div role="alert" className="mb-3 rounded-lg border border-[#E7C4C4] bg-[#FBEFEF] px-3 py-2 text-[13px] text-[#9B2C2C]">サーバーに接続できません。表示は最後に取得した内容です。サーバーが起動しているか確認してください(自動で再接続を試みます)。</div>}
        <LimitBanner setError={setError} />
        <RestingBanner setError={setError} />
        <ErrorBar message={error} onClose={() => setError(null)} />
        {!loaded ? (
          <p className="text-[13px] text-muted">読み込み中…</p>
        ) : (
          <>
            {screen === "mission" && <MissionScreen ctx={ctx} />}
            {screen === "development" && <DevelopmentScreen ctx={ctx} />}
            {screen === "history" && <HistoryScreen ctx={ctx} />}
            {screen === "artifacts" && <ArtifactScreen ctx={ctx} selected={selectedArtifact} onSelect={setSelectedArtifact} />}
            {screen === "projects" && <ProjectsScreen currentId={projectId} onOpen={(id, to) => { choose(id); setScreen(to); }} />}
            {(screen === "ais" || screen === "settings") && <SettingsScreen section={screen === "ais" ? "ai" : "app"} services={services} project={project} setError={setError} onProjectDeleted={() => { const rest = projects.filter((p) => p.id !== projectId); setProjects(rest); choose(rest.length ? rest[rest.length - 1].id : null); setScreen("mission"); }} refresh={() => { pollCount.current = 0; refresh(); }} />}
          </>
        )}
      </main>
    </div>
  );
}
