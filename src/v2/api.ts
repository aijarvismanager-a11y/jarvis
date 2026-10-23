import type { AiService, Approval, Handoff, MissionView, Overview, Project, StoredEvent, WebAiSettings } from "./types";

const BASE = "/api/v2";

// Per-launch token for state changes; refreshed once if the server restarted (a stale token gets 403).
let token: string | null = null;
async function getToken(refresh = false): Promise<string> {
  if (token && !refresh) return token;
  const res = await fetch("/api/session-token");
  if (!res.ok) throw new Error("実行トークンの取得に失敗しました");
  token = ((await res.json()) as { token: string }).token;
  return token;
}

async function request<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const send = async (refresh: boolean) =>
    fetch(BASE + path, {
      method,
      headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(method !== "GET" ? { "x-orchestrator-token": await getToken(refresh) } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  let res = await send(false);
  if (res.status === 403 && method !== "GET") res = await send(true);
  const json = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(json.error ?? `リクエストに失敗しました(${res.status})`);
  return json as T;
}

const mission = (projectId: string, missionId: string) => `/projects/${encodeURIComponent(projectId)}/missions/${encodeURIComponent(missionId)}`;

export const api = {
  projects: () => request<{ projects: Project[] }>("/projects").then((r) => r.projects),
  createProject: (name: string) => request<{ project: Project }>("/projects", "POST", { name }).then((r) => r.project),
  overview: (projectId: string) => request<Overview>(`/projects/${encodeURIComponent(projectId)}/overview`),
  events: (projectId: string) => request<{ events: StoredEvent[] }>(`/projects/${encodeURIComponent(projectId)}/events`).then((r) => r.events),
  artifactContent: (projectId: string, path: string) => request<{ content: string }>(`/projects/${encodeURIComponent(projectId)}/artifact-content?path=${encodeURIComponent(path)}`).then((r) => r.content),

  missionView: (projectId: string, missionId: string) => request<MissionView>(mission(projectId, missionId)),
  createMission: (projectId: string, goal: string, constraints: string[], technologyPreferences: string[]) =>
    request<MissionView>(`/projects/${encodeURIComponent(projectId)}/missions`, "POST", { goal, constraints, technologyPreferences }),
  missionAction: (projectId: string, missionId: string, action: "approve" | "reject" | "replan" | "pause" | "cancel" | "run" | "resume", feedback = "") =>
    request<MissionView>(`${mission(projectId, missionId)}/${action}`, "POST", { feedback }),

  approvals: () => request<{ approvals: Approval[] }>("/approvals").then((r) => r.approvals),
  answerApproval: (id: string, approve: boolean) => request<{ ok: boolean }>(`/approvals/${encodeURIComponent(id)}/${approve ? "approve" : "deny"}`, "POST", {}),

  handoffs: () => request<{ handoffs: Handoff[] }>("/web-handoffs?status=pending").then((r) => r.handoffs),
  submitHandoff: (id: string, text: string) => request<{ handoff: Handoff }>(`/web-handoffs/${encodeURIComponent(id)}/result`, "POST", { text }),
  skipHandoff: (id: string) => request<{ handoff: Handoff }>(`/web-handoffs/${encodeURIComponent(id)}/skip`, "POST", {}),

  aiServices: () => request<{ services: AiService[] }>("/ai-services").then((r) => r.services),
  healthCheck: () => request<{ services: AiService[] }>("/ai-services/health-check", "POST", {}).then((r) => r.services),
  setAutomationLevel: (aiId: string, level: number) => request<{ service: AiService }>(`/ai-services/${encodeURIComponent(aiId)}/automation-level`, "PUT", { level }),
  webAiSettings: () => request<WebAiSettings>("/web-ai/settings"),
  setWebAi: (enabled: boolean) => request<{ enabled: boolean }>("/web-ai/settings", "PUT", { enabled }),
};
