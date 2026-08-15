/**
 * Accessors for the project-management columns added to the existing
 * `tasks` table (see schema.ts, "AI Manager (Phase 1)"). These operate
 * alongside - not instead of - `TaskRegistry`/`TaskDispatcher`, which own
 * task creation and the `status`/`tier`/`template` lifecycle. This module
 * only reads/writes the additive Manager-facing fields
 * (project_id, parent_task_id, dependencies, assigned_*, artifacts,
 * next_agent, approval_required, priority, project_status) on rows that
 * already exist in `tasks`.
 */

import { getDb } from './schema.ts';

export type ProjectTaskStatus =
  | 'PENDING'
  | 'PLANNING'
  | 'READY'
  | 'RUNNING'
  | 'WAITING'
  | 'BLOCKED'
  | 'REVIEW'
  | 'QA'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

export type TaskPriority = 'low' | 'normal' | 'high' | 'critical';

export type ProjectTaskFields = {
  id: string;
  project_id: string | null;
  parent_task_id: string | null;
  title: string | null;
  priority: TaskPriority;
  project_status: ProjectTaskStatus | null;
  assigned_agent: string | null;
  assigned_provider: string | null;
  assigned_model: string | null;
  dependencies: string[];
  artifacts: string[];
  next_agent: string | null;
  approval_required: boolean;
  /** Self-Healing state (Phase 6) - see src/ai-manager/self-healing.ts. */
  retry_count: number;
  max_retries: number;
  /** Last QAAgent verdict for this task (JSON), or null if QA never ran. */
  qa_report: Record<string, unknown> | null;
};

type ProjectTaskRow = {
  id: string;
  project_id: string | null;
  parent_task_id: string | null;
  title: string | null;
  priority: TaskPriority;
  project_status: ProjectTaskStatus | null;
  assigned_agent: string | null;
  assigned_provider: string | null;
  assigned_model: string | null;
  dependencies: string | null;
  artifacts: string | null;
  next_agent: string | null;
  approval_required: number;
  retry_count: number;
  max_retries: number;
  qa_report: string | null;
};

function parseRow(row: ProjectTaskRow): ProjectTaskFields {
  return {
    ...row,
    dependencies: row.dependencies ? JSON.parse(row.dependencies) : [],
    artifacts: row.artifacts ? JSON.parse(row.artifacts) : [],
    approval_required: row.approval_required === 1,
    qa_report: row.qa_report ? JSON.parse(row.qa_report) : null,
  };
}

const PROJECT_TASK_COLUMNS = `
  id, project_id, parent_task_id, title, priority, project_status,
  assigned_agent, assigned_provider, assigned_model, dependencies, artifacts,
  next_agent, approval_required, retry_count, max_retries, qa_report
`;

export function getProjectTaskFields(taskId: string): ProjectTaskFields | null {
  const db = getDb();
  const row = db
    .prepare(`SELECT ${PROJECT_TASK_COLUMNS} FROM tasks WHERE id = ?`)
    .get(taskId) as ProjectTaskRow | null;
  return row ? parseRow(row) : null;
}

/**
 * Attach or update the Manager-facing fields on an existing task row.
 * Only the fields present in `fields` are changed; omitted fields are left
 * as-is. The row itself must already exist (created via TaskRegistry).
 */
export function setProjectTaskFields(
  taskId: string,
  fields: Partial<Omit<ProjectTaskFields, 'id'>>
): ProjectTaskFields | null {
  const db = getDb();
  const current = getProjectTaskFields(taskId);
  if (!current) return null;

  const next: ProjectTaskFields = { ...current, ...fields, id: taskId };

  db.prepare(
    `UPDATE tasks SET
      project_id = ?, parent_task_id = ?, title = ?, priority = ?, project_status = ?,
      assigned_agent = ?, assigned_provider = ?, assigned_model = ?,
      dependencies = ?, artifacts = ?, next_agent = ?, approval_required = ?,
      retry_count = ?, max_retries = ?, qa_report = ?
     WHERE id = ?`
  ).run(
    next.project_id,
    next.parent_task_id,
    next.title,
    next.priority,
    next.project_status,
    next.assigned_agent,
    next.assigned_provider,
    next.assigned_model,
    JSON.stringify(next.dependencies),
    JSON.stringify(next.artifacts),
    next.next_agent,
    next.approval_required ? 1 : 0,
    next.retry_count,
    next.max_retries,
    next.qa_report ? JSON.stringify(next.qa_report) : null,
    taskId
  );

  return getProjectTaskFields(taskId);
}

export function setProjectTaskStatus(taskId: string, status: ProjectTaskStatus): ProjectTaskFields | null {
  const db = getDb();
  const current = getProjectTaskFields(taskId);
  if (!current) return null;

  db.prepare('UPDATE tasks SET project_status = ? WHERE id = ?').run(status, taskId);
  return getProjectTaskFields(taskId);
}

/** All tasks (in any status) belonging to a project, for the Kanban view. */
export function getProjectTasks(projectId: string): ProjectTaskFields[] {
  const db = getDb();
  // `priority` is TEXT ('low'|'normal'|'high'|'critical'); SQLite's default
  // collation would sort those alphabetically, not by severity, so rank them
  // explicitly rather than relying on `ORDER BY priority DESC`.
  const rows = db
    .prepare(
      `SELECT ${PROJECT_TASK_COLUMNS} FROM tasks WHERE project_id = ?
       ORDER BY CASE priority
         WHEN 'critical' THEN 0
         WHEN 'high' THEN 1
         WHEN 'normal' THEN 2
         WHEN 'low' THEN 3
         ELSE 4
       END`
    )
    .all(projectId) as ProjectTaskRow[];
  return rows.map(parseRow);
}

/** Direct subtasks of a given task. */
export function getSubtasks(parentTaskId: string): ProjectTaskFields[] {
  const db = getDb();
  const rows = db
    .prepare(`SELECT ${PROJECT_TASK_COLUMNS} FROM tasks WHERE parent_task_id = ?`)
    .all(parentTaskId) as ProjectTaskRow[];
  return rows.map(parseRow);
}
