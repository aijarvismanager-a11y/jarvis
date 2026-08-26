import { Workflow } from "../types/workflow";

export async function fetchWorkflow(): Promise<Workflow> {
  const res = await fetch("/api/workflow");
  if (!res.ok) throw new Error("workflow.json の取得に失敗しました");
  const json = await res.json();
  return Workflow.parse(json);
}

export async function saveWorkflow(workflow: Workflow): Promise<void> {
  const res = await fetch("/api/workflow", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(workflow),
  });
  if (!res.ok) throw new Error("workflow.json の保存に失敗しました");
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
