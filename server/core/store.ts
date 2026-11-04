import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import type { Db } from "./db.ts";
import { transaction } from "./db.ts";
import { assertProjectId, projectDir, projectSlug } from "./paths.ts";
import type { FreeStatus, MissionStatus, TaskStatus } from "./schema.ts";

// Repository layer over the state database. Every project-scoped method takes
// the projectId explicitly and filters on it, so one project's rows can never
// be read or modified through another project's id. (The schema's composite
// foreign keys additionally stop cross-project references at the DB level.)

const now = () => new Date().toISOString();
const json = (v: unknown) => JSON.stringify(v ?? []);
const parse = <T>(s: string | null | undefined, fallback: T): T => {
  if (s == null) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
};

export type Project = { id: string; name: string; status: "active" | "archived"; legacyId: string | null; createdAt: string; updatedAt: string };
export type Mission = {
  id: string;
  projectId: string;
  goal: string;
  constraints: string[];
  budgetPolicy: "free_only" | "allow_paid";
  technologyPreferences: string[];
  status: MissionStatus;
  createdAt: string;
  updatedAt: string;
};
export type Task = {
  id: string;
  projectId: string;
  missionId: string;
  role: string;
  objective: string;
  inputs: string[];
  expectedOutputs: string[];
  constraints: string[];
  selectedAi: string | null;
  automationLevel: number;
  status: TaskStatus;
  retryCount: number;
  validation: unknown;
  position: number;
  dependsOn: string[];
  createdAt: string;
  updatedAt: string;
};
export type AiService = {
  id: string;
  name: string;
  url: string | null;
  provider: string | null;
  accessMode: string;
  automationLevel: number;
  freeStatus: FreeStatus;
  requiresLogin: boolean;
  requiresApiKey: boolean;
  adapterType: string;
  status: string;
  lastVerifiedAt: string | null;
  legacyName: string | null;
  capabilities: string[];
  /** 0-5 per capability; absent when the capability is registered but not yet scored. */
  capabilityScores: Record<string, number>;
  freeLimit: string | null;
  qualityScore: number | null;
  reliabilityScore: number | null;
  limitations: string | null;
};
export type Artifact = {
  id: string;
  projectId: string;
  taskId: string | null;
  path: string;
  version: number;
  createdBy: string;
  createdAt: string;
  sourceAi: string | null;
  sourceUrl: string | null;
  validationStatus: string;
};
export type StoredEvent = { id: number; projectId: string | null; taskId: string | null; type: string; payload: unknown; createdAt: string };

type Row = Record<string, unknown>;

export class Store {
  readonly db: Db;
  readonly projectsRoot: string;

  constructor(db: Db, projectsRoot: string) {
    this.db = db;
    this.projectsRoot = projectsRoot;
  }

  // ---- projects -----------------------------------------------------------
  createProject(input: { id?: string; name: string; legacyId?: string | null }): Project {
    const id = input.id ?? `${projectSlug(input.name)}_${randomUUID().slice(0, 8)}`;
    assertProjectId(id);
    const ts = now();
    this.db
      .prepare("INSERT INTO projects (id, name, legacy_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
      .run(id, input.name, input.legacyId ?? null, ts, ts);
    this.appendEvent({ projectId: id, type: "PROJECT_CREATED", payload: { name: input.name } });
    return this.getProject(id)!;
  }

  getProject(id: string): Project | null {
    const r = this.db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as Row | undefined;
    return r ? this.toProject(r) : null;
  }

  listProjects(): Project[] {
    return (this.db.prepare("SELECT * FROM projects ORDER BY created_at, id").all() as Row[]).map((r) => this.toProject(r));
  }

  /** Hides a project from the lists (archived) or brings it back; nothing is deleted. It is not "activity": updated_at stays. */
  setProjectStatus(id: string, status: Project["status"]): boolean {
    return this.db.prepare("UPDATE projects SET status = ? WHERE id = ?").run(status, id).changes > 0;
  }

  /** Deletes the project's rows (cascade) and its projects/<id>/ directory. */
  deleteProject(id: string): boolean {
    const dir = projectDir(this.projectsRoot, id);
    const removed = transaction(this.db, () => this.db.prepare("DELETE FROM projects WHERE id = ?").run(id).changes > 0);
    if (removed) rmSync(dir, { recursive: true, force: true });
    return removed;
  }

  private toProject(r: Row): Project {
    return {
      id: r.id as string,
      name: r.name as string,
      status: r.status as Project["status"],
      legacyId: (r.legacy_id as string | null) ?? null,
      createdAt: r.created_at as string,
      updatedAt: r.updated_at as string,
    };
  }

  // ---- missions -----------------------------------------------------------
  createMission(input: {
    projectId: string;
    goal: string;
    constraints?: string[];
    budgetPolicy?: "free_only" | "allow_paid";
    technologyPreferences?: string[];
    status?: MissionStatus;
  }): Mission {
    const id = `mis_${randomUUID().slice(0, 8)}`;
    const ts = now();
    this.db
      .prepare(
        "INSERT INTO missions (id, project_id, goal, constraints, budget_policy, technology_preferences, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(id, input.projectId, input.goal, json(input.constraints), input.budgetPolicy ?? "free_only", json(input.technologyPreferences), input.status ?? "draft", ts, ts);
    this.appendEvent({ projectId: input.projectId, type: "MISSION_CREATED", payload: { missionId: id } });
    return this.getMission(input.projectId, id)!;
  }

  getMission(projectId: string, id: string): Mission | null {
    const r = this.db.prepare("SELECT * FROM missions WHERE id = ? AND project_id = ?").get(id, projectId) as Row | undefined;
    return r ? this.toMission(r) : null;
  }

  listMissions(projectId: string): Mission[] {
    return (this.db.prepare("SELECT * FROM missions WHERE project_id = ? ORDER BY created_at, id").all(projectId) as Row[]).map((r) =>
      this.toMission(r),
    );
  }

  setMissionStatus(projectId: string, id: string, status: MissionStatus): void {
    const res = this.db
      .prepare("UPDATE missions SET status = ?, updated_at = ? WHERE id = ? AND project_id = ?")
      .run(status, now(), id, projectId);
    if (res.changes === 0) throw new Error("依頼が見つかりません");
  }

  private toMission(r: Row): Mission {
    return {
      id: r.id as string,
      projectId: r.project_id as string,
      goal: r.goal as string,
      constraints: parse<string[]>(r.constraints as string, []),
      budgetPolicy: r.budget_policy as Mission["budgetPolicy"],
      technologyPreferences: parse<string[]>(r.technology_preferences as string, []),
      status: r.status as MissionStatus,
      createdAt: r.created_at as string,
      updatedAt: r.updated_at as string,
    };
  }

  // ---- tasks --------------------------------------------------------------
  createTask(input: {
    projectId: string;
    missionId: string;
    role: string;
    objective?: string;
    inputs?: string[];
    expectedOutputs?: string[];
    constraints?: string[];
    selectedAi?: string | null;
    automationLevel?: number;
    status?: TaskStatus;
    position?: number;
    dependsOn?: string[];
  }): Task {
    const id = `task_${randomUUID().slice(0, 8)}`;
    const ts = now();
    transaction(this.db, () => {
      this.db
        .prepare(
          `INSERT INTO tasks (id, project_id, mission_id, role, objective, inputs, expected_outputs, constraints, selected_ai, automation_level, status, position, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          input.projectId,
          input.missionId,
          input.role,
          input.objective ?? "",
          json(input.inputs),
          json(input.expectedOutputs),
          json(input.constraints),
          input.selectedAi ?? null,
          input.automationLevel ?? 1,
          input.status ?? "pending",
          input.position ?? 0,
          ts,
          ts,
        );
      for (const dep of input.dependsOn ?? []) this.addDependency(input.projectId, id, dep);
    });
    this.appendEvent({ projectId: input.projectId, taskId: id, type: "TASK_CREATED", payload: { role: input.role } });
    return this.getTask(input.projectId, id)!;
  }

  addDependency(projectId: string, taskId: string, dependsOn: string): void {
    this.db.prepare("INSERT INTO task_edges (project_id, task_id, depends_on) VALUES (?, ?, ?)").run(projectId, taskId, dependsOn);
  }

  getTask(projectId: string, id: string): Task | null {
    const r = this.db.prepare("SELECT * FROM tasks WHERE id = ? AND project_id = ?").get(id, projectId) as Row | undefined;
    return r ? this.toTask(r) : null;
  }

  listTasks(projectId: string): Task[] {
    return (this.db.prepare("SELECT * FROM tasks WHERE project_id = ? ORDER BY position, created_at, id").all(projectId) as Row[]).map((r) =>
      this.toTask(r),
    );
  }

  /** A manual retry gives the task a fresh automatic-retry budget and may carry the user's extra instruction. */
  resetTaskForManualRetry(projectId: string, id: string, extraInstruction?: string): void {
    const task = this.getTask(projectId, id);
    if (!task) throw new Error("作業が見つかりません");
    const constraints = extraInstruction ? [...task.constraints, `ユーザーからの追加指示: ${extraInstruction}`] : task.constraints;
    this.db.prepare("UPDATE tasks SET retry_count = 0, constraints = ?, updated_at = ? WHERE id = ? AND project_id = ?").run(json(constraints), now(), id, projectId);
  }

  /** Plain status write. The legal-transition state machine is Phase 2. */
  setTaskStatus(projectId: string, id: string, status: TaskStatus): void {
    const res = this.db.prepare("UPDATE tasks SET status = ?, updated_at = ? WHERE id = ? AND project_id = ?").run(status, now(), id, projectId);
    if (res.changes === 0) throw new Error("作業が見つかりません");
    this.appendEvent({ projectId, taskId: id, type: "TASK_STATUS_CHANGED", payload: { status } });
  }

  private toTask(r: Row): Task {
    const deps = this.db
      .prepare("SELECT depends_on FROM task_edges WHERE task_id = ? AND project_id = ? ORDER BY depends_on")
      .all(r.id as string, r.project_id as string) as { depends_on: string }[];
    return {
      id: r.id as string,
      projectId: r.project_id as string,
      missionId: r.mission_id as string,
      role: r.role as string,
      objective: r.objective as string,
      inputs: parse<string[]>(r.inputs as string, []),
      expectedOutputs: parse<string[]>(r.expected_outputs as string, []),
      constraints: parse<string[]>(r.constraints as string, []),
      selectedAi: (r.selected_ai as string | null) ?? null,
      automationLevel: r.automation_level as number,
      status: r.status as TaskStatus,
      retryCount: r.retry_count as number,
      validation: parse<unknown>(r.validation as string | null, null),
      position: r.position as number,
      dependsOn: deps.map((d) => d.depends_on),
      createdAt: r.created_at as string,
      updatedAt: r.updated_at as string,
    };
  }

  // ---- AI registry --------------------------------------------------------
  upsertAiService(input: {
    id: string;
    name: string;
    url?: string | null;
    provider?: string | null;
    accessMode?: "web" | "cli" | "local" | "browser" | "manual" | "api";
    automationLevel?: number;
    freeStatus?: FreeStatus;
    requiresLogin?: boolean;
    requiresApiKey?: boolean;
    adapterType?: string;
    legacyName?: string | null;
    capabilities?: string[];
  }): AiService {
    transaction(this.db, () => {
      this.db
        .prepare(
          `INSERT INTO ai_services (id, name, url, provider, access_mode, automation_level, free_status, requires_login, requires_api_key, adapter_type, legacy_name)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET name = excluded.name, url = excluded.url, provider = excluded.provider, access_mode = excluded.access_mode,
             automation_level = excluded.automation_level, free_status = excluded.free_status, requires_login = excluded.requires_login,
             requires_api_key = excluded.requires_api_key, adapter_type = excluded.adapter_type, legacy_name = excluded.legacy_name`,
        )
        .run(
          input.id,
          input.name,
          input.url ?? null,
          input.provider ?? null,
          input.accessMode ?? "web",
          input.automationLevel ?? 1,
          input.freeStatus ?? "unknown",
          input.requiresLogin ? 1 : 0,
          input.requiresApiKey ? 1 : 0,
          input.adapterType ?? "manual",
          input.legacyName ?? null,
        );
      if (input.capabilities) this.setCapabilities(input.id, input.capabilities);
    });
    return this.getAiService(input.id)!;
  }

  /** Replaces the capability set. A plain list leaves scores unset; a record maps capability -> 0-5 score. */
  setCapabilities(aiId: string, capabilities: string[] | Record<string, number | null>): void {
    this.db.prepare("DELETE FROM ai_capabilities WHERE ai_id = ?").run(aiId);
    const ins = this.db.prepare("INSERT INTO ai_capabilities (ai_id, capability, score) VALUES (?, ?, ?)");
    const entries: [string, number | null][] = Array.isArray(capabilities) ? [...new Set(capabilities)].map((c) => [c, null]) : Object.entries(capabilities);
    for (const [c, score] of entries) ins.run(aiId, c, score);
  }

  /** Partial update of the registry fields that health checks and tuning change. */
  patchAiService(
    id: string,
    patch: Partial<{
      automationLevel: number;
      freeStatus: FreeStatus;
      freeLimit: string | null;
      qualityScore: number | null;
      reliabilityScore: number | null;
      limitations: string | null;
      status: "active" | "unavailable" | "retired";
      lastVerifiedAt: string | null;
    }>,
  ): AiService | null {
    const columns: Record<string, string> = {
      automationLevel: "automation_level",
      freeStatus: "free_status",
      freeLimit: "free_limit",
      qualityScore: "quality_score",
      reliabilityScore: "reliability_score",
      limitations: "limitations",
      status: "status",
      lastVerifiedAt: "last_verified_at",
    };
    const sets: string[] = [];
    const values: (string | number | null)[] = [];
    for (const [key, col] of Object.entries(columns)) {
      const v = (patch as Record<string, string | number | null | undefined>)[key];
      if (v === undefined) continue;
      sets.push(`${col} = ?`);
      values.push(v);
    }
    if (sets.length) this.db.prepare(`UPDATE ai_services SET ${sets.join(", ")} WHERE id = ?`).run(...values, id);
    return this.getAiService(id);
  }

  setTaskSelectedAi(projectId: string, taskId: string, aiId: string | null): void {
    this.db.prepare("UPDATE tasks SET selected_ai = ?, updated_at = ? WHERE id = ? AND project_id = ?").run(aiId, now(), taskId, projectId);
  }

  /** Rewrites what a task asks for and expects (used when the work has to be done another way than planned). */
  setTaskPlan(projectId: string, taskId: string, plan: { objective?: string; expectedOutputs?: string[] }): void {
    if (plan.objective !== undefined) this.db.prepare("UPDATE tasks SET objective = ?, updated_at = ? WHERE id = ? AND project_id = ?").run(plan.objective, now(), taskId, projectId);
    if (plan.expectedOutputs !== undefined) this.db.prepare("UPDATE tasks SET expected_outputs = ?, updated_at = ? WHERE id = ? AND project_id = ?").run(JSON.stringify(plan.expectedOutputs), now(), taskId, projectId);
  }

  /** Removes a service from the registry (its capability scores go with it; past runs keep their record, without the link). */
  deleteAiService(id: string): boolean {
    return this.db.prepare("DELETE FROM ai_services WHERE id = ?").run(id).changes > 0;
  }

  getAiService(id: string): AiService | null {
    const r = this.db.prepare("SELECT * FROM ai_services WHERE id = ?").get(id) as Row | undefined;
    return r ? this.toAiService(r) : null;
  }

  listAiServices(filter: { capability?: string } = {}): AiService[] {
    const rows = filter.capability
      ? (this.db
          .prepare("SELECT s.* FROM ai_services s JOIN ai_capabilities c ON c.ai_id = s.id WHERE c.capability = ? ORDER BY s.name")
          .all(filter.capability) as Row[])
      : (this.db.prepare("SELECT * FROM ai_services ORDER BY name").all() as Row[]);
    return rows.map((r) => this.toAiService(r));
  }

  private toAiService(r: Row): AiService {
    const caps = this.db.prepare("SELECT capability, score FROM ai_capabilities WHERE ai_id = ? ORDER BY capability").all(r.id as string) as { capability: string; score: number | null }[];
    return {
      id: r.id as string,
      name: r.name as string,
      url: (r.url as string | null) ?? null,
      provider: (r.provider as string | null) ?? null,
      accessMode: r.access_mode as string,
      automationLevel: r.automation_level as number,
      freeStatus: r.free_status as FreeStatus,
      requiresLogin: r.requires_login === 1,
      requiresApiKey: r.requires_api_key === 1,
      adapterType: r.adapter_type as string,
      status: r.status as string,
      lastVerifiedAt: (r.last_verified_at as string | null) ?? null,
      legacyName: (r.legacy_name as string | null) ?? null,
      capabilities: caps.map((c) => c.capability),
      capabilityScores: Object.fromEntries(caps.filter((c) => c.score !== null).map((c) => [c.capability, c.score as number])),
      freeLimit: (r.free_limit as string | null) ?? null,
      qualityScore: (r.quality_score as number | null) ?? null,
      reliabilityScore: (r.reliability_score as number | null) ?? null,
      limitations: (r.limitations as string | null) ?? null,
    };
  }

  // ---- runs / artifacts / validations ------------------------------------
  recordAiRun(input: {
    projectId: string;
    taskId?: string | null;
    aiId?: string | null;
    executor: string;
    automationLevel?: number;
    status?: "running" | "succeeded" | "failed" | "timed_out" | "cancelled";
    exitCode?: number | null;
    summary?: string | null;
    durationMs?: number | null;
    costUsd?: number | null;
    inputTokens?: number | null;
    outputTokens?: number | null;
  }): string {
    const id = `run_${randomUUID().slice(0, 8)}`;
    const ts = now();
    const finished = input.status && input.status !== "running" ? ts : null;
    this.db
      .prepare(
        "INSERT INTO ai_runs (id, project_id, task_id, ai_id, executor, automation_level, status, started_at, finished_at, exit_code, summary, duration_ms, cost_usd, input_tokens, output_tokens) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(id, input.projectId, input.taskId ?? null, input.aiId ?? null, input.executor, input.automationLevel ?? 1, input.status ?? "running", ts, finished, input.exitCode ?? null, input.summary ?? null, input.durationMs ?? null, input.costUsd ?? null, input.inputTokens ?? null, input.outputTokens ?? null);
    return id;
  }

  /** How often each AI ran, over all projects: in the last 3 hours and 24 hours, and when it ran last (a run without an AI is Claude Code's). */
  aiRunCounts(now = Date.now()): Record<string, { last3h: number; last24h: number; lastAt: string | null }> {
    const since24 = new Date(now - 24 * 3600_000).toISOString();
    const since3 = new Date(now - 3 * 3600_000).toISOString();
    const rows = this.db
      .prepare("SELECT COALESCE(ai_id, 'claude-code') AS ai, COUNT(*) AS n24, SUM(CASE WHEN started_at >= ? THEN 1 ELSE 0 END) AS n3, MAX(started_at) AS last FROM ai_runs WHERE started_at >= ? GROUP BY ai")
      .all(since3, since24) as { ai: string; n24: number; n3: number; last: string | null }[];
    const out: Record<string, { last3h: number; last24h: number; lastAt: string | null }> = {};
    for (const r of rows) out[r.ai] = { last3h: Number(r.n3), last24h: Number(r.n24), lastAt: r.last };
    return out;
  }

  listAiRuns(projectId: string): Row[] {
    return this.db.prepare("SELECT * FROM ai_runs WHERE project_id = ? ORDER BY started_at, id").all(projectId) as Row[];
  }

  /** Registers an artifact; the version auto-increments per (project, path). */
  createArtifact(input: { projectId: string; taskId?: string | null; path: string; createdBy: string; sourceAi?: string | null; sourceUrl?: string | null }): Artifact {
    const id = `art_${randomUUID().slice(0, 8)}`;
    const ts = now();
    transaction(this.db, () => {
      const prev = this.db
        .prepare("SELECT COALESCE(MAX(version), 0) AS v FROM artifacts WHERE project_id = ? AND path = ?")
        .get(input.projectId, input.path) as { v: number };
      this.db
        .prepare("INSERT INTO artifacts (id, project_id, task_id, path, version, created_by, created_at, source_ai, source_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(id, input.projectId, input.taskId ?? null, input.path, prev.v + 1, input.createdBy, ts, input.sourceAi ?? null, input.sourceUrl ?? null);
    });
    this.appendEvent({ projectId: input.projectId, taskId: input.taskId ?? null, type: "ARTIFACT_CREATED", payload: { path: input.path } });
    return this.listArtifacts(input.projectId).find((a) => a.id === id)!;
  }

  listArtifacts(projectId: string): Artifact[] {
    const rows = this.db.prepare("SELECT * FROM artifacts WHERE project_id = ? ORDER BY created_at, path, version").all(projectId) as Row[];
    return rows.map((r) => ({
      id: r.id as string,
      projectId: r.project_id as string,
      taskId: (r.task_id as string | null) ?? null,
      path: r.path as string,
      version: r.version as number,
      createdBy: r.created_by as string,
      createdAt: r.created_at as string,
      sourceAi: (r.source_ai as string | null) ?? null,
      sourceUrl: (r.source_url as string | null) ?? null,
      validationStatus: r.validation_status as string,
    }));
  }

  addValidation(input: { projectId: string; taskId: string; artifactId?: string | null; level: number; status: "passed" | "failed" | "skipped"; detail?: string | null }): string {
    const id = `val_${randomUUID().slice(0, 8)}`;
    this.db
      .prepare("INSERT INTO validations (id, project_id, task_id, artifact_id, level, status, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(id, input.projectId, input.taskId, input.artifactId ?? null, input.level, input.status, input.detail ?? null, now());
    return id;
  }

  listValidations(projectId: string): Row[] {
    return this.db.prepare("SELECT * FROM validations WHERE project_id = ? ORDER BY created_at, id").all(projectId) as Row[];
  }

  // ---- decisions / events / settings -------------------------------------
  addDecision(input: { projectId?: string | null; title: string; reason: string; alternatives?: string[]; rejectedBecause?: string | null; isAssumption?: boolean }): string {
    const id = `dec_${randomUUID().slice(0, 8)}`;
    this.db
      .prepare("INSERT INTO decisions (id, project_id, title, reason, alternatives, rejected_because, is_assumption, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(id, input.projectId ?? null, input.title, input.reason, json(input.alternatives), input.rejectedBecause ?? null, input.isAssumption ? 1 : 0, now());
    return id;
  }

  listDecisions(projectId: string | null): Row[] {
    return projectId === null
      ? (this.db.prepare("SELECT * FROM decisions WHERE project_id IS NULL ORDER BY created_at, id").all() as Row[])
      : (this.db.prepare("SELECT * FROM decisions WHERE project_id = ? ORDER BY created_at, id").all(projectId) as Row[]);
  }

  appendEvent(input: { projectId?: string | null; taskId?: string | null; type: string; payload?: unknown }): void {
    this.db
      .prepare("INSERT INTO events (project_id, task_id, type, payload, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(input.projectId ?? null, input.taskId ?? null, input.type, JSON.stringify(input.payload ?? {}), now());
  }

  listEvents(filter: { projectId?: string | null; type?: string; limit?: number } = {}): StoredEvent[] {
    const limit = Math.min(filter.limit ?? 200, 1000);
    const where: string[] = [];
    const args: (string | number)[] = [];
    if (filter.projectId) {
      where.push("project_id = ?");
      args.push(filter.projectId);
    }
    if (filter.type) {
      where.push("type = ?");
      args.push(filter.type);
    }
    const rows = this.db.prepare(`SELECT * FROM events ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY id DESC LIMIT ?`).all(...args, limit) as Row[];
    return rows.reverse().map((r) => ({
      id: r.id as number,
      projectId: (r.project_id as string | null) ?? null,
      taskId: (r.task_id as string | null) ?? null,
      type: r.type as string,
      payload: parse<unknown>(r.payload as string, {}),
      createdAt: r.created_at as string,
    }));
  }

  getSetting<T>(key: string, fallback: T): T {
    const r = this.db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
    return r ? parse<T>(r.value, fallback) : fallback;
  }

  setSetting(key: string, value: unknown): void {
    this.db
      .prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
      .run(key, JSON.stringify(value), now());
  }

  deleteSetting(key: string): void {
    this.db.prepare("DELETE FROM settings WHERE key = ?").run(key);
  }

  // ---- locks --------------------------------------------------------------
  /** Atomically takes the lock unless a different owner holds an unexpired one. */
  acquireLock(input: { resource: string; projectId?: string | null; owner: string; ttlMs: number }): boolean {
    const acquired = new Date();
    const expires = new Date(acquired.getTime() + input.ttlMs);
    return transaction(this.db, () => {
      const cur = this.db.prepare("SELECT owner, expires_at FROM locks WHERE resource = ?").get(input.resource) as { owner: string; expires_at: string } | undefined;
      if (cur && cur.owner !== input.owner && cur.expires_at > acquired.toISOString()) return false;
      this.db
        .prepare(
          "INSERT INTO locks (resource, project_id, owner, acquired_at, expires_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(resource) DO UPDATE SET project_id = excluded.project_id, owner = excluded.owner, acquired_at = excluded.acquired_at, expires_at = excluded.expires_at",
        )
        .run(input.resource, input.projectId ?? null, input.owner, acquired.toISOString(), expires.toISOString());
      return true;
    });
  }

  releaseLock(resource: string, owner: string): boolean {
    return this.db.prepare("DELETE FROM locks WHERE resource = ? AND owner = ?").run(resource, owner).changes > 0;
  }
}
