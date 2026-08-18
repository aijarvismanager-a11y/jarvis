import { describe, expect, it } from 'bun:test';
import { WorkerRegistry } from '../workers/registry.ts';
import { WorkerRouter } from './ai-router.ts';
import type { Worker, WorkerRunRequest, WorkerRunResult } from '../workers/types.ts';

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
