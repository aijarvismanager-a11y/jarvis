import { getDb, generateId } from './schema.ts';

export type ProjectTemplate =
  | 'website'
  | 'web_app'
  | 'software'
  | 'research'
  | 'content'
  | 'data_project'
  | 'automation'
  | 'custom';

export type ProjectStatus = 'active' | 'paused' | 'completed' | 'archived';
export type ExecutionMode = 'auto' | 'assisted' | 'manual';
/**
 * User-facing Cheap/Balanced/Quality mode (spec §40-41), mapped onto the
 * existing low/medium/high tier system by src/llm/cost-mode.ts. 'balanced'
 * is a no-op - it leaves each subtask template's existing per-template tier
 * default alone, same as 'auto' is a no-op for execution_mode.
 */
export type CostMode = 'cheap' | 'balanced' | 'quality';

/**
 * A rule is a short standing instruction the Manager Agent must keep
 * honoring for the lifetime of the project (spec section 18, "Project
 * Memory"). Stored as a JSON array on `projects.rules`.
 */
export type Project = {
  id: string;
  name: string;
  description: string;
  template: ProjectTemplate;
  status: ProjectStatus;
  execution_mode: ExecutionMode;
  cost_mode: CostMode;
  rules: string[];
  created_at: number;
  updated_at: number;
  completed_at: number | null;
};

type ProjectRow = {
  id: string;
  name: string;
  description: string;
  template: ProjectTemplate;
  status: ProjectStatus;
  execution_mode: ExecutionMode;
  cost_mode: CostMode;
  rules: string | null;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
};

function parseProject(row: ProjectRow): Project {
  return {
    ...row,
    rules: row.rules ? JSON.parse(row.rules) : [],
  };
}

export function createProject(
  name: string,
  opts?: {
    description?: string;
    template?: ProjectTemplate;
    execution_mode?: ExecutionMode;
    cost_mode?: CostMode;
    rules?: string[];
  }
): Project {
  const db = getDb();
  const id = generateId();
  const now = Date.now();
  const description = opts?.description ?? '';
  const template = opts?.template ?? 'custom';
  const execution_mode = opts?.execution_mode ?? 'assisted';
  const cost_mode = opts?.cost_mode ?? 'balanced';
  const rules = opts?.rules ?? [];

  db.prepare(
    `INSERT INTO projects (id, name, description, template, status, execution_mode, cost_mode, rules, created_at, updated_at, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, name, description, template, 'active', execution_mode, cost_mode, JSON.stringify(rules), now, now, null);

  return {
    id,
    name,
    description,
    template,
    status: 'active',
    execution_mode,
    cost_mode,
    rules,
    created_at: now,
    updated_at: now,
    completed_at: null,
  };
}

export function getProject(id: string): Project | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as ProjectRow | null;
  return row ? parseProject(row) : null;
}

export function findProjects(query?: { status?: ProjectStatus }): Project[] {
  const db = getDb();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (query?.status) {
    conditions.push('status = ?');
    params.push(query.status);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = db
    .prepare(`SELECT * FROM projects ${where} ORDER BY updated_at DESC`)
    .all(...(params as any[])) as ProjectRow[];

  return rows.map(parseProject);
}

export function updateProjectStatus(id: string, status: ProjectStatus): Project | null {
  const db = getDb();
  const project = getProject(id);
  if (!project) return null;

  const now = Date.now();
  const completedAt = status === 'completed' ? now : project.completed_at;
  db.prepare('UPDATE projects SET status = ?, completed_at = ?, updated_at = ? WHERE id = ?').run(
    status,
    completedAt,
    now,
    id
  );

  return getProject(id);
}

export function updateProjectExecutionMode(id: string, mode: ExecutionMode): Project | null {
  const db = getDb();
  const project = getProject(id);
  if (!project) return null;

  db.prepare('UPDATE projects SET execution_mode = ?, updated_at = ? WHERE id = ?').run(mode, Date.now(), id);
  return getProject(id);
}

export function updateProjectCostMode(id: string, mode: CostMode): Project | null {
  const db = getDb();
  const project = getProject(id);
  if (!project) return null;

  db.prepare('UPDATE projects SET cost_mode = ?, updated_at = ? WHERE id = ?').run(mode, Date.now(), id);
  return getProject(id);
}

/**
 * The Planner's subtask list, persisted so ManagerAgent.continueProject()
 * can reconstruct the dependency-graph wave scheduler's state without the
 * original in-memory PlanResult (Phase 11-A). `template`/`priority` are kept
 * as plain strings here rather than importing ai-manager's `TaskTemplate`/
 * `PlannedPriority` types, to avoid this lower-level vault module depending
 * on the higher-level ai-manager one - callers cast back to their own types.
 * `task_id` is null until ManagerAgent actually dispatches that index for
 * the first time.
 */
export type PlanSubtask = {
  title: string;
  template: string;
  priority: string;
  depends_on: number[];
  task_id: string | null;
};

/** Persist (or update) a project's full subtask plan. */
export function setProjectPlan(id: string, plan: PlanSubtask[]): void {
  const db = getDb();
  db.prepare('UPDATE projects SET plan = ?, updated_at = ? WHERE id = ?').run(
    JSON.stringify(plan),
    Date.now(),
    id
  );
}

/** Null if the project predates Phase 11-A or was never planned via ManagerAgent. */
export function getProjectPlan(id: string): PlanSubtask[] | null {
  const db = getDb();
  const row = db.prepare('SELECT plan FROM projects WHERE id = ?').get(id) as { plan: string | null } | null;
  if (!row || !row.plan) return null;
  return JSON.parse(row.plan) as PlanSubtask[];
}

/**
 * Replace a project's rule list wholesale (Project Memory, spec section 18).
 * Rules are short standing instructions, not a growing log - callers should
 * fetch, mutate, and pass the full array back rather than appending blindly.
 */
export function setProjectRules(id: string, rules: string[]): Project | null {
  const db = getDb();
  const project = getProject(id);
  if (!project) return null;

  db.prepare('UPDATE projects SET rules = ?, updated_at = ? WHERE id = ?').run(
    JSON.stringify(rules),
    Date.now(),
    id
  );
  return getProject(id);
}
