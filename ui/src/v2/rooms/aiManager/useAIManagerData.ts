import { useCallback, useEffect, useRef, useState } from "react";

const POLL_INTERVAL_MS = 8000;

export type ProjectStatus = "active" | "paused" | "completed" | "archived";
export type ExecutionMode = "auto" | "assisted" | "manual";
export type ProjectTemplate =
  | "website" | "web_app" | "software" | "research" | "content" | "data_project" | "automation" | "custom";

export interface Project {
  id: string;
  name: string;
  description: string;
  template: ProjectTemplate;
  status: ProjectStatus;
  execution_mode: ExecutionMode;
  rules: string[];
  created_at: number;
  updated_at: number;
  completed_at: number | null;
}

export type ProjectTaskStatus =
  | "PENDING" | "PLANNING" | "READY" | "RUNNING" | "WAITING" | "BLOCKED"
  | "REVIEW" | "QA" | "COMPLETED" | "FAILED" | "CANCELLED";

export interface ProjectTask {
  id: string;
  project_id: string | null;
  parent_task_id: string | null;
  title: string | null;
  priority: "low" | "normal" | "high" | "critical";
  project_status: ProjectTaskStatus | null;
  assigned_agent: string | null;
  assigned_provider: string | null;
  assigned_model: string | null;
  dependencies: string[];
  artifacts: string[];
  next_agent: string | null;
  approval_required: boolean;
}

export interface Decision {
  id: string;
  project_id: string | null;
  statement: string;
  reason: string | null;
  made_by: string;
  created_at: number;
}

interface ActionResult {
  ok: boolean;
  message: string;
}

async function parseErrorMessage(resp: Response): Promise<string> {
  try {
    const body = (await resp.json()) as { error?: string };
    if (body?.error) return body.error;
  } catch {
    /* fall through */
  }
  return `HTTP ${resp.status}`;
}

/**
 * AI Manager Room hook - loads projects from /api/ai-manager/projects and,
 * when one is selected, its tasks (Kanban) and decisions. Polls rather than
 * tailing LiveDataContext for now: project runs are triggered from this
 * Room and the POST call itself already returns the settled result, so the
 * poll only needs to catch changes made by other channels (voice, workflow
 * nodes added in a later phase).
 */
export function useAIManagerData() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tasks, setTasks] = useState<ProjectTask[]>([]);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const inFlightRef = useRef(false);

  const refreshProjects = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const resp = await fetch("/api/ai-manager/projects");
      if (resp.ok) {
        const data = (await resp.json()) as Project[];
        setProjects(Array.isArray(data) ? data : []);
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load projects");
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  }, []);

  const refreshDetail = useCallback(async (projectId: string) => {
    setDetailLoading(true);
    try {
      const [tasksResp, decisionsResp] = await Promise.all([
        fetch(`/api/ai-manager/projects/${encodeURIComponent(projectId)}/tasks`),
        fetch(`/api/ai-manager/projects/${encodeURIComponent(projectId)}/decisions`),
      ]);
      setTasks(tasksResp.ok ? ((await tasksResp.json()) as ProjectTask[]) : []);
      setDecisions(decisionsResp.ok ? ((await decisionsResp.json()) as Decision[]) : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load project detail");
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshProjects();
    const id = window.setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      refreshProjects();
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [refreshProjects]);

  useEffect(() => {
    if (!selectedId) {
      setTasks([]);
      setDecisions([]);
      return;
    }
    refreshDetail(selectedId);
    const id = window.setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      refreshDetail(selectedId);
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [selectedId, refreshDetail]);

  const selectProject = useCallback((id: string | null) => setSelectedId(id), []);

  /**
   * Kicks off the full Planner -> Router -> Assignment -> Execution ->
   * Handoff pass for a new project request. Blocks until the whole task
   * graph has settled (see manager-agent.ts) - the request can take a
   * while for multi-step projects, so callers should show a busy state.
   */
  const runProject = useCallback(
    async (input: {
      name: string;
      request: string;
      template?: ProjectTemplate;
      execution_mode?: ExecutionMode;
    }): Promise<{ ok: true; project: Project } | { ok: false; message: string }> => {
      setRunning(true);
      try {
        const resp = await fetch("/api/ai-manager/projects", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        });
        if (!resp.ok) throw new Error(await parseErrorMessage(resp));
        const result = (await resp.json()) as { project: Project };
        await refreshProjects();
        setSelectedId(result.project.id);
        return { ok: true, project: result.project };
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : "Failed to start project" };
      } finally {
        setRunning(false);
      }
    },
    [refreshProjects],
  );

  const updateStatus = useCallback(
    async (id: string, status: ProjectStatus): Promise<ActionResult> => {
      try {
        const resp = await fetch(`/api/ai-manager/projects/${encodeURIComponent(id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        });
        if (!resp.ok) throw new Error(await parseErrorMessage(resp));
        await refreshProjects();
        return { ok: true, message: `Project ${status}.` };
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : "Failed" };
      }
    },
    [refreshProjects],
  );

  const addDecision = useCallback(
    async (projectId: string, statement: string, reason?: string): Promise<ActionResult> => {
      try {
        const resp = await fetch(`/api/ai-manager/projects/${encodeURIComponent(projectId)}/decisions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ statement, reason }),
        });
        if (!resp.ok) throw new Error(await parseErrorMessage(resp));
        if (selectedId === projectId) await refreshDetail(projectId);
        return { ok: true, message: "Decision recorded." };
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : "Failed" };
      }
    },
    [refreshDetail, selectedId],
  );

  return {
    projects,
    selectedId,
    selectProject,
    tasks,
    decisions,
    loading,
    detailLoading,
    running,
    error,
    refresh: refreshProjects,
    runProject,
    updateStatus,
    addDecision,
  };
}
