import { useCallback, useEffect, useState } from "react";

/**
 * "Pin an active project" to the classic chat session (Phase 14-A). Backend
 * state (AgentService.activeProjectId, in-memory, single-session) via
 * GET/POST /api/chat/active-project - unlike useChatDisplayMode.ts this is
 * NOT a client-only preference, since the pin changes what vault memory the
 * daemon retrieves for chat turns. A minimal list of AI Manager projects to
 * populate the picker is fetched once from the existing
 * GET /api/ai-manager/projects endpoint (see useAIManagerData.ts).
 */

export interface ActiveProjectOption {
  id: string;
  name: string;
}

export function useActiveProject() {
  const [projects, setProjects] = useState<ActiveProjectOption[]>([]);
  const [activeProjectId, setActiveProjectIdState] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [projectsResp, activeResp] = await Promise.all([
          fetch("/api/ai-manager/projects?status=active"),
          fetch("/api/chat/active-project"),
        ]);
        if (!cancelled && projectsResp.ok) {
          const data = (await projectsResp.json()) as Array<{ id: string; name: string }>;
          setProjects(Array.isArray(data) ? data.map((p) => ({ id: p.id, name: p.name })) : []);
        }
        if (!cancelled && activeResp.ok) {
          const data = (await activeResp.json()) as { project_id: string | null };
          setActiveProjectIdState(data.project_id ?? null);
        }
      } catch {
        // Best-effort - the picker just stays empty/unpinned on failure.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const setActiveProject = useCallback(async (projectId: string | null) => {
    // Optimistic - the daemon is the source of truth but a failed request
    // shouldn't leave the picker showing a pin that didn't take.
    const previous = activeProjectId;
    setActiveProjectIdState(projectId);
    try {
      const resp = await fetch("/api/chat/active-project", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: projectId }),
      });
      if (!resp.ok) setActiveProjectIdState(previous);
    } catch {
      setActiveProjectIdState(previous);
    }
  }, [activeProjectId]);

  return { projects, activeProjectId, setActiveProject, loading };
}
