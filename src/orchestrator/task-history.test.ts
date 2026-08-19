import { describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendTaskHistory, loadTaskHistory, computeSuccessRates, type TaskHistoryEntry } from './task-history.ts';

function withTmpDir(fn: (dir: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), 'jarvis-history-'));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const workerRun = (over: Partial<Extract<TaskHistoryEntry, { mode: 'worker_run' }>> = {}): TaskHistoryEntry => ({
  task_id: 't1',
  template: 'code',
  timestamp: Date.now(),
  mode: 'worker_run',
  worker: 'claude_code',
  status: 'completed',
  ...over,
});

describe('task-history', () => {
  it('loadTaskHistory is empty with no file', () => {
    withTmpDir((dir) => {
      expect(loadTaskHistory(dir)).toEqual([]);
    });
  });

  it('appendTaskHistory then loadTaskHistory returns newest first', () => {
    withTmpDir((dir) => {
      appendTaskHistory(dir, workerRun({ task_id: 'a', timestamp: 1 }));
      appendTaskHistory(dir, workerRun({ task_id: 'b', timestamp: 2 }));
      const history = loadTaskHistory(dir);
      expect(history.map((h) => h.task_id)).toEqual(['b', 'a']);
    });
  });

  it('loadTaskHistory respects the limit', () => {
    withTmpDir((dir) => {
      for (let i = 0; i < 5; i++) appendTaskHistory(dir, workerRun({ task_id: `t${i}`, timestamp: i }));
      expect(loadTaskHistory(dir, 2).map((h) => h.task_id)).toEqual(['t4', 't3']);
    });
  });

  it('caps stored entries at 500, dropping the oldest', () => {
    withTmpDir((dir) => {
      // Pre-seed 499 entries directly (skip 499 real read-modify-write
      // cycles through appendTaskHistory - this test only cares about the
      // cap boundary, not append's own performance).
      const seeded = Array.from({ length: 499 }, (_, i) => workerRun({ task_id: `t${i}`, timestamp: i }));
      writeFileSync(join(dir, 'task-history.json'), JSON.stringify(seeded), 'utf8');

      appendTaskHistory(dir, workerRun({ task_id: 't499', timestamp: 499 }));
      appendTaskHistory(dir, workerRun({ task_id: 't500', timestamp: 500 }));

      const all = loadTaskHistory(dir, 500);
      expect(all.length).toBe(500);
      expect(all[0]!.task_id).toBe('t500');
      expect(all[all.length - 1]!.task_id).toBe('t1'); // t0 dropped to make room
    });
  });

  it('records manual_handoff entries distinctly from worker_run', () => {
    withTmpDir((dir) => {
      appendTaskHistory(dir, { task_id: 'm1', template: 'research', timestamp: 1, mode: 'manual_handoff', primary: 'gemini', fallback: null, reason: 'x' });
      const history = loadTaskHistory(dir);
      expect(history[0]).toMatchObject({ mode: 'manual_handoff', primary: 'gemini' });
    });
  });
});

describe('computeSuccessRates', () => {
  it('is empty with no history', () => {
    withTmpDir((dir) => {
      expect(computeSuccessRates(dir)).toEqual([]);
    });
  });

  it('aggregates completed/failed/needs_input per worker from worker_run entries only', () => {
    withTmpDir((dir) => {
      appendTaskHistory(dir, workerRun({ status: 'completed' }));
      appendTaskHistory(dir, workerRun({ status: 'completed' }));
      appendTaskHistory(dir, workerRun({ status: 'failed' }));
      appendTaskHistory(dir, workerRun({ status: 'needs_input' }));
      appendTaskHistory(dir, { task_id: 'm', template: 'code', timestamp: 1, mode: 'manual_handoff', primary: 'claude_code', fallback: null, reason: 'x' });

      const rates = computeSuccessRates(dir);
      expect(rates).toEqual([{ worker: 'claude_code', completed: 2, failed: 1, needs_input: 1, total: 4, successRate: 0.5 }]);
    });
  });

  it('scopes to a capability via the template->capability mapping when passed', () => {
    withTmpDir((dir) => {
      appendTaskHistory(dir, workerRun({ template: 'code', status: 'completed' }));
      appendTaskHistory(dir, workerRun({ template: 'research', status: 'failed' }));

      expect(computeSuccessRates(dir, 'code')).toEqual([
        { worker: 'claude_code', completed: 1, failed: 0, needs_input: 0, total: 1, successRate: 1 },
      ]);
      expect(computeSuccessRates(dir, 'research')).toEqual([
        { worker: 'claude_code', completed: 0, failed: 1, needs_input: 0, total: 1, successRate: 0 },
      ]);
      expect(computeSuccessRates(dir, 'write')).toEqual([]);
    });
  });

  it('sorts by total descending', () => {
    withTmpDir((dir) => {
      appendTaskHistory(dir, workerRun({ worker: 'gemini', status: 'completed' }));
      appendTaskHistory(dir, workerRun({ worker: 'claude_code', status: 'completed' }));
      appendTaskHistory(dir, workerRun({ worker: 'claude_code', status: 'completed' }));

      expect(computeSuccessRates(dir).map((r) => r.worker)).toEqual(['claude_code', 'gemini']);
    });
  });
});
