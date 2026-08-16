/**
 * Route-level tests for /api/chat/active-project (Phase 14-A). The route is
 * a thin wrapper over AgentService.setActiveProject/getActiveProject
 * (in-memory session state, see agent-service.ts) plus existence validation
 * against the real projects table.
 */
import { beforeEach, describe, expect, it } from 'bun:test';
import { createApiRoutes, type ApiContext } from './api-routes.ts';
import { initDatabase } from '../vault/schema.ts';
import { createProject } from '../vault/projects.ts';

type Handler = (req: Request) => Response | Promise<Response>;
type NoArgHandler = () => Response | Promise<Response>;

describe('/api/chat/active-project', () => {
  let activeProjectId: string | null;

  function makeCtx(): ApiContext {
    activeProjectId = null;
    return {
      agentService: {
        getActiveProject: () => activeProjectId,
        setActiveProject: (id: string | null) => { activeProjectId = id; },
      },
    } as unknown as ApiContext;
  }

  beforeEach(() => {
    initDatabase(':memory:');
  });

  it('reports null before anything is pinned', async () => {
    const routes = createApiRoutes(makeCtx());
    const route = routes['/api/chat/active-project'] as { GET: NoArgHandler };
    const body = await (await route.GET()).json() as { project_id: string | null };
    expect(body.project_id).toBeNull();
  });

  it('pins an existing project, then GET reflects it', async () => {
    const project = createProject('Launch Announcement');
    const routes = createApiRoutes(makeCtx());
    const route = routes['/api/chat/active-project'] as { GET: NoArgHandler; POST: Handler };

    const postRes = await route.POST(new Request('http://x/api/chat/active-project', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_id: project.id }),
    }));
    const postBody = await postRes.json() as { ok: boolean; project_id: string };
    expect(postRes.status).toBe(200);
    expect(postBody.ok).toBe(true);
    expect(postBody.project_id).toBe(project.id);

    const getBody = await (await route.GET()).json() as { project_id: string | null };
    expect(getBody.project_id).toBe(project.id);
  });

  it('clears the pin when project_id is null', async () => {
    const project = createProject('Launch Announcement');
    const routes = createApiRoutes(makeCtx());
    const route = routes['/api/chat/active-project'] as { GET: NoArgHandler; POST: Handler };

    await route.POST(new Request('http://x/api/chat/active-project', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_id: project.id }),
    }));
    await route.POST(new Request('http://x/api/chat/active-project', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_id: null }),
    }));

    const getBody = await (await route.GET()).json() as { project_id: string | null };
    expect(getBody.project_id).toBeNull();
  });

  it('rejects an unknown project id with 404 and does not change state', async () => {
    const routes = createApiRoutes(makeCtx());
    const route = routes['/api/chat/active-project'] as { GET: NoArgHandler; POST: Handler };

    const res = await route.POST(new Request('http://x/api/chat/active-project', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_id: 'does-not-exist' }),
    }));
    expect(res.status).toBe(404);

    const getBody = await (await route.GET()).json() as { project_id: string | null };
    expect(getBody.project_id).toBeNull();
  });

  it('rejects an empty-string project id with 400', async () => {
    const routes = createApiRoutes(makeCtx());
    const route = routes['/api/chat/active-project'] as { POST: Handler };

    const res = await route.POST(new Request('http://x/api/chat/active-project', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_id: '' }),
    }));
    expect(res.status).toBe(400);
  });
});
