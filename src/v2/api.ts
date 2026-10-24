import type { AiService, Approval, Handoff, LogEntry, Preview, MissionView, Overview, Project, StoredEvent, TaskChanges, MissionReport, SnapshotInfo, SyncState, WebAiSettings } from "./types";

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
  importProject: (path: string, name = "") =>
    request<{ project: Project; existing?: boolean; missionId: string | null; files: number; bytes: number; skippedSecrets: string[] }>("/projects/import", "POST", { path, name }),
  sync: (projectId: string) => request<SyncState>(`/projects/${encodeURIComponent(projectId)}/sync`),
  applySync: (projectId: string, opts: { deletes: boolean; overwriteConflicts: boolean; direction: "push" | "pull" }) =>
    request<{ applied: number; skipped: unknown[]; backup: string | null }>(`/projects/${encodeURIComponent(projectId)}/sync/apply`, "POST", opts),
  restoreSync: (projectId: string, backupId: string, direction: "push" | "pull") => request<{ ok: boolean }>(`/projects/${encodeURIComponent(projectId)}/sync/restore`, "POST", { backupId, direction }),
  overview: (projectId: string) => request<Overview>(`/projects/${encodeURIComponent(projectId)}/overview`),
  events: (projectId: string) => request<{ events: StoredEvent[] }>(`/projects/${encodeURIComponent(projectId)}/events`).then((r) => r.events),
  artifactContent: (projectId: string, path: string) => request<{ content: string }>(`/projects/${encodeURIComponent(projectId)}/artifact-content?path=${encodeURIComponent(path)}`).then((r) => r.content),

  missionView: (projectId: string, missionId: string) => request<MissionView>(mission(projectId, missionId)),
  createMission: (projectId: string, goal: string, constraints: string[], technologyPreferences: string[]) =>
    request<MissionView>(`/projects/${encodeURIComponent(projectId)}/missions`, "POST", { goal, constraints, technologyPreferences }),
  missionAction: (projectId: string, missionId: string, action: "approve" | "reject" | "replan" | "redirect" | "pause" | "cancel" | "run" | "resume", feedback = "") =>
    request<MissionView>(`${mission(projectId, missionId)}/${action}`, "POST", { feedback }),
  approveAndRun: (projectId: string, missionId: string) => request<MissionView>(`${mission(projectId, missionId)}/approve`, "POST", { run: true }),

  retryTask: (projectId: string, missionId: string, taskId: string, feedback = "") =>
    request<MissionView>(`${mission(projectId, missionId)}/tasks/${encodeURIComponent(taskId)}/retry`, "POST", { feedback }),
  taskLog: (projectId: string, taskId: string, after = 0) =>
    request<{ status: string; entries: LogEntry[] }>(`/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/log?after=${after}`),
  missionReport: (projectId: string, missionId: string) => request<{ report: MissionReport }>(`${mission(projectId, missionId)}/report`).then((r) => r.report),
  taskChanges: (projectId: string, taskId: string) => request<{ changes: TaskChanges | null }>(`/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/changes`).then((r) => r.changes),
  rollbackTask: (projectId: string, taskId: string) => request<{ restored: string[] }>(`/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/rollback`, "POST", {}),
  snapshots: (projectId: string) => request<{ snapshots: SnapshotInfo[] }>(`/projects/${encodeURIComponent(projectId)}/snapshots`).then((r) => r.snapshots),
  snapshotSiteUrl: (projectId: string, name: string, which: "before" | "after") => `${BASE}/projects/${encodeURIComponent(projectId)}/snapshot-site/${encodeURIComponent(name)}/${which}/`,
  preview: (projectId: string) => request<{ preview: Preview | null }>(`/projects/${encodeURIComponent(projectId)}/preview`).then((r) => r.preview),
  startPreview: (projectId: string) => request<{ preview: Preview }>(`/projects/${encodeURIComponent(projectId)}/preview/start`, "POST", {}).then((r) => r.preview),
  stopPreview: (projectId: string) => request<{ preview: Preview }>(`/projects/${encodeURIComponent(projectId)}/preview/stop`, "POST", {}).then((r) => r.preview),
  approvals: () => request<{ approvals: Approval[] }>("/approvals").then((r) => r.approvals),
  answerApproval: (id: string, approve: boolean) => request<{ ok: boolean }>(`/approvals/${encodeURIComponent(id)}/${approve ? "approve" : "deny"}`, "POST", {}),

  handoffs: () => request<{ handoffs: Handoff[] }>("/web-handoffs?status=pending").then((r) => r.handoffs),
  submitHandoff: (id: string, text: string) => request<{ handoff: Handoff }>(`/web-handoffs/${encodeURIComponent(id)}/result`, "POST", { text }),
  reassignHandoff: (id: string, aiId: string) => request<{ handoff: Handoff }>(`/web-handoffs/${encodeURIComponent(id)}/reassign`, "POST", { aiId }),
  skipHandoff: (id: string) => request<{ handoff: Handoff }>(`/web-handoffs/${encodeURIComponent(id)}/skip`, "POST", {}),

  aiServices: () => request<{ services: AiService[] }>("/ai-services").then((r) => r.services),
  healthCheck: () => request<{ services: AiService[] }>("/ai-services/health-check", "POST", {}).then((r) => r.services),
  setAutomationLevel: (aiId: string, level: number) => request<{ service: AiService }>(`/ai-services/${encodeURIComponent(aiId)}/automation-level`, "PUT", { level }),
  openLogin: (aiId: string) => request<{ ok: boolean; url: string }>(`/ai-services/${encodeURIComponent(aiId)}/open-login`, "POST", {}),
  webAiSettings: () => request<WebAiSettings>("/web-ai/settings"),
  setWebAi: (enabled: boolean) => request<{ enabled: boolean }>("/web-ai/settings", "PUT", { enabled }),
};
