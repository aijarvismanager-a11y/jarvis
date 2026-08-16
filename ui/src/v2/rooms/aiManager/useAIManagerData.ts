import { useCallback, useEffect, useRef, useState } from "react";

const POLL_INTERVAL_MS = 8000;

export type ProjectStatus = "active" | "paused" | "completed" | "archived";
export type ExecutionMode = "auto" | "assisted" | "manual";
export type CostMode = "cheap" | "balanced" | "quality";
export type ProjectTemplate =
  | "website" | "web_app" | "software" | "research" | "content" | "data_project" | "automation" | "custom";

export interface Project {
  id: string;
  name: string;
  description: string;
  template: ProjectTemplate;
  status: ProjectStatus;
  execution_mode: ExecutionMode;
  cost_mode: CostMode;
  rules: string[];
  created_at: number;
  updated_at: number;
  completed_at: number | null;
}

export type ProjectTaskStatus =
  | "PENDING" | "PLANNING" | "READY" | "RUNNING" | "WAITING" | "BLOCKED"
  | "REVIEW" | "QA" | "COMPLETED" | "FAILED" | "CANCELLED";

export interface QACheckResult {
  name: string;
  automated: boolean;
  passed: boolean;
  summary: string;
  detail?: string;
  duration_ms: number;
}

export interface QAReport {
  passed: boolean;
  checks: QACheckResult[];
  ran_at: number;
}

/** Phase 15-C: one dispatch attempt in the self-healing loop (see self-healing.ts). */
export interface HealingAttemptSummary {
  attempt: number;
  strategy: string;
  template: string;
  mode: string;
  failure_class: string;
}

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
  retry_count: number;
  max_retries: number;
  qa_report: QAReport | null;
  healing_attempts: HealingAttemptSummary[];
}

/**
 * Phase 15-B: tool names the authority gate already tags `git_operation`/
 * `read_data` for (src/authority/tool-action-map.ts) - not project-scoped,
 * since audit_trail has no project_id column; this is recent activity
 * across the whole daemon, not just the selected project.
 */
const GITHUB_TOOL_NAMES = [
  "git_commit", "git_push", "git_force_push", "git_pull", "git_branch_create",
  "github_create_issue", "github_create_pr", "github_pr_status", "github_pr_review",
] as const;

export interface GitHubActivityEntry {
  id: string;
  tool_name: string;
  authority_decision: "allowed" | "denied" | "approval_required";
  executed: 0 | 1;
  created_at: number;
}

export interface Decision {
  id: string;
  project_id: string | null;
  statement: string;
  reason: string | null;
  made_by: string;
  created_at: number;
}

export interface Handoff {
  id: string;
  from_agent: string;
  to_agent: string;
  priority: string;
  created_at: number;
  task_id: string | null;
  handoff: {
    status: "completed" | "failed" | "needs_input";
    summary: string;
    warnings: string[];
    open_questions: string[];
    next_action: string;
  } | null;
}

export interface AgentPerformance {
  agent: string;
  tasks_completed: number;
  tasks_failed: number;
  tasks_cancelled: number;
  success_rate: number | null;
  average_duration_ms: number | null;
  llm_error_rate: number | null;
  llm_calls: number;
  providers_used: string[];
  models_used: string[];
}

export interface CouncilOpinion {
  seat: string;
  mode: "cheap" | "balanced" | "quality";
  tier: string;
  content: string;
  confidence: number | null;
  error?: string;
}

export interface CouncilVerdict {
  question: string;
  opinions: CouncilOpinion[];
  synthesis: string;
  contradictions: string[];
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
  const [handoffs, setHandoffs] = useState<Handoff[]>([]);
  const [agentPerformance, setAgentPerformance] = useState<AgentPerformance[]>([]);
  const [githubActivity, setGithubActivity] = useState<GitHubActivityEntry[]>([]);
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
      const [tasksResp, decisionsResp, handoffsResp, performanceResp, githubResp] = await Promise.all([
        fetch(`/api/ai-manager/projects/${encodeURIComponent(projectId)}/tasks`),
        fetch(`/api/ai-manager/projects/${encodeURIComponent(projectId)}/decisions`),
        fetch(`/api/ai-manager/projects/${encodeURIComponent(projectId)}/handoffs`),
        fetch(`/api/ai-manager/agents/performance?project_id=${encodeURIComponent(projectId)}`),
        fetch(`/api/authority/audit?tools=${GITHUB_TOOL_NAMES.join(",")}&limit=20`),
      ]);
      setTasks(tasksResp.ok ? ((await tasksResp.json()) as ProjectTask[]) : []);
      setDecisions(decisionsResp.ok ? ((await decisionsResp.json()) as Decision[]) : []);
      setHandoffs(handoffsResp.ok ? ((await handoffsResp.json()) as Handoff[]) : []);
      setAgentPerformance(performanceResp.ok ? ((await performanceResp.json()) as AgentPerformance[]) : []);
      setGithubActivity(githubResp.ok ? ((await githubResp.json()) as GitHubActivityEntry[]) : []);
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
      setGithubActivity([]);
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
      cost_mode?: CostMode;
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

  /** Phase 12-A: Cheap/Balanced/Quality cost mode selector. */
  const updateCostMode = useCallback(
    async (id: string, cost_mode: CostMode): Promise<ActionResult> => {
      try {
        const resp = await fetch(`/api/ai-manager/projects/${encodeURIComponent(id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cost_mode }),
        });
        if (!resp.ok) throw new Error(await parseErrorMessage(resp));
        await refreshProjects();
        return { ok: true, message: `Cost mode set to ${cost_mode}.` };
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : "Failed" };
      }
    },
    [refreshProjects],
  );

  /** Phase 15-A: live execution_mode edit, mirrors updateCostMode. */
  const updateExecutionMode = useCallback(
    async (id: string, execution_mode: ExecutionMode): Promise<ActionResult> => {
      try {
        const resp = await fetch(`/api/ai-manager/projects/${encodeURIComponent(id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ execution_mode }),
        });
        if (!resp.ok) throw new Error(await parseErrorMessage(resp));
        await refreshProjects();
        return { ok: true, message: `Execution mode set to ${execution_mode}.` };
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : "Failed" };
      }
    },
    [refreshProjects],
  );

  /** Phase 16-A: live rules edit, mirrors updateExecutionMode/updateCostMode. */
  const updateProjectRules = useCallback(
    async (id: string, rules: string[]): Promise<ActionResult> => {
      try {
        const resp = await fetch(`/api/ai-manager/projects/${encodeURIComponent(id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rules }),
        });
        if (!resp.ok) throw new Error(await parseErrorMessage(resp));
        await refreshProjects();
        return { ok: true, message: "Rules updated." };
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : "Failed" };
      }
    },
    [refreshProjects],
  );

  /** Phase 11-A: the only way back to running for a WAITING subtask. */
  const resumeTask = useCallback(
    async (projectId: string, taskId: string, input: string): Promise<ActionResult> => {
      try {
        const resp = await fetch(
          `/api/ai-manager/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/resume`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ input }),
          },
        );
        if (!resp.ok) throw new Error(await parseErrorMessage(resp));
        if (selectedId === projectId) await refreshDetail(projectId);
        return { ok: true, message: "Task resumed." };
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : "Failed to resume task" };
      }
    },
    [refreshDetail, selectedId],
  );

  /** AI Council (spec section 16) - fans a question out to several seats and synthesizes a verdict. */
  const askCouncil = useCallback(
    async (projectId: string, question: string): Promise<{ ok: true; verdict: CouncilVerdict } | { ok: false; message: string }> => {
      try {
        const resp = await fetch("/api/ai-manager/council", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question, project_id: projectId, record: true }),
        });
        if (!resp.ok) throw new Error(await parseErrorMessage(resp));
        const verdict = (await resp.json()) as CouncilVerdict;
        if (selectedId === projectId) await refreshDetail(projectId);
        return { ok: true, verdict };
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : "Council convene failed" };
      }
    },
    [refreshDetail, selectedId],
  );

  /**
   * Phase 16-C: dashboard-triggered GitHub actions, wrapping the same
   * `execute()` a `github_*` tool call would use, gated the same way
   * (see routes.ts's `/api/ai-manager/github/action`). `repo_path` is a
   * plain local filesystem path - projects have no persisted repo mapping
   * yet, so the caller supplies it per call, same as an agent tool call.
   */
  const githubAction = useCallback(
    async (input: {
      tool: "github_create_issue" | "github_create_pr" | "github_pr_status" | "github_pr_review";
      repo_path: string;
      title?: string;
      body?: string;
      head?: string;
      base?: string;
      number?: number;
      event?: string;
    }): Promise<{ ok: true; result: string } | { ok: false; message: string }> => {
      try {
        const resp = await fetch("/api/ai-manager/github/action", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        });
        if (!resp.ok) throw new Error(await parseErrorMessage(resp));
        const { result } = (await resp.json()) as { result: string };
        if (selectedId) await refreshDetail(selectedId);
        return { ok: true, result };
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : "GitHub action failed" };
      }
    },
    [refreshDetail, selectedId],
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
    handoffs,
    agentPerformance,
    githubActivity,
    loading,
    detailLoading,
    running,
    error,
    refresh: refreshProjects,
    runProject,
    updateStatus,
    updateCostMode,
    updateExecutionMode,
    updateProjectRules,
    addDecision,
    resumeTask,
    askCouncil,
    githubAction,
  };
}
