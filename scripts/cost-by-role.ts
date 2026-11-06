// Per-role cost of Claude Code runs, before vs after the token saver (server restart on 2026-11-07 00:10 JST).
// Usage: npx tsx scripts/cost-by-role.ts [ISO cutoff]
import { DatabaseSync } from "node:sqlite";

const cutoff = process.argv[2] ?? "2026-11-06T15:10:00Z";
const db = new DatabaseSync("data/orchestrator.db", { readOnly: true });
const rows = db
  .prepare(
    `SELECT t.role AS role, CASE WHEN r.started_at >= ? THEN 'after' ELSE 'before' END AS period,
            COUNT(*) AS n, ROUND(AVG(r.cost_usd), 3) AS avg_cost, ROUND(AVG(r.input_tokens)) AS avg_in
     FROM ai_runs r JOIN tasks t ON t.id = r.task_id
     WHERE r.cost_usd IS NOT NULL AND r.status = 'succeeded' GROUP BY role, period ORDER BY role, period`,
  )
  .all(cutoff);
console.table(rows);
