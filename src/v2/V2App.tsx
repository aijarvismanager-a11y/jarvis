import { useCallback, useMemo, useRef, useState } from "react";
import { api } from "./api";
import type { Ctx } from "./context";
import { currentMission } from "./labels";
import { ArtifactScreen } from "./screens/ArtifactScreen";
import { DevelopmentScreen } from "./screens/DevelopmentScreen";
import { HistoryScreen } from "./screens/HistoryScreen";
import { MissionScreen } from "./screens/MissionScreen";
import { SettingsScreen } from "./screens/SettingsScreen";
import type { AiService, Approval, Artifact, Handoff, Overview, Project } from "./types";
import { diffNotices, notifyEnabled, notifySupported, setNotifyEnabled, showNotices, snapshotOf, type NotifyState } from "./notify";
import { Button, ErrorBar, useAction, usePoll } from "./ui";

const SCREENS = [
  { id: "mission", label: "ミッション" },
  { id: "development", label: "開発" },
  { id: "history", label: "履歴" },
  { id: "artifacts", label: "成果物" },
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

/** Brings an existing folder in as a new project; Claude Code then writes a status report about it. */
function ImportBar({ onImported, setError }: { onImported: (p: Project) => void; setError: (m: string) => void }) {
  const [open, setOpen] = useState(false);
  const [folder, setFolder] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const { busy, run } = useAction(setError);
  if (!open) return <div className="mx-auto max-w-3xl px-4 pb-2"><Button variant="ghost" onClick={() => setOpen(true)}>既存プロジェクトを取り込む</Button>{note && <span className="ml-2 text-[12px] text-status-done">{note}</span>}</div>;
  const go = () => run(async () => {
    const r = await api.importProject(folder.trim());
    setNote(`${r.files}ファイルを取り込みました${r.skippedSecrets.length ? `(秘密情報らしい${r.skippedSecrets.length}ファイルは除外)` : ""}`);
    setFolder("");
    setOpen(false);
    onImported(r.project);
  });
  return (
    <div className="mx-auto max-w-3xl px-4 pb-3">
      <p className="text-[12px] text-muted">フォルダはコピーして取り込みます(元のフォルダは変更しません)。node_modules・.git・.env などは除きます。取り込み後、Claude Code が現状レポートを作ります。</p>
      <div className="mt-1 flex gap-2">
        <input value={folder} onChange={(e) => setFolder(e.target.value)} placeholder="例: C:\Users\you\my-app" className="min-w-0 flex-1 rounded-lg border border-border bg-bg px-2 py-1.5 text-[13px] outline-none focus:border-accent" />
        <Button disabled={busy || !folder.trim()} onClick={go}>{busy ? "取り込み中…" : "取り込む"}</Button>
        <Button variant="ghost" onClick={() => setOpen(false)}>閉じる</Button>
      </div>
    </div>
  );
}

export default function V2App() {
  const [screen, setScreen] = useState<ScreenId>("mission");
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<string | null>(readStored);
  const [loaded, setLoaded] = useState(false);
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

  const refresh = usePoll(
    async () => {
      const list = await api.projects();
      setProjects(list);
      // A stored id may point at a project that no longer exists; fall back to the newest one.
      const active = list.find((p) => p.id === projectId) ?? (projectId === null && !loaded ? list[list.length - 1] : undefined);
      if (active && active.id !== projectId) choose(active.id);
      setLoaded(true);
      const [ov, svc, hand, appr] = await Promise.all([active ? api.overview(active.id) : Promise.resolve(EMPTY), api.aiServices(), api.handoffs().catch(() => [] as Handoff[]), api.approvals().catch(() => [] as Approval[])]);
      setOverview(ov);
      const mine = (x: { projectId: string }) => x.projectId === active?.id;
      const missionsNow = ov.missions;
      const prev = seen.current.projectId === (active?.id ?? null) ? seen.current.state : null;
      showNotices(diffNotices(prev, appr.filter(mine), hand.filter(mine), missionsNow));
      seen.current = { projectId: active?.id ?? null, state: snapshotOf(appr.filter(mine), hand.filter(mine), missionsNow) };
      setServices(svc);
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
    openArtifact: (a) => {
      setSelectedArtifact(a);
      setScreen("artifacts");
    },
  };
  const waiting = handoffs.filter((h) => h.projectId === project?.id).length + approvals.filter((a) => a.projectId === project?.id).length;

  return (
    <div className="min-h-screen bg-bg text-ink">
      <header className="border-b border-border bg-sidebar">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-3 px-4 py-3">
          <h1 className="font-serif text-[17px] font-bold">AIオーケストラ</h1>
          <div className="ml-auto flex items-center gap-2">
            {notifySupported() && (
              <Button variant="ghost" aria-pressed={notifyOn} onClick={() => { void setNotifyEnabled(!notifyOn).then(setNotifyOn); }}>
                {notifyOn ? "🔔 通知オン" : "🔕 通知オフ"}
              </Button>
            )}
            <select aria-label="プロジェクト" value={projectId ?? ""} onChange={(e) => choose(e.target.value || null)} className="max-w-[16rem] rounded-lg border border-border bg-panel px-2 py-1.5 text-[13px]">
              <option value="">(新しいプロジェクト)</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        </div>
        <ImportBar setError={setError} onImported={(p) => { setProjects((ps) => [...ps, p]); choose(p.id); setScreen("mission"); }} />
        <nav className="mx-auto flex max-w-3xl gap-1 overflow-x-auto px-3" aria-label="画面">
          {SCREENS.map((s) => (
            <button
              key={s.id}
              onClick={() => setScreen(s.id)}
              aria-current={screen === s.id ? "page" : undefined}
              className={`whitespace-nowrap border-b-2 px-3 py-2 text-[13px] font-semibold ${screen === s.id ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink"}`}
            >
              {s.label}
              {s.id === "mission" && waiting > 0 && <span className="ml-1.5 rounded-full bg-accent px-1.5 py-0.5 text-[10px] text-white">{waiting}</span>}
            </button>
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-5">
        <ErrorBar message={error} onClose={() => setError(null)} />
        {!loaded ? (
          <p className="text-[13px] text-muted">読み込み中…</p>
        ) : (
          <>
            {screen === "mission" && <MissionScreen ctx={ctx} />}
            {screen === "development" && <DevelopmentScreen ctx={ctx} />}
            {screen === "history" && <HistoryScreen ctx={ctx} />}
            {screen === "artifacts" && <ArtifactScreen ctx={ctx} selected={selectedArtifact} onSelect={setSelectedArtifact} />}
            {screen === "settings" && <SettingsScreen services={services} setError={setError} refresh={refresh} />}
          </>
        )}
      </main>
    </div>
  );
}
