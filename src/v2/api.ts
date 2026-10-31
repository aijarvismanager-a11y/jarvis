import type { TuningReport, AiService, Approval, Handoff, LogEntry, Preview, MissionView, Overview, Project, ProjectSummary, ClaudeQuota, ClaudeLimit, Environment, StoredEvent, TaskChanges, MissionReport, SnapshotInfo, ClaudeStatus, DepsState, ImportProgress, SyncState, SyncSummary, WebAiSettings } from "./types";

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

/** An error answer from the server, keeping the JSON body (some carry details beyond the message). */
export class ApiError extends Error {
  readonly status: number;
  readonly data: Record<string, unknown>;
  constructor(message: string, status: number, data: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.data = data;
  }
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
  if (!res.ok) throw new ApiError(json.error ?? `リクエストに失敗しました(${res.status})`, res.status, json);
  return json as T;
}

const mission = (projectId: string, missionId: string) => `/projects/${encodeURIComponent(projectId)}/missions/${encodeURIComponent(missionId)}`;

/** null = the server predates /api/version, which itself means it is running old code. */
async function serverVersion(): Promise<{ stale: boolean; startedAt: string; version?: string } | null> {
  const res = await fetch("/api/version");
  if (res.status === 404) return null;
  if (!res.ok) throw new Error("バージョンを確認できませんでした");
  return (await res.json()) as { stale: boolean; startedAt: string; version?: string };
}

export const api = {
  serverVersion,
  projectsSummary: () => request<{ summary: ProjectSummary[] }>("/projects-summary").then((r) => r.summary),
  projects: () => request<{ projects: Project[] }>("/projects").then((r) => r.projects),
  deleteProject: (projectId: string) => request<{ ok: boolean }>(`/projects/${encodeURIComponent(projectId)}`, "DELETE"),
  createProject: (name: string) => request<{ project: Project }>("/projects", "POST", { name }).then((r) => r.project),
  importProject: (path: string, exclude: string[] = [], carryHistory = false, name = "") =>
    request<{ project: Project; existing?: boolean; missionId: string | null; files: number; bytes: number; skippedSecrets: string[]; excluded?: string[]; history?: { ok: true; sessions: number; turns: number } | { ok: false; error: string } | null }>("/projects/import", "POST", { path, name, exclude, carryHistory }),
  importHistory: (path: string) => request<{ found: boolean; sessions: number; lastAt: string | null }>(`/projects/import/history?path=${encodeURIComponent(path)}`),
  importProgress: () => request<{ progress: ImportProgress | null }>("/projects/import/progress").then((r) => r.progress),
  pickFolder: () => request<{ path: string | null }>("/system/pick-folder", "POST", {}).then((r) => r.path),
  systemStatus: (force = false) => request<{ claude: ClaudeStatus }>(`/system/status${force ? "?force=1" : ""}`).then((r) => r.claude),
  restartServer: (force = false) => request<{ ok: boolean; running: number }>("/system/restart", "POST", { force }),
  deps: (projectId: string) => request<DepsState>(`/projects/${encodeURIComponent(projectId)}/deps`),
  installDeps: (projectId: string) => request<{ install: DepsState["install"] }>(`/projects/${encodeURIComponent(projectId)}/deps/install`, "POST", {}),
  sync: (projectId: string) => request<SyncState>(`/projects/${encodeURIComponent(projectId)}/sync`),
  syncSummary: (projectId: string) => request<SyncSummary>(`/projects/${encodeURIComponent(projectId)}/sync/summary`),
  applySync: (projectId: string, opts: { deletes: boolean; overwriteConflicts: boolean; direction: "push" | "pull"; paths?: string[] }) =>
    request<{ applied: number; skipped: unknown[]; backup: string | null; repaired?: string[] }>(`/projects/${encodeURIComponent(projectId)}/sync/apply`, "POST", opts),
  restoreSync: (projectId: string, backupId: string, direction: "push" | "pull") => request<{ ok: boolean }>(`/projects/${encodeURIComponent(projectId)}/sync/restore`, "POST", { backupId, direction }),
  overview: (projectId: string) => request<Overview>(`/projects/${encodeURIComponent(projectId)}/overview`),
  aiSelections: (projectId: string) => request<{ events: StoredEvent[] }>(`/projects/${encodeURIComponent(projectId)}/ai-selections`).then((r) => r.events),
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

  claudeQuota: () => request<{ quota: ClaudeQuota | null }>("/claude-quota").then((r) => r.quota),
  claudeLimit: () => request<ClaudeLimit>("/claude-limit"),
  setClaudeLimitPolicy: (policy: "wait" | "reroute" | null) => request<{ policy: string | null }>("/claude-limit", "PUT", { policy }),
  refreshClaudeQuota: () => request<{ quota: ClaudeQuota }>("/claude-quota/refresh", "POST", {}).then((r) => r.quota),
  environment: (projectId: string | null) => request<Environment>(`/environment${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ""}`),
  aiUsage: () => request<{ usage: Record<string, { last3h: number; last24h: number; lastAt: string | null }> }>("/ai-usage").then((r) => r.usage),
  aiServices: () => request<{ services: AiService[] }>("/ai-services").then((r) => r.services),
  healthCheck: () => request<{ services: AiService[] }>("/ai-services/health-check", "POST", {}).then((r) => r.services),
  setAutomationLevel: (aiId: string, level: number) => request<{ service: AiService }>(`/ai-services/${encodeURIComponent(aiId)}/automation-level`, "PUT", { level }),
  openLogin: (aiId: string) => request<{ ok: boolean; url: string }>(`/ai-services/${encodeURIComponent(aiId)}/open-login`, "POST", {}),
  openCheck: (aiId: string) => request<{ ok: boolean; url: string }>(`/ai-services/${encodeURIComponent(aiId)}/open-check`, "POST", {}),
  webAiSettings: () => request<WebAiSettings>("/web-ai/settings"),
  browserStatus: () => request<{ loginWindowOpen: boolean; waiting: number }>("/web-ai/browser-status"),
  importSignIn: () => request<{ ok: boolean; profile: string; copied: string[] }>("/web-ai/import-signin", "POST", {}),
  tryAutomation: (aiId: string) => request<{ ok: boolean; reason?: string; service?: AiService }>(`/ai-services/${encodeURIComponent(aiId)}/try-automation`, "POST", {}),
  setLoggedIn: (aiId: string, value: boolean) => request<{ aiId: string; loggedIn: boolean }>(`/ai-services/${encodeURIComponent(aiId)}/logged-in`, "PUT", { value }),
  scoreTuning: () => request<TuningReport>("/score-tuning"),
  setScoreTuning: (enabled: boolean) => request<TuningReport>("/score-tuning", "PUT", { enabled }),
  resetScoreTuning: (aiId?: string) => request<TuningReport>("/score-tuning/reset", "POST", aiId ? { aiId } : {}),
  aiReviewSettings: () => request<{ enabled: boolean; webAiEnabled: boolean; reviewer: string | null }>("/ai-review/settings"),
  setAiReview: (enabled: boolean) => request<{ enabled: boolean }>("/ai-review/settings", "PUT", { enabled }),
  setWebAi: (enabled: boolean) => request<{ enabled: boolean }>("/web-ai/settings", "PUT", { enabled }),
};
