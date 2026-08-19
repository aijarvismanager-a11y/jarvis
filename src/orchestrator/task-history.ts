/**
 * Task History (spec §38 optional checklist: "使用履歴" / "成功率") - a
 * unified log of every TaskWorkerRunner.run() outcome, both `worker_run`
 * and `manual_handoff`. Distinct from handoff-file.ts's workspace/handoff/
 * files (which exist so an *external* Worker/AI can read them back) and
 * from src/agents/handoff.ts's DB Handoff (JARVIS's own agent-to-agent
 * bookkeeping) - neither of those records a `manual_handoff` outcome at
 * all, so on their own they can't answer "what has the Router recommended
 * over time" or "how often does each AI actually finish a task".
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { TaskTemplate } from '../agents/conv/task-envelope.ts';
import type { WorkerCapability } from '../workers/types.ts';

export type TaskHistoryEntry =
  | {
      task_id: string;
      template: TaskTemplate;
      timestamp: number;
      mode: 'worker_run';
      worker: string;
      status: 'completed' | 'failed' | 'needs_input';
    }
  | {
      task_id: string;
      template: TaskTemplate;
      timestamp: number;
      mode: 'manual_handoff';
      primary: string | null;
      fallback: string | null;
      reason: string;
    };

/** Keeps the file small and the read cheap - this is a personal-scale log, not an analytics pipeline. */
const MAX_ENTRIES = 500;

function historyPath(dataDir: string): string {
  return join(dataDir, 'task-history.json');
}

function readAll(dataDir: string): TaskHistoryEntry[] {
  const path = historyPath(dataDir);
  if (!existsSync(path)) return [];
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    return Array.isArray(parsed) ? (parsed as TaskHistoryEntry[]) : [];
  } catch {
    return [];
  }
}

function writeAll(dataDir: string, entries: TaskHistoryEntry[]): void {
  const path = historyPath(dataDir);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(entries, null, 2), 'utf8');
}

/** Appends one outcome, oldest-first on disk, capped to MAX_ENTRIES (drops the oldest). Best-effort: a write failure here must never fail the task it's logging. */
export function appendTaskHistory(dataDir: string, entry: TaskHistoryEntry): void {
  try {
    const entries = readAll(dataDir);
    entries.push(entry);
    if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
    writeAll(dataDir, entries);
  } catch (err) {
    console.warn('[TaskHistory] Failed to append:', err);
  }
}

/** Newest first, capped to `limit` (default 50). */
export function loadTaskHistory(dataDir: string, limit = 50): TaskHistoryEntry[] {
  const entries = readAll(dataDir);
  return entries.slice(-limit).reverse();
}

export type SuccessRateEntry = {
  worker: string;
  completed: number;
  failed: number;
  needs_input: number;
  total: number;
  /** completed / total. Conservative: needs_input counts against the rate, same as failed - it's not a finished success either. */
  successRate: number;
};

/**
 * Aggregates `worker_run` entries by Worker name. `manual_handoff` entries
 * are excluded - the Router recommending an AI isn't that AI succeeding or
 * failing at anything, so it doesn't belong in a success-rate denominator.
 * Pass `capability` to scope to just the templates that map to it (used by
 * WorkerRouter's scoring - a worker's code success rate shouldn't dilute
 * its research recommendation).
 */
export function computeSuccessRates(dataDir: string, capability?: WorkerCapability): SuccessRateEntry[] {
  const entries = readAll(dataDir).filter(
    (e): e is Extract<TaskHistoryEntry, { mode: 'worker_run' }> =>
      e.mode === 'worker_run' && (!capability || TEMPLATE_TO_CAPABILITY[e.template] === capability),
  );

  const byWorker = new Map<string, { completed: number; failed: number; needs_input: number }>();
  for (const e of entries) {
    const bucket = byWorker.get(e.worker) ?? { completed: 0, failed: 0, needs_input: 0 };
    bucket[e.status]++;
    byWorker.set(e.worker, bucket);
  }

  return [...byWorker.entries()]
    .map(([worker, b]) => {
      const total = b.completed + b.failed + b.needs_input;
      return { worker, ...b, total, successRate: total > 0 ? b.completed / total : 0 };
    })
    .sort((a, b) => b.total - a.total);
}

/** Mirrors ai-router.ts's TEMPLATE_TO_CAPABILITY - duplicated locally rather than imported to avoid a dependency cycle (ai-router.ts will import computeSuccessRates for the learning adjustment). */
const TEMPLATE_TO_CAPABILITY: Record<TaskTemplate, WorkerCapability> = {
  code: 'code',
  research: 'research',
  write: 'write',
  plan: 'plan',
  general: 'general',
};
