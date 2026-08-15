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
    rules?: string[];
  }
): Project {
  const db = getDb();
  const id = generateId();
  const now = Date.now();
  const description = opts?.description ?? '';
  const template = opts?.template ?? 'custom';
  const execution_mode = opts?.execution_mode ?? 'assisted';
  const rules = opts?.rules ?? [];

  db.prepare(
    `INSERT INTO projects (id, name, description, template, status, execution_mode, rules, created_at, updated_at, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, name, description, template, 'active', execution_mode, JSON.stringify(rules), now, now, null);

  return {
    id,
    name,
    description,
    template,
    status: 'active',
    execution_mode,
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
