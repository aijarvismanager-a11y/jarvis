import { describe, expect, it, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkerRegistry } from '../../workers/registry.ts';
import { ensureWorkspace } from '../workspace.ts';
import { TaskWorkerRunner } from '../task-runner.ts';
import { writeHandoffFile } from '../handoff-file.ts';
import { createOrchestratorRoutes } from './routes.ts';
import type { Worker, WorkerRunRequest, WorkerRunResult } from '../../workers/types.ts';

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

function setup() {
  dir = mkdtempSync(join(tmpdir(), 'jarvis-routes-'));
  const workspace = ensureWorkspace(dir);
  const registry = new WorkerRegistry();
  registry.register(fakeWorker('claude_code', { status: 'completed', summary: 'done', output: 'ok', files: [] }));
  const runner = new TaskWorkerRunner(registry, workspace);
  const routes = createOrchestratorRoutes({
    getRegistry: () => registry,
    getRunner: () => runner,
    getWorkspace: () => workspace,
    getDataDir: () => dir!,
  }) as Record<string, Record<string, (req: any) => Response | Promise<Response>>>;
  return { workspace, registry, routes };
}

describe('createOrchestratorRoutes', () => {
  it('GET /api/orchestrator/workers lists registered workers without the workspace path', async () => {
    const { routes } = setup();
    const resp = await routes['/api/orchestrator/workers']!.GET!(new Request('http://x/api/orchestrator/workers'));
    const body = await resp.json();
    expect(body.workers).toEqual([
      { name: 'claude_code', type: 'custom', status: 'ready', capabilities: ['code'], input_method: 'cli', output_method: 'stdout', timeout_ms: 1000, retry: 0, enabled: true },
    ]);
  });

  it('POST /api/orchestrator/workers/:name/enabled toggles enabled and 404s for an unknown worker', async () => {
    const { routes, registry } = setup();
    const req = new Request('http://x', { method: 'POST', body: JSON.stringify({ enabled: false }) }) as any;
    req.params = { name: 'claude_code' };
    const resp = await routes['/api/orchestrator/workers/:name/enabled']!.POST!(req);
    expect(resp.status).toBe(200);
    expect(registry.get('claude_code')?.definition.enabled).toBe(false);

    const missing = new Request('http://x', { method: 'POST', body: JSON.stringify({ enabled: true }) }) as any;
    missing.params = { name: 'nope' };
    const missingResp = await routes['/api/orchestrator/workers/:name/enabled']!.POST!(missing);
    expect(missingResp.status).toBe(404);
  });

  it('POST /api/orchestrator/workers/:name/enabled persists the toggle to disk', async () => {
    const { routes } = setup();
    const req = new Request('http://x', { method: 'POST', body: JSON.stringify({ enabled: false }) }) as any;
    req.params = { name: 'claude_code' };
    await routes['/api/orchestrator/workers/:name/enabled']!.POST!(req);

    const { loadWorkerSettings } = await import('../../workers/settings.ts');
    expect(loadWorkerSettings(dir!)).toEqual({ enabled: { claude_code: false } });
  });

  it('POST /api/orchestrator/tasks runs a task and returns the outcome', async () => {
    const { routes } = setup();
    const req = new Request('http://x', {
      method: 'POST',
      body: JSON.stringify({ task_id: 't1', template: 'code', prompt: 'do it' }),
    });
    const resp = await routes['/api/orchestrator/tasks']!.POST!(req);
    const body = await resp.json();
    expect(resp.status).toBe(200);
    expect(body.worker).toBe('claude_code');
    expect(body.result.status).toBe('completed');
  });

  it('POST /api/orchestrator/tasks rejects an invalid template with 400', async () => {
    const { routes } = setup();
    const req = new Request('http://x', {
      method: 'POST',
      body: JSON.stringify({ task_id: 't1', template: 'bogus', prompt: 'do it' }),
    });
    const resp = await routes['/api/orchestrator/tasks']!.POST!(req);
    expect(resp.status).toBe(400);
  });

  it('POST /api/orchestrator/custom-workers adds a Worker to the live registry and persists it', async () => {
    const { routes, registry } = setup();
    const req = new Request('http://x', {
      method: 'POST',
      body: JSON.stringify({ name: 'my_tool', binary: 'my-tool', args: ['{prompt}'], capabilities: ['code'] }),
    });
    const resp = await routes['/api/orchestrator/custom-workers']!.POST!(req);
    expect(resp.status).toBe(201);
    expect(registry.get('my_tool')).toBeDefined();
    expect(registry.get('my_tool')?.definition.type).toBe('custom');

    const { loadCustomWorkers } = await import('../../workers/custom-registry.ts');
    expect(loadCustomWorkers(dir!)).toEqual([{ name: 'my_tool', binary: 'my-tool', args: ['{prompt}'], capabilities: ['code'] }]);
  });

  it('POST /api/orchestrator/custom-workers rejects a name collision with a built-in Worker', async () => {
    const { routes } = setup();
    const req = new Request('http://x', {
      method: 'POST',
      body: JSON.stringify({ name: 'gemini', binary: 'x', args: [], capabilities: ['code'] }),
    });
    const resp = await routes['/api/orchestrator/custom-workers']!.POST!(req);
    expect(resp.status).toBe(400);
  });

  it('DELETE /api/orchestrator/custom-workers/:name removes it from the registry and disk, 404s if unknown', async () => {
    const { routes, registry } = setup();
    await routes['/api/orchestrator/custom-workers']!.POST!(
      new Request('http://x', { method: 'POST', body: JSON.stringify({ name: 'my_tool', binary: 'my-tool', args: [], capabilities: ['code'] }) }),
    );

    const delReq = new Request('http://x', { method: 'DELETE' }) as any;
    delReq.params = { name: 'my_tool' };
    const delResp = await routes['/api/orchestrator/custom-workers/:name']!.DELETE!(delReq);
    expect(delResp.status).toBe(200);
    expect(registry.get('my_tool')).toBeUndefined();

    const missing = new Request('http://x', { method: 'DELETE' }) as any;
    missing.params = { name: 'my_tool' };
    const missingResp = await routes['/api/orchestrator/custom-workers/:name']!.DELETE!(missing);
    expect(missingResp.status).toBe(404);
  });

  it('GET /api/orchestrator/handoffs lists filed handoffs, most recent first', async () => {
    const { routes, workspace } = setup();
    writeHandoffFile(workspace.handoff, {
      task_id: 'a', from: 'claude_code', to: 'jarvis', status: 'completed', summary: 's1', instructions: '', files: [], research: [], next_action: 'review',
    });
    const resp = await routes['/api/orchestrator/handoffs']!.GET!(new Request('http://x/api/orchestrator/handoffs'));
    const body = await resp.json();
    expect(body.handoffs).toHaveLength(1);
    expect(body.handoffs[0].task_id).toBe('a');
  });
});
