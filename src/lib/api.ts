import { Workflow } from "../types/workflow";
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

export async function fetchWorkflow(): Promise<Workflow> {
  const res = await fetch("/api/workflow");
  if (!res.ok) throw new Error("workflow.json の取得に失敗しました");
  const json = await res.json();
  try {
    return Workflow.parse(json);
  } catch (err) {
    throw friendlyError("workflow.json", err);
  }
}

export async function saveWorkflow(workflow: Workflow): Promise<void> {
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

export async function fetchArtifactList(): Promise<ArtifactFile[]> {
  const res = await fetch("/api/artifacts");
  if (!res.ok) throw new Error("成果物一覧の取得に失敗しました");
  const json = await res.json();
  return json.files as ArtifactFile[];
}

export async function fetchArtifactContent(relPath: string): Promise<string> {
  const res = await fetch(`/api/artifacts/${relPath}`);
  if (!res.ok) throw new Error("ファイルの取得に失敗しました");
  return res.text();
}

export function connectFsWatch(onChange: () => void): () => void {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === "fs-change") onChange();
    } catch {
      // ignore malformed messages
    }
  };
  return () => ws.close();
}
