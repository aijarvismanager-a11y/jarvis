import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useActiveProject, type ActiveProjectOption } from "./useActiveProject";
import { useLiveData } from "./LiveDataContext";
import type { AgentActivityEvent } from "../../hooks/useWebSocket";
import type { AgentPerformance, ProjectTask, ProjectTaskStatus } from "../rooms/aiManager/useAIManagerData";

/**
 * Cinematic UI Phase 29 — the unified "current project / active agents /
 * task status / provider status" state layer the Phase 28 audit
 * (docs/CINEMATIC_UI_AUDIT.md §2, §11) found missing. Normal Mode's
 * existing Rooms (AIManagerRoom, AgentsRoom, ...) keep their own
 * poll-on-demand hooks unchanged — this context is additive, meant for
 * surfaces (Cinematic Core, future HUD, Focus Mode) that need a live
 * snapshot without mounting a full Room. It is built ON TOP OF the
 * existing pieces, not a replacement:
 *   - current project pin: useActiveProject() (unchanged, reused as-is)
 *   - live agent activity: useLiveData().agentActivity (unchanged, reused)
 *   - task status + agent performance for the pinned project: new,
 *     lightweight polling of the same REST endpoints useAIManagerData.ts
 *     already uses, kept independent so Cinematic surfaces don't require
 *     the AI Manager Room to be mounted.
 *   - provider (LLM) online/offline status: new — GET
 *     /api/llm/providers/status, backed by src/llm/usage.ts's
 *     getProviderStatus() (derived from real llm_usage call history, not
 *     a live probe — see that function's doc comment for why).
 */

const POLL_INTERVAL_MS = 8000;

export type ProviderStatusValue = "online" | "error" | "unknown";

export interface ProviderStatusEntry {
  provider: string;
  status: ProviderStatusValue;
  last_call_ts: number | null;
  last_error_code: string | null;
  last_latency_ms: number | null;
}

export type TaskStatusCounts = Partial<Record<ProjectTaskStatus, number>>;

export interface ActiveProjectSnapshot {
  id: string;
  tasks: ProjectTask[];
  taskCounts: TaskStatusCounts;
  totalTasks: number;
  agentPerformance: AgentPerformance[];
}

export interface JarvisState {
  /** Server-authoritative pinned project (see useActiveProject.ts). */
  activeProjectId: string | null;
  activeProjectOptions: ActiveProjectOption[];
  setActiveProject: (projectId: string | null) => Promise<void>;
  activeProjectLoading: boolean;

  /** Null when no project is pinned, or its detail hasn't loaded yet. */
  activeProjectDetail: ActiveProjectSnapshot | null;
  activeProjectDetailLoading: boolean;

  /** Live sub-agent activity, passed through from LiveDataContext for convenience. */
  agentActivity: AgentActivityEvent[];

  /** Per-provider status, derived from real call history (not a live probe). */
  providerStatus: ProviderStatusEntry[];
  providerStatusLoading: boolean;
}

const EMPTY_STATE: JarvisState = {
  activeProjectId: null,
  activeProjectOptions: [],
  setActiveProject: async () => {},
  activeProjectLoading: true,
  activeProjectDetail: null,
  activeProjectDetailLoading: false,
  agentActivity: [],
  providerStatus: [],
  providerStatusLoading: true,
};

const JarvisStateCtx = createContext<JarvisState | null>(null);

function countByStatus(tasks: ProjectTask[]): TaskStatusCounts {
  const counts: TaskStatusCounts = {};
  for (const t of tasks) {
    if (!t.project_status) continue;
    counts[t.project_status] = (counts[t.project_status] ?? 0) + 1;
  }
  return counts;
}

/** Must be mounted inside LiveDataProvider (see AppShell.tsx) — reads useLiveData(). */
export function JarvisStateProvider({ children }: { children: React.ReactNode }) {
  const { projects: activeProjectOptions, activeProjectId, setActiveProject, loading: activeProjectLoading } =
    useActiveProject();
  const { agentActivity } = useLiveData();

  const [activeProjectDetail, setActiveProjectDetail] = useState<ActiveProjectSnapshot | null>(null);
  const [activeProjectDetailLoading, setActiveProjectDetailLoading] = useState(false);
  const [providerStatus, setProviderStatus] = useState<ProviderStatusEntry[]>([]);
  const [providerStatusLoading, setProviderStatusLoading] = useState(true);
  const detailInFlight = useRef(false);

  const refreshProjectDetail = useCallback(async (projectId: string) => {
    if (detailInFlight.current) return;
    detailInFlight.current = true;
    setActiveProjectDetailLoading(true);
    try {
      const [tasksResp, perfResp] = await Promise.all([
        fetch(`/api/ai-manager/projects/${encodeURIComponent(projectId)}/tasks`),
        fetch(`/api/ai-manager/agents/performance?project_id=${encodeURIComponent(projectId)}`),
      ]);
      const tasks = tasksResp.ok ? ((await tasksResp.json()) as ProjectTask[]) : [];
      const agentPerformance = perfResp.ok ? ((await perfResp.json()) as AgentPerformance[]) : [];
      setActiveProjectDetail({
        id: projectId,
        tasks,
        taskCounts: countByStatus(tasks),
        totalTasks: tasks.length,
        agentPerformance,
      });
    } catch {
      // Best-effort — a stale/absent snapshot is preferable to crashing a
      // Cinematic surface over a transient fetch failure.
    } finally {
      detailInFlight.current = false;
      setActiveProjectDetailLoading(false);
    }
  }, []);

  const refreshProviderStatus = useCallback(async () => {
    try {
      const resp = await fetch("/api/llm/providers/status");
      if (resp.ok) {
        const data = (await resp.json()) as { providers: ProviderStatusEntry[] };
        setProviderStatus(Array.isArray(data.providers) ? data.providers : []);
      }
    } catch {
      // Best-effort, same as every other poll hook in this app.
    } finally {
      setProviderStatusLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!activeProjectId) {
      setActiveProjectDetail(null);
      return;
    }
    refreshProjectDetail(activeProjectId);
    const id = window.setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      refreshProjectDetail(activeProjectId);
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [activeProjectId, refreshProjectDetail]);

  useEffect(() => {
    refreshProviderStatus();
    const id = window.setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      refreshProviderStatus();
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [refreshProviderStatus]);

  const value: JarvisState = {
    activeProjectId,
    activeProjectOptions,
    setActiveProject,
    activeProjectLoading,
    activeProjectDetail,
    activeProjectDetailLoading,
    agentActivity,
    providerStatus,
    providerStatusLoading,
  };

  return <JarvisStateCtx.Provider value={value}>{children}</JarvisStateCtx.Provider>;
}

/** Stable empty default outside the provider, matching useLiveData()'s pattern. */
export function useJarvisState(): JarvisState {
  const ctx = useContext(JarvisStateCtx);
  if (ctx) return ctx;
  return EMPTY_STATE;
}
