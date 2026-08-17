import { describe, expect, it } from 'bun:test';
import { WorkerRegistry } from './registry.ts';
import type { Worker, WorkerRunRequest, WorkerRunResult } from './types.ts';

function fakeWorker(name: string, capabilities: Worker['definition']['capabilities'], enabled = true): Worker {
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
      enabled,
    },
    async run(_req: WorkerRunRequest): Promise<WorkerRunResult> {
      return { status: 'completed', summary: 'ok', output: '', files: [] };
    },
  };
}

describe('WorkerRegistry', () => {
  it('finds enabled workers by capability, skipping disabled ones', () => {
    const registry = new WorkerRegistry();
    registry.register(fakeWorker('a', ['code']));
    registry.register(fakeWorker('b', ['code'], false));
    registry.register(fakeWorker('c', ['research']));

    const found = registry.findByCapability('code');
    expect(found.map((w) => w.definition.name)).toEqual(['a']);
  });

  it('setStatus updates the worker definition status in place', () => {
    const registry = new WorkerRegistry();
    registry.register(fakeWorker('a', ['code']));
    registry.setStatus('a', 'working');
    expect(registry.get('a')?.definition.status).toBe('working');
  });

  it('unregister removes a worker', () => {
    const registry = new WorkerRegistry();
    registry.register(fakeWorker('a', ['code']));
    registry.unregister('a');
    expect(registry.get('a')).toBeUndefined();
  });
});
