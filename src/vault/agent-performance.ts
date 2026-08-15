/**
 * Agent Performance (spec section 20) - aggregates the project-tagged rows
 * in `tasks` (see project-tasks.ts) by `assigned_agent`. Deliberately reads
 * raw SQL here rather than layering on top of project-tasks.ts's per-row
 * accessors, since this is a GROUP BY query, not row CRUD.
 *
 * `assigned_agent` values are `task_<template>` labels (e.g. `task_code`),
 * the same convention TaskDispatcher uses for its internal `subsystem`
 * (see task-dispatcher.ts: `const subsystem = \`task_${request.template}\`;`)
 * and therefore the same label llm_usage.subsystem carries for those calls.
 * That shared naming is what lets this join task outcomes to LLM error
 * rates without a new column anywhere.
 */

import { getDb } from './schema.ts';
import { queryUsage } from '../llm/usage.ts';

export type AgentPerformance = {
  agent: string;
  tasks_completed: number;
  tasks_failed: number;
  tasks_cancelled: number;
  /** completed / (completed + failed). Null when there's no terminal data yet. */
  success_rate: number | null;
  /** Average ms from task start to completion, over COMPLETED tasks only. */
  average_duration_ms: number | null;
  /** LLM call error rate for this agent's subsystem over the queried window. */
  llm_error_rate: number | null;
  llm_calls: number;
  providers_used: string[];
  models_used: string[];
};

type AgentRow = {
  assigned_agent: string;
  completed: number;
  failed: number;
  cancelled: number;
  avg_duration_ms: number | null;
};

/**
 * Aggregate performance for every agent label seen in project-tagged tasks,
 * optionally scoped to a single project. `daysBack` bounds the LLM usage
 * join (task counts are all-time; there's no volume concern there yet).
 */
export function getAgentPerformance(opts?: { projectId?: string; daysBack?: number }): AgentPerformance[] {
  const db = getDb();
  const conditions = ["assigned_agent IS NOT NULL"];
  const params: unknown[] = [];
  if (opts?.projectId) {
    conditions.push('project_id = ?');
    params.push(opts.projectId);
  }
  const where = conditions.join(' AND ');

  const rows = db
    .prepare(
      `SELECT
        assigned_agent,
        SUM(CASE WHEN project_status = 'COMPLETED' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN project_status = 'FAILED' THEN 1 ELSE 0 END) as failed,
        SUM(CASE WHEN project_status = 'CANCELLED' THEN 1 ELSE 0 END) as cancelled,
        AVG(CASE WHEN project_status = 'COMPLETED' THEN updated_at - started_at ELSE NULL END) as avg_duration_ms
       FROM tasks
       WHERE ${where}
       GROUP BY assigned_agent
       ORDER BY assigned_agent`,
    )
    .all(...(params as any[])) as AgentRow[];

  const daysBack = opts?.daysBack ?? 30;
  const fromMs = Date.now() - daysBack * 24 * 60 * 60 * 1000;

  return rows.map((row) => {
    const usage = queryUsage({ fromMs, subsystems: [row.assigned_agent] }, 'none');
    const providers = new Set<string>();
    const models = new Set<string>();
    for (const r of usage.raw ?? []) {
      providers.add(r.provider);
      models.add(r.model);
    }
    const terminal = row.completed + row.failed;

    return {
      agent: row.assigned_agent,
      tasks_completed: row.completed,
      tasks_failed: row.failed,
      tasks_cancelled: row.cancelled,
      success_rate: terminal > 0 ? row.completed / terminal : null,
      average_duration_ms: row.avg_duration_ms,
      llm_error_rate: usage.total.calls > 0 ? usage.total.errors / usage.total.calls : null,
      llm_calls: usage.total.calls,
      providers_used: [...providers],
      models_used: [...models],
    };
  });
}
