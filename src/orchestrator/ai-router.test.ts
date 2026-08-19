import { describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkerRegistry } from '../workers/registry.ts';
import { WorkerRouter } from './ai-router.ts';
import { appendTaskHistory } from './task-history.ts';
import type { Worker, WorkerRunRequest, WorkerRunResult } from '../workers/types.ts';

function withTmpDir(fn: (dir: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), 'jarvis-ai-router-'));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function fakeWorker(
  name: string,
  capabilities: Worker['definition']['capabilities'],
  opts: Partial<Worker['definition']> = {}
): Worker {
  return {
    definition: {
      name,
      type: 'custom',
      status: 'ready',
      capabilities,
      input_method: 'cli',
      output_method: 'stdout',
      workspace: '/tmp/ws',
      timeout_ms: 1000,
      retry: 0,
      enabled: true,
      ...opts,
    },
    async run(_req: WorkerRunRequest): Promise<WorkerRunResult> {
      return { status: 'completed', summary: 'ok', output: '', files: [] };
    },
  };
}

describe('WorkerRouter.route', () => {
  it('routes a code task to a worker declaring the code capability', () => {
    const registry = new WorkerRegistry();
    registry.register(fakeWorker('claude_code', ['code', 'plan']));
    registry.register(fakeWorker('gemini', ['research', 'write']));

    const result = new WorkerRouter(registry).route({ template: 'code' });
    expect(result).toEqual({ ok: true, worker: 'claude_code', capability: 'code' });
  });

  it('honors an explicit worker override even if another worker also matches', () => {
    const registry = new WorkerRegistry();
    registry.register(fakeWorker('claude_code', ['code']));
    registry.register(fakeWorker('custom_coder', ['code']));

    const result = new WorkerRouter(registry).route({ template: 'code', explicitWorker: 'custom_coder' });
    expect(result).toEqual({ ok: true, worker: 'custom_coder', capability: 'code' });
  });

  it('falls back to routing normally when the explicit worker is disabled', () => {
    const registry = new WorkerRegistry();
    registry.register(fakeWorker('claude_code', ['code']));
    registry.register(fakeWorker('disabled_coder', ['code'], { enabled: false }));

    const result = new WorkerRouter(registry).route({ template: 'code', explicitWorker: 'disabled_coder' });
    expect(result).toEqual({ ok: true, worker: 'claude_code', capability: 'code' });
  });

  it('falls back to routing normally when the explicit worker lacks the required capability', () => {
    const registry = new WorkerRegistry();
    registry.register(fakeWorker('claude_code', ['code']));
    registry.register(fakeWorker('gemini', ['research', 'write']));

    const result = new WorkerRouter(registry).route({ template: 'code', explicitWorker: 'gemini' });
    expect(result).toEqual({ ok: true, worker: 'claude_code', capability: 'code' });
  });

  it('reports no_worker_available when nothing declares the capability', () => {
    const registry = new WorkerRegistry();
    registry.register(fakeWorker('gemini', ['research']));

    const result = new WorkerRouter(registry).route({ template: 'code' });
    expect(result).toEqual({ ok: false, reason: 'no_worker_available', capability: 'code' });
  });
});

describe('WorkerRouter.recommend', () => {
  it('recommends the highest-strength profile for a capability even with zero Workers registered', () => {
    const registry = new WorkerRegistry();
    const decision = new WorkerRouter(registry).recommend({ template: 'code' });

    expect(decision.task_type).toBe('code');
    expect(decision.primary).toBe('claude_code');
    expect(decision.primaryAvailable).toBe(false);
    expect(decision.fallback).not.toBeNull();
    expect(decision.reason).toContain('code');
  });

  it('marks the recommendation as available when a matching Worker is registered and enabled', () => {
    const registry = new WorkerRegistry();
    registry.register(fakeWorker('claude_code', ['code']));

    const decision = new WorkerRouter(registry).recommend({ template: 'code' });
    expect(decision.primary).toBe('claude_code');
    expect(decision.primaryAvailable).toBe(true);
  });

  it('honors an explicit worker override with full confidence', () => {
    const registry = new WorkerRegistry();
    const decision = new WorkerRouter(registry).recommend({ template: 'code', explicitWorker: 'gemini' });

    expect(decision.primary).toBe('gemini');
    expect(decision.fallback).toBeNull();
    expect(decision.confidence).toBe(1);
  });

  it('ignores task-history when no dataDir is given (default, unlearned behavior unchanged)', () => {
    const registry = new WorkerRegistry();
    const decision = new WorkerRouter(registry).recommend({ template: 'code' });
    expect(decision.primary).toBe('claude_code');
    expect(decision.reason).not.toContain('成功率');
  });

  it('nudges the winner toward a worker with a strong recorded success rate for that capability', () => {
    withTmpDir((dir) => {
      const registry = new WorkerRegistry();
      // Default profiles score claude_code (5) above gemini (4) for "code" -
      // claude_code wins by default. Feed enough history to flip it.
      for (let i = 0; i < 3; i++) {
        appendTaskHistory(dir, { task_id: `f${i}`, template: 'code', timestamp: i, mode: 'worker_run', worker: 'claude_code', status: 'failed' });
        appendTaskHistory(dir, { task_id: `c${i}`, template: 'code', timestamp: i, mode: 'worker_run', worker: 'gemini', status: 'completed' });
      }

      const decision = new WorkerRouter(registry, undefined, dir).recommend({ template: 'code' });
      expect(decision.primary).toBe('gemini');
      expect(decision.reason).toContain('成功率');
    });
  });

  it('does not apply a learning nudge below the minimum sample threshold', () => {
    withTmpDir((dir) => {
      const registry = new WorkerRegistry();
      // Only 2 samples each - below MIN_SAMPLES_FOR_LEARNING (3), so the
      // default strength ranking (claude_code > gemini) should hold.
      for (let i = 0; i < 2; i++) {
        appendTaskHistory(dir, { task_id: `f${i}`, template: 'code', timestamp: i, mode: 'worker_run', worker: 'claude_code', status: 'failed' });
        appendTaskHistory(dir, { task_id: `c${i}`, template: 'code', timestamp: i, mode: 'worker_run', worker: 'gemini', status: 'completed' });
      }

      const decision = new WorkerRouter(registry, undefined, dir).recommend({ template: 'code' });
      expect(decision.primary).toBe('claude_code');
      expect(decision.reason).not.toContain('成功率');
    });
  });

  it('scopes the learning nudge to the requested capability, ignoring history from other templates', () => {
    withTmpDir((dir) => {
      const registry = new WorkerRegistry();
      // gemini has a great "research" record, not "code" - shouldn't affect the code recommendation.
      for (let i = 0; i < 5; i++) {
        appendTaskHistory(dir, { task_id: `r${i}`, template: 'research', timestamp: i, mode: 'worker_run', worker: 'gemini', status: 'completed' });
      }

      const decision = new WorkerRouter(registry, undefined, dir).recommend({ template: 'code' });
      expect(decision.primary).toBe('claude_code');
    });
  });
});
