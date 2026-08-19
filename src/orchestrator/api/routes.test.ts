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

  it('POST /api/orchestrator/workers/:name/enabled runs checkAvailable on enable and sets status accordingly', async () => {
    const { routes, registry } = setup();
    let checked = false;
    const worker = fakeWorker('probed', { status: 'completed', summary: 'ok', output: '', files: [] });
    (worker as any).checkAvailable = async () => {
      checked = true;
      return false;
    };
    worker.definition.enabled = false;
    registry.register(worker);

    const req = new Request('http://x', { method: 'POST', body: JSON.stringify({ enabled: true }) }) as any;
    req.params = { name: 'probed' };
    await routes['/api/orchestrator/workers/:name/enabled']!.POST!(req);

    expect(checked).toBe(true);
    expect(registry.get('probed')?.definition.status).toBe('error');
  });

  it('POST /api/orchestrator/workers/:name/enabled does not run checkAvailable when disabling', async () => {
    const { routes, registry } = setup();
    let checked = false;
    const worker = fakeWorker('probed2', { status: 'completed', summary: 'ok', output: '', files: [] });
    (worker as any).checkAvailable = async () => {
      checked = true;
      return true;
    };
    registry.register(worker);

    const req = new Request('http://x', { method: 'POST', body: JSON.stringify({ enabled: false }) }) as any;
    req.params = { name: 'probed2' };
    await routes['/api/orchestrator/workers/:name/enabled']!.POST!(req);

    expect(checked).toBe(false);
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

  it('POST /api/orchestrator/mcp-workers adds a Worker to the live registry and persists it', async () => {
    const { routes, registry } = setup();
    const req = new Request('http://x', {
      method: 'POST',
      body: JSON.stringify({ name: 'my_mcp', command: 'my-mcp-server', args: [], tool: 'run', capabilities: ['research'] }),
    });
    const resp = await routes['/api/orchestrator/mcp-workers']!.POST!(req);
    expect(resp.status).toBe(201);
    expect(registry.get('my_mcp')).toBeDefined();
    expect(registry.get('my_mcp')?.definition.input_method).toBe('mcp');

    const { loadMcpWorkers } = await import('../../workers/mcp-registry.ts');
    expect(loadMcpWorkers(dir!)).toEqual([{ name: 'my_mcp', command: 'my-mcp-server', args: [], tool: 'run', capabilities: ['research'] }]);
  });

  it('POST /api/orchestrator/mcp-workers rejects a name collision with a built-in Worker', async () => {
    const { routes } = setup();
    const req = new Request('http://x', {
      method: 'POST',
      body: JSON.stringify({ name: 'gemini', command: 'x', args: [], tool: 'run', capabilities: ['research'] }),
    });
    const resp = await routes['/api/orchestrator/mcp-workers']!.POST!(req);
    expect(resp.status).toBe(400);
  });

  it('POST /api/orchestrator/mcp-workers rejects a name collision with an existing custom Worker', async () => {
    const { routes } = setup();
    await routes['/api/orchestrator/custom-workers']!.POST!(
      new Request('http://x', { method: 'POST', body: JSON.stringify({ name: 'shared_name', binary: 'x', args: [], capabilities: ['code'] }) }),
    );
    const req = new Request('http://x', {
      method: 'POST',
      body: JSON.stringify({ name: 'shared_name', command: 'y', args: [], tool: 'run', capabilities: ['research'] }),
    });
    const resp = await routes['/api/orchestrator/mcp-workers']!.POST!(req);
    expect(resp.status).toBe(400);
  });

  it('DELETE /api/orchestrator/mcp-workers/:name removes it from the registry and disk, 404s if unknown', async () => {
    const { routes, registry } = setup();
    await routes['/api/orchestrator/mcp-workers']!.POST!(
      new Request('http://x', { method: 'POST', body: JSON.stringify({ name: 'my_mcp', command: 'my-mcp-server', args: [], tool: 'run', capabilities: ['research'] }) }),
    );

    const delReq = new Request('http://x', { method: 'DELETE' }) as any;
    delReq.params = { name: 'my_mcp' };
    const delResp = await routes['/api/orchestrator/mcp-workers/:name']!.DELETE!(delReq);
    expect(delResp.status).toBe(200);
    expect(registry.get('my_mcp')).toBeUndefined();

    const missing = new Request('http://x', { method: 'DELETE' }) as any;
    missing.params = { name: 'my_mcp' };
    const missingResp = await routes['/api/orchestrator/mcp-workers/:name']!.DELETE!(missing);
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

  it('GET /api/orchestrator/cost returns a cost summary with no usage recorded', async () => {
    // llm_usage lives behind a module-level DB resolver shared with other
    // test files (src/llm/usage.ts) - point it at a fresh empty DB so this
    // assertion doesn't depend on whatever ran earlier in the same process.
    const { initDatabase, closeDb } = await import('../../vault/schema.ts');
    const { setUsageDatabase } = await import('../../llm/usage.ts');
    closeDb();
    setUsageDatabase(() => initDatabase(':memory:'));

    const { routes } = setup();
    const resp = await routes['/api/orchestrator/cost']!.GET!(new Request('http://x/api/orchestrator/cost'));
    const body = await resp.json();
    expect(body.daily_cost).toBe(0);
    expect(body.status).toBe('ok');
    expect(body.budget).toEqual({ daily_budget: 300, warning_threshold: 200, hard_limit: 300, currency: 'JPY' });
  });

  it('GET /api/orchestrator/budget returns defaults, PUT persists and validates', async () => {
    const { routes } = setup();

    const getResp = await routes['/api/orchestrator/budget']!.GET!(new Request('http://x'));
    expect((await getResp.json()).budget.daily_budget).toBe(300);

    const badResp = await routes['/api/orchestrator/budget']!.PUT!(
      new Request('http://x', { method: 'PUT', body: JSON.stringify({ daily_budget: -1, warning_threshold: 1, hard_limit: 1, currency: 'JPY' }) }),
    );
    expect(badResp.status).toBe(400);

    const putResp = await routes['/api/orchestrator/budget']!.PUT!(
      new Request('http://x', { method: 'PUT', body: JSON.stringify({ daily_budget: 500, warning_threshold: 400, hard_limit: 500, currency: 'USD' }) }),
    );
    expect(putResp.status).toBe(200);

    const { loadBudget } = await import('../budget.ts');
    expect(loadBudget(dir!)).toEqual({ daily_budget: 500, warning_threshold: 400, hard_limit: 500, currency: 'USD' });
  });

  it('GET /api/orchestrator/pricing returns defaults, PUT persists and validates', async () => {
    const { routes } = setup();

    const getResp = await routes['/api/orchestrator/pricing']!.GET!(new Request('http://x'));
    const body = await getResp.json();
    expect(body.pricing.currency).toBe('JPY');
    expect(body.pricing.models['anthropic:claude-sonnet-5']).toBeDefined();

    const badResp = await routes['/api/orchestrator/pricing']!.PUT!(
      new Request('http://x', { method: 'PUT', body: JSON.stringify({ currency: 'JPY' }) }),
    );
    expect(badResp.status).toBe(400);

    const putResp = await routes['/api/orchestrator/pricing']!.PUT!(
      new Request('http://x', {
        method: 'PUT',
        body: JSON.stringify({
          currency: 'JPY',
          fx_rate_usd: 150,
          models: { 'custom:model': { input_per_1k: 1, output_per_1k: 2 } },
          default: { input_per_1k: 0.5, output_per_1k: 1 },
        }),
      }),
    );
    expect(putResp.status).toBe(200);
    expect((await putResp.json()).pricing.models['custom:model']).toEqual({ input_per_1k: 1, output_per_1k: 2 });
  });
});
