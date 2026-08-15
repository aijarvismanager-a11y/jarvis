import { getDb, generateId } from './schema.ts';

/**
 * A recorded decision the Manager (or a human) made and doesn't want
 * re-litigated (spec section 17, "Decision Memory"). Scoped to a project
 * when one exists, but project_id is nullable for standalone/global
 * decisions.
 */
export type Decision = {
  id: string;
  project_id: string | null;
  statement: string;
  reason: string | null;
  made_by: string;
  created_at: number;
};

type DecisionRow = Decision;

export function createDecision(
  statement: string,
  opts?: {
    project_id?: string;
    reason?: string;
    made_by?: string;
  }
): Decision {
  const db = getDb();
  const id = generateId();
  const now = Date.now();
  const made_by = opts?.made_by ?? 'manager';

  db.prepare(
    `INSERT INTO decisions (id, project_id, statement, reason, made_by, created_at) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, opts?.project_id ?? null, statement, opts?.reason ?? null, made_by, now);

  return {
    id,
    project_id: opts?.project_id ?? null,
    statement,
    reason: opts?.reason ?? null,
    made_by,
    created_at: now,
  };
}

export function getDecision(id: string): Decision | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM decisions WHERE id = ?').get(id) as DecisionRow | null;
  return row ?? null;
}

export function findDecisions(query?: { project_id?: string }): Decision[] {
  const db = getDb();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (query?.project_id) {
    conditions.push('project_id = ?');
    params.push(query.project_id);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = db
    .prepare(`SELECT * FROM decisions ${where} ORDER BY created_at DESC`)
    .all(...(params as any[])) as DecisionRow[];

  return rows;
}
