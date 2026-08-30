import { WorkflowFile } from "../types/workflow";
import { AiServiceList } from "../types/aiService";

function friendlyError(context: string, err: unknown): Error {
  if (err && typeof err === "object" && "issues" in err) {
    // ZodError: surface the first issue's path/message instead of a raw dump
    const issues = (err as { issues: { path: (string | number)[]; message: string }[] }).issues;
    const first = issues[0];
    const where = first?.path?.length ? ` (${first.path.join(".")})` : "";
    return new Error(`${context}: 形式が不正です${where} — ${first?.message ?? ""}`);
  }
  return new Error(`${context}: ${err instanceof Error ? err.message : String(err)}`);
}

export async function fetchWorkflow(): Promise<WorkflowFile> {
  const res = await fetch("/api/workflow");
  if (!res.ok) throw new Error("workflow.json の取得に失敗しました");
  const json = await res.json();
  try {
    return WorkflowFile.parse(json);
  } catch (err) {
    throw friendlyError("workflow.json", err);
  }
}

export async function saveWorkflow(workflow: WorkflowFile): Promise<void> {
  const res = await fetch("/api/workflow", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(workflow),
  });
  if (!res.ok) throw new Error("workflow.json の保存に失敗しました");
}

export async function fetchAiServices(): Promise<AiServiceList> {
  const res = await fetch("/api/ai-services");
  if (!res.ok) throw new Error("ai_services.json の取得に失敗しました");
  const json = await res.json();
  try {
    return AiServiceList.parse(json);
  } catch (err) {
    throw friendlyError("ai_services.json", err);
  }
}

export async function saveAiServices(services: AiServiceList): Promise<void> {
  const res = await fetch("/api/ai-services", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(services),
  });
  if (!res.ok) throw new Error("ai_services.json の保存に失敗しました");
}

export type ArtifactFile = { path: string; mtimeMs: number };

export async function fetchArtifactList(projectId: string): Promise<ArtifactFile[]> {
  const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/artifacts`);
  if (!res.ok) throw new Error("成果物一覧の取得に失敗しました");
  const json = await res.json();
  return json.files as ArtifactFile[];
}

export async function fetchArtifactContent(projectId: string, relPath: string): Promise<string> {
  const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/artifacts/${relPath}`);
  if (!res.ok) throw new Error("ファイルの取得に失敗しました");
  return res.text();
}

export async function saveArtifactContent(projectId: string, relPath: string, content: string): Promise<void> {
  const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/artifacts/${relPath}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
  if (!res.ok) throw new Error("ファイルの保存に失敗しました");
}

export type ExecuteResult = {
  exitCode: number;
  timedOut: boolean;
  timeoutMs?: number;
  stdout: string;
  stderr: string;
};

export async function executeCommand(projectId: string, command: string): Promise<ExecuteResult> {
  const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/execute`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ command }),
  });
  if (!res.ok) throw new Error("コマンドの実行に失敗しました");
  return res.json();
}

// A long-running tab (this app is meant to stay open all day) can lose its
// WebSocket to a dev-server restart, a sleeping laptop, or a flaky network.
// Without reconnecting, the tab silently stops seeing server-side changes
// forever — e.g. a newly created project never appears, since only a
// fs-change message ever triggers a re-fetch. Retrying (with backoff, capped
// so it doesn't hammer a server that's actually down) keeps the tab live
// without the user needing to know to hit refresh.
export function connectFsWatch(onChange: () => void): () => void {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  let closedByCaller = false;
  let socket: WebSocket | null = null;
  let retryDelay = 1000;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  function connect() {
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    socket = ws;
    ws.onopen = () => {
      retryDelay = 1000;
      // The tab may have missed changes while disconnected — catch up now.
      onChange();
    };
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "fs-change") onChange();
      } catch {
        // ignore malformed messages
      }
    };
    ws.onclose = () => {
      if (closedByCaller) return;
      retryTimer = setTimeout(connect, retryDelay);
      retryDelay = Math.min(retryDelay * 2, 15000);
    };
  }
  connect();

  return () => {
    closedByCaller = true;
    if (retryTimer) clearTimeout(retryTimer);
    socket?.close();
  };
}
