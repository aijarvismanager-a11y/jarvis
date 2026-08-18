import { useCallback, useEffect, useRef, useState } from "react";
import { parseErrorMessage } from "../apiUtil";

const POLL_INTERVAL_MS = 8000;

export type WorkerType = "claude_code" | "gemini" | "chatgpt" | "custom";
export type WorkerStatus = "ready" | "working" | "waiting" | "handoff" | "error" | "done" | "disabled";
export type WorkerCapability = "code" | "research" | "write" | "plan" | "image" | "general";
export type TaskTemplate = "research" | "code" | "plan" | "write" | "general";

export interface WorkerSummary {
  name: string;
  type: WorkerType;
  status: WorkerStatus;
  capabilities: WorkerCapability[];
  input_method: string;
  output_method: string;
  timeout_ms: number;
  retry: number;
  enabled: boolean;
}

export interface FileHandoff {
  task_id: string;
  from: string;
  to: string;
  status: "ready" | "in_progress" | "completed" | "failed" | "needs_input";
  summary: string;
  instructions: string;
  files: string[];
  research: string[];
  next_action: string;
}

export interface TaskOutcome {
  worker: string;
  result: {
    status: "completed" | "failed" | "needs_input";
    summary: string;
    output: string;
    files: string[];
    error?: string;
  };
  handoffFilePath: string;
}

/**
 * Workers Room hook - the dashboard surface for the external AI Worker
 * layer (spec section 3/10/17/23: AI Status / Task / Handoff). Polls
 * /api/orchestrator/{workers,handoffs} the same way useAIManagerData polls
 * /api/ai-manager/projects; a run POST returns the settled outcome
 * directly (TaskWorkerRunner.run blocks until the Worker's subprocess
 * exits), so no separate "task in progress" polling is needed yet.
 */
export function useWorkersData() {
  const [workers, setWorkers] = useState<WorkerSummary[]>([]);
  const [handoffs, setHandoffs] = useState<FileHandoff[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const inFlightRef = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const [workersResp, handoffsResp] = await Promise.all([
        fetch("/api/orchestrator/workers"),
        fetch("/api/orchestrator/handoffs"),
      ]);
      if (workersResp.ok) {
        const data = (await workersResp.json()) as { workers: WorkerSummary[] };
        setWorkers(Array.isArray(data.workers) ? data.workers : []);
      }
      if (handoffsResp.ok) {
        const data = (await handoffsResp.json()) as { handoffs: FileHandoff[] };
        setHandoffs(Array.isArray(data.handoffs) ? data.handoffs : []);
      }
      if (!workersResp.ok) setError(await parseErrorMessage(workersResp));
      else if (!handoffsResp.ok) setError(await parseErrorMessage(handoffsResp));
      else setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load Workers");
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = window.setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      refresh();
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [refresh]);

  const setEnabled = useCallback(
    async (name: string, enabled: boolean): Promise<{ ok: boolean; message: string }> => {
      try {
        const resp = await fetch(`/api/orchestrator/workers/${encodeURIComponent(name)}/enabled`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled }),
        });
        if (!resp.ok) throw new Error(await parseErrorMessage(resp));
        await refresh();
        return { ok: true, message: `${name} ${enabled ? "enabled" : "disabled"}.` };
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : "Failed to update Worker" };
      }
    },
    [refresh],
  );

  const addWorker = useCallback(
    async (
      input:
        | { kind: "cli"; name: string; binary: string; args: string[]; capabilities: WorkerCapability[] }
        | { kind: "mcp"; name: string; command: string; args: string[]; tool: string; promptParam?: string; capabilities: WorkerCapability[] },
    ): Promise<{ ok: boolean; message: string }> => {
      const endpoint = input.kind === "cli" ? "/api/orchestrator/custom-workers" : "/api/orchestrator/mcp-workers";
      const { kind: _kind, ...body } = input;
      try {
        const resp = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!resp.ok) throw new Error(await parseErrorMessage(resp));
        await refresh();
        return { ok: true, message: `${input.name} added.` };
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : "Failed to add Worker" };
      }
    },
    [refresh],
  );

  const removeWorker = useCallback(
    async (worker: WorkerSummary): Promise<{ ok: boolean; message: string }> => {
      const endpoint =
        worker.input_method === "mcp"
          ? `/api/orchestrator/mcp-workers/${encodeURIComponent(worker.name)}`
          : `/api/orchestrator/custom-workers/${encodeURIComponent(worker.name)}`;
      try {
        const resp = await fetch(endpoint, { method: "DELETE" });
        if (!resp.ok) throw new Error(await parseErrorMessage(resp));
        await refresh();
        return { ok: true, message: `${worker.name} removed.` };
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : "Failed to remove Worker" };
      }
    },
    [refresh],
  );

  const runTask = useCallback(
    async (input: {
      task_id: string;
      template: TaskTemplate;
      prompt: string;
      worker?: string;
    }): Promise<{ ok: true; outcome: TaskOutcome } | { ok: false; message: string }> => {
      setRunning(true);
      try {
        const resp = await fetch("/api/orchestrator/tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        });
        if (!resp.ok) throw new Error(await parseErrorMessage(resp));
        const outcome = (await resp.json()) as TaskOutcome;
        await refresh();
        return { ok: true, outcome };
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : "Task failed to run" };
      } finally {
        setRunning(false);
      }
    },
    [refresh],
  );

  return { workers, handoffs, loading, running, error, refresh, setEnabled, runTask, addWorker, removeWorker };
}
