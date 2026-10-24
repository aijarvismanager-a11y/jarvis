// Shapes returned by /api/v2 (mirrors server/core/store.ts; kept separate so the UI never imports server code).

export type MissionStatus = "draft" | "planning" | "running" | "paused" | "completed" | "failed" | "cancelled";
export type TaskStatus = "pending" | "ready" | "running" | "waiting" | "validation" | "completed" | "failed" | "blocked" | "cancelled" | "paused";

export type Project = { id: string; name: string; status: "active" | "archived"; createdAt: string; updatedAt: string };
export type Mission = {
  id: string;
  projectId: string;
  goal: string;
  constraints: string[];
  technologyPreferences: string[];
  budgetPolicy: "free_only" | "allow_paid";
  status: MissionStatus;
  createdAt: string;
  updatedAt: string;
};
export type Task = {
  id: string;
  updatedAt: string;
  missionId: string;
  role: string;
  objective: string;
  expectedOutputs: string[];
  selectedAi: string | null;
  automationLevel: number;
  status: TaskStatus;
  retryCount: number;
  validation: unknown;
  position: number;
  dependsOn: string[];
};
export type Artifact = {
  id: string;
  taskId: string | null;
  path: string;
  version: number;
  createdBy: string;
  createdAt: string;
  sourceAi: string | null;
  sourceUrl: string | null;
  validationStatus: string;
};
export type AiRun = { id: string; task_id: string | null; ai_id: string | null; executor: string; automation_level: number; status: string; started_at: string; finished_at: string | null; summary: string | null; duration_ms: number | null; cost_usd: number | null; input_tokens: number | null; output_tokens: number | null };
export type AiService = {
  id: string;
  name: string;
  url: string | null;
  freeStatus: string;
  automationLevel: number;
  accessMode: string;
  status: string;
  lastVerifiedAt: string | null;
  capabilities: string[];
  requiresApiKey: boolean;
  limitations: string | null;
};
export type PlanDraft = {
  summary: string;
  tasks: { key: string; role: string; objective: string; expectedOutputs: string[]; dependsOn: string[] }[];
};
export type Proposal = { kind: "initial" | "replan"; draft: PlanDraft; feedback?: string; createdAt: string };
export type MissionView = { mission: Mission; tasks: Task[]; proposal: Proposal | null };
export type Overview = { missions: Mission[]; tasks: Task[]; artifacts: Artifact[]; aiRuns: AiRun[]; taskNotes?: Record<string, string> };
export type Preview = {
  state: "stopped" | "starting" | "running" | "error";
  url: string | null;
  message: string;
  startedAt: string | null;
  check: { ok: boolean; problems: string[] } | null;
  log: string;
};
export type LogEntry = { seq: number; at: string; kind: "text" | "tool" | "info" | "error"; text: string };
export type Approval = { id: string; projectId: string; taskId: string; level: "READ" | "WORKSPACE_WRITE" | "NETWORK" | "DEPLOY" | "DESTRUCTIVE"; reason: string; createdAt: string };
export type Handoff = {
  id: string;
  projectId: string;
  taskId: string;
  aiId: string;
  aiName: string;
  url: string | null;
  level: 1 | 2;
  note: string | null;
  prompt: string;
  status: "pending" | "submitted" | "skipped" | "cancelled";
  createdAt: string;
  /** Other web AIs this task could be handed to instead. */
  alternatives?: { id: string; name: string; freeStatus: string }[];
};
export type WebAiSettings = { enabled: boolean; available: boolean; browserAvailable: boolean; sites: Record<string, unknown>; bundledSites: string[] };
export type StoredEvent = { id: number; type: string; taskId: string | null; payload: unknown; createdAt: string };

export type MissionReport = {
  missionId: string;
  verdict: "verified" | "partial" | "unfinished";
  verdictLabel: string;
  tasks: { id: string; objective: string; status: string; level: number; attempts: number; isCode: boolean }[];
  notChecked: string[];
  notes: string[];
  markdown: string;
};
export type TaskChanges = { files: { path: string; status: "added" | "modified" | "deleted" }[]; patch: string; truncated: boolean };
export type SnapshotInfo = { name: string; taskId: string; objective: string; at: string };

export type SyncEntry = { path: string; kind: "added" | "modified" | "deleted"; conflict: boolean };
export type SyncBackup = { id: string; createdAt: string; files: { path: string; kind: SyncEntry["kind"]; hadOriginal: boolean }[] };
export type SyncState = { linked: false } | { linked: true; sourcePath: string; entries: SyncEntry[]; backups: SyncBackup[]; problem?: string };
