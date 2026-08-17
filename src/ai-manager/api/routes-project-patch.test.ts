/**
 * Route-level round-trip test for PATCH /api/ai-manager/projects/:id
 * (Phase 15-A). No test previously exercised this route directly for
 * execution_mode/cost_mode - both were only covered indirectly via
 * ManagerAgent unit tests reading the persisted project row.
 */
import { beforeEach, describe, expect, it } from 'bun:test';
import { createAIManagerRoutes, type AIManagerApiContext } from './routes.ts';
import { initDatabase } from '../../vault/schema.ts';
import { createProject } from '../../vault/projects.ts';

type Handler = (req: Request & { params: { id: string } }) => Response | Promise<Response>;

function makeCtx(): AIManagerApiContext {
  return {
    getLLMManager: () => { throw new Error('not needed for this test'); },
    getTaskDispatcher: () => null,
    getApprovalManager: () => { throw new Error('not needed for this test'); },
  } as unknown as AIManagerApiContext;
}

function patch(routeId: string, body: unknown) {
  const routes = createAIManagerRoutes(makeCtx());
  const route = routes['/api/ai-manager/projects/:id'] as { PATCH: Handler };
  return route.PATCH(
    Object.assign(
      new Request(`http://x/api/ai-manager/projects/${routeId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
      { params: { id: routeId } },
    ),
  );
}

describe('PATCH /api/ai-manager/projects/:id', () => {
  beforeEach(() => {
    initDatabase(':memory:');
  });

  it('updates execution_mode and persists it', async () => {
    const project = createProject('Checkout Rebuild');
    expect(project.execution_mode).toBe('assisted');

    const res = await patch(project.id, { execution_mode: 'manual' });
    expect(res.status).toBe(200);
    const body = await res.json() as { execution_mode: string };
    expect(body.execution_mode).toBe('manual');
  });

  it('updates cost_mode and persists it', async () => {
    const project = createProject('Checkout Rebuild');
    expect(project.cost_mode).toBe('balanced');

    const res = await patch(project.id, { cost_mode: 'quality' });
    expect(res.status).toBe(200);
    const body = await res.json() as { cost_mode: string };
    expect(body.cost_mode).toBe('quality');
  });

  it('updates rules and persists it', async () => {
    const project = createProject('Checkout Rebuild');
    expect(project.rules).toEqual([]);

    const res = await patch(project.id, { rules: ['Use TypeScript strict mode', 'No console.log in production'] });
    expect(res.status).toBe(200);
    const body = await res.json() as { rules: string[] };
    expect(body.rules).toEqual(['Use TypeScript strict mode', 'No console.log in production']);
  });

  it('rejects a non-array rules value with 400', async () => {
    const project = createProject('Checkout Rebuild');
    const res = await patch(project.id, { rules: 'not-an-array' });
    expect(res.status).toBe(400);
  });

  it('rejects an invalid execution_mode with 400', async () => {
    const project = createProject('Checkout Rebuild');
    const res = await patch(project.id, { execution_mode: 'yolo' });
    expect(res.status).toBe(400);
  });

  it('rejects an invalid cost_mode with 400', async () => {
    const project = createProject('Checkout Rebuild');
    const res = await patch(project.id, { cost_mode: 'yolo' });
    expect(res.status).toBe(400);
  });

  it('updates repo_path and persists it (enables the Self-Healing QA gate for this project)', async () => {
    const project = createProject('Checkout Rebuild');
    expect(project.repo_path).toBeNull();

    const res = await patch(project.id, { repo_path: '/home/dev/checkout-rebuild' });
    expect(res.status).toBe(200);
    const body = await res.json() as { repo_path: string | null };
    expect(body.repo_path).toBe('/home/dev/checkout-rebuild');
  });

  it('clears repo_path when explicitly set to null', async () => {
    const project = createProject('Checkout Rebuild', { repo_path: '/home/dev/checkout-rebuild' });
    expect(project.repo_path).toBe('/home/dev/checkout-rebuild');

    const res = await patch(project.id, { repo_path: null });
    expect(res.status).toBe(200);
    const body = await res.json() as { repo_path: string | null };
    expect(body.repo_path).toBeNull();
  });

  it('rejects a non-string/non-null repo_path with 400', async () => {
    const project = createProject('Checkout Rebuild');
    const res = await patch(project.id, { repo_path: 42 });
    expect(res.status).toBe(400);
  });

  it('404s for an unknown project id', async () => {
    const res = await patch('does-not-exist', { execution_mode: 'manual' });
    expect(res.status).toBe(404);
  });
});
