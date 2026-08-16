/**
 * Round-trip tests for /api/config/image and /api/config/github (Phase 13-B
 * routes, deferred test from Phase 13 since both credential setters write
 * through src/vault/keychain.ts to a real ~/.jarvis/.secrets.* file — a
 * round-trip test needs keychain.ts mocked, not called for real, to avoid
 * writing into a developer's actual secrets file. Phase 14-B closes that gap.
 */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { createApiRoutes, type ApiContext } from './api-routes.ts';
import { ImageManager } from '../image/manager.ts';

type Handler = (req: Request) => Response | Promise<Response>;
type NoArgHandler = () => Response | Promise<Response>;

describe('/api/config/image and /api/config/github credential round-trip (Phase 14-B)', () => {
  let store: Record<string, string>;

  beforeEach(() => {
    store = {};
    mock.module('../vault/keychain.ts', () => ({
      getSecret: (name: string) => store[name] ?? null,
      setSecret: (name: string, value: string) => { store[name] = value; },
      deleteSecret: (name: string) => { delete store[name]; },
      hasSecret: (name: string) => name in store,
    }));
  });

  afterEach(() => {
    mock.restore();
  });

  function makeCtx(): ApiContext {
    const imageManager = new ImageManager();
    return {
      agentService: { getImageManager: () => imageManager },
    } as unknown as ApiContext;
  }

  describe('/api/config/image', () => {
    it('reports no configured keys before any POST', async () => {
      const routes = createApiRoutes(makeCtx());
      const route = routes['/api/config/image'] as { GET: NoArgHandler };
      const body = await (await route.GET()).json() as {
        providers: Record<string, { has_api_key: boolean }>;
      };
      expect(body.providers['openai-image']!.has_api_key).toBe(false);
      expect(body.providers['gemini-image']!.has_api_key).toBe(false);
    });

    it('round-trips a saved key: POST then GET reports has_api_key true, never echoes the key', async () => {
      const routes = createApiRoutes(makeCtx());
      const route = routes['/api/config/image'] as { GET: NoArgHandler; POST: Handler };

      const postRes = await route.POST(new Request('http://x/api/config/image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'openai-image', api_key: 'sk-test-secret-123' }),
      }));
      const postBody = await postRes.json() as { ok: boolean };
      expect(postRes.status).toBe(200);
      expect(postBody.ok).toBe(true);
      expect(JSON.stringify(postBody)).not.toContain('sk-test-secret-123');

      const getBody = await (await route.GET()).json() as {
        providers: Record<string, { has_api_key: boolean }>;
      };
      expect(getBody.providers['openai-image']!.has_api_key).toBe(true);
      expect(getBody.providers['gemini-image']!.has_api_key).toBe(false);
      expect(JSON.stringify(getBody)).not.toContain('sk-test-secret-123');
    });

    it('rejects an unknown provider name with 400', async () => {
      const routes = createApiRoutes(makeCtx());
      const route = routes['/api/config/image'] as { POST: Handler };
      const res = await route.POST(new Request('http://x/api/config/image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'stability-ai', api_key: 'sk-test' }),
      }));
      expect(res.status).toBe(400);
    });

    it('rejects a missing api_key with 400', async () => {
      const routes = createApiRoutes(makeCtx());
      const route = routes['/api/config/image'] as { POST: Handler };
      const res = await route.POST(new Request('http://x/api/config/image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'openai-image' }),
      }));
      expect(res.status).toBe(400);
    });

    it('re-registers the key onto the live ImageManager so it is usable without a restart', async () => {
      const imageManager = new ImageManager();
      const ctx = { agentService: { getImageManager: () => imageManager } } as unknown as ApiContext;
      const routes = createApiRoutes(ctx);
      const route = routes['/api/config/image'] as { POST: Handler };

      expect(imageManager.hasProviders()).toBe(false);
      await route.POST(new Request('http://x/api/config/image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'gemini-image', api_key: 'sk-test-gemini' }),
      }));
      expect(imageManager.hasProviders()).toBe(true);
      expect(imageManager.getProviderNames()).toContain('gemini-image');
    });
  });

  describe('/api/config/github', () => {
    it('reports has_token false before any POST', async () => {
      const routes = createApiRoutes(makeCtx());
      const route = routes['/api/config/github'] as { GET: NoArgHandler };
      const body = await (await route.GET()).json() as { has_token: boolean };
      expect(body.has_token).toBe(false);
    });

    it('round-trips a saved token: POST then GET reports has_token true, never echoes the token', async () => {
      const routes = createApiRoutes(makeCtx());
      const route = routes['/api/config/github'] as { GET: NoArgHandler; POST: Handler };

      const postRes = await route.POST(new Request('http://x/api/config/github', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: 'ghp_test_token_123' }),
      }));
      const postBody = await postRes.json() as { ok: boolean };
      expect(postRes.status).toBe(200);
      expect(postBody.ok).toBe(true);
      expect(JSON.stringify(postBody)).not.toContain('ghp_test_token_123');

      const getBody = await (await route.GET()).json() as { has_token: boolean };
      expect(getBody.has_token).toBe(true);
      expect(JSON.stringify(getBody)).not.toContain('ghp_test_token_123');
    });

    it('rejects a missing token with 400', async () => {
      const routes = createApiRoutes(makeCtx());
      const route = routes['/api/config/github'] as { POST: Handler };
      const res = await route.POST(new Request('http://x/api/config/github', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }));
      expect(res.status).toBe(400);
    });
  });
});
