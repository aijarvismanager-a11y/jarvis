import { describe, expect, it, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkerRegistry } from '../workers/registry.ts';
import { ensureWorkspace } from './workspace.ts';
import { TaskWorkerRunner } from './task-runner.ts';
import type { Worker, WorkerRunRequest, WorkerRunResult } from '../workers/types.ts';

function fakeWorker(name: string, result: WorkerRunResult): Worker {
  return {
    definition: {
      name,
      type: 'custom',
      status: 'ready',
      capabilities: ['code'],
      input_method: 'cli',
      output_method: 'stdout',
      workspace: '/tmp/ws',
      timeout_ms: 1000,
      retry: 0,
      enabled: true,
    },
    async run(_req: WorkerRunRequest): Promise<WorkerRunResult> {
      return result;
    },
  };
}

let dir: string | undefined;

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

describe('TaskWorkerRunner.run', () => {
  it('routes to the matching worker, writes a handoff file, and calls the internal recorder', async () => {
    dir = mkdtempSync(join(tmpdir(), 'jarvis-runner-'));
    const workspace = ensureWorkspace(dir);
    const registry = new WorkerRegistry();
    registry.register(fakeWorker('claude_code', { status: 'completed', summary: 'did the thing', output: 'ok', files: ['a.ts'] }));

    const recorded: unknown[] = [];
    const runner = new TaskWorkerRunner(registry, workspace, (args) => recorded.push(args));

    const outcome = await runner.run({ task_id: 'task_0001', template: 'code', prompt: 'fix the bug' });

    expect(outcome.worker).toBe('claude_code');
    expect(outcome.result.status).toBe('completed');
    expect(registry.get('claude_code')?.definition.status).toBe('done');

    const written = JSON.parse(readFileSync(outcome.handoffFilePath, 'utf-8'));
    expect(written).toMatchObject({ task_id: 'task_0001', from: 'claude_code', to: 'jarvis', status: 'completed' });

    expect(recorded).toEqual([
      {
        task_id: 'task_0001',
        from_agent: 'claude_code',
        to_agent: 'jarvis',
        status: 'completed',
        summary: 'did the thing',
        files: ['a.ts'],
      },
    ]);
  });

  it('throws when no worker declares the required capability', async () => {
    dir = mkdtempSync(join(tmpdir(), 'jarvis-runner-'));
    const workspace = ensureWorkspace(dir);
    const registry = new WorkerRegistry();

    const runner = new TaskWorkerRunner(registry, workspace);
    expect(runner.run({ task_id: 'task_0002', template: 'code', prompt: 'x' })).rejects.toThrow(
      'no Worker available for capability "code"'
    );
  });

  it('marks the worker error on failure but still writes a handoff file', async () => {
    dir = mkdtempSync(join(tmpdir(), 'jarvis-runner-'));
    const workspace = ensureWorkspace(dir);
    const registry = new WorkerRegistry();
    registry.register(fakeWorker('claude_code', { status: 'failed', summary: 'boom', output: '', files: [], error: 'boom' }));

    const runner = new TaskWorkerRunner(registry, workspace);
    const outcome = await runner.run({ task_id: 'task_0003', template: 'code', prompt: 'x' });

    expect(outcome.result.status).toBe('failed');
    expect(registry.get('claude_code')?.definition.status).toBe('error');
  });
});
