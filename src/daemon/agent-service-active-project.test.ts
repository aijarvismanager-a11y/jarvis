/**
 * Phase 14-A: an AI Manager project pinned to the classic chat session
 * (AgentService.setActiveProject) should reach vault memory retrieval for
 * ordinary conversation turns, mirroring how ManagerAgent's task-tier
 * subtask execution already threads project.id through to
 * getKnowledgeForMessage (Phase 13-A, see manager-agent.e2e.test.ts's
 * "ManagerAgent project-scoped memory" block).
 *
 * Exercises the plumbing directly on AgentService (mocking
 * src/vault/retrieval.ts) rather than standing up a full daemon + role +
 * LLM provider harness, since buildAmbientFactsBlock/buildPromptContext are
 * where the project id actually gets forwarded and neither needs a loaded
 * role to be exercised in isolation.
 */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import type { JarvisConfig } from '../config/types.ts';

describe('AgentService active project pin (Phase 14-A)', () => {
  let calls: Array<{ text: string; projectId?: string }>;

  beforeEach(() => {
    calls = [];
    mock.module('../vault/retrieval.ts', () => ({
      getKnowledgeForMessage: (text: string, projectId?: string) => {
        calls.push({ text, projectId });
        return '';
      },
    }));
  });

  afterEach(() => {
    mock.restore();
  });

  it('defaults to no active project', async () => {
    const { AgentService } = await import('./agent-service.ts');
    const service = new AgentService({} as JarvisConfig);
    expect(service.getActiveProject()).toBeNull();
  });

  it('setActiveProject/getActiveProject round-trips, including clearing with null', async () => {
    const { AgentService } = await import('./agent-service.ts');
    const service = new AgentService({} as JarvisConfig);

    service.setActiveProject('proj-123');
    expect(service.getActiveProject()).toBe('proj-123');

    service.setActiveProject(null);
    expect(service.getActiveProject()).toBeNull();
  });

  it('forwards the pinned project id to vault memory retrieval for a conv-tier ambient facts block', async () => {
    const { AgentService } = await import('./agent-service.ts');
    const service = new AgentService({} as JarvisConfig);
    service.setActiveProject('proj-abc');

    // buildAmbientFactsBlock is private (conv-tier ambient facts path used by
    // streamMessageConv/handleMessageConv) - accessed via an `as any` escape
    // hatch, the same way TS-private-but-JS-public methods are unit tested
    // when the alternative is standing up the full conv orchestrator.
    (service as unknown as { buildAmbientFactsBlock: (text: string, projectId?: string) => string })
      .buildAmbientFactsBlock('what is the launch plan?', service.getActiveProject() ?? undefined);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({ text: 'what is the launch plan?', projectId: 'proj-abc' });
  });

  it('omits the project id when nothing is pinned', async () => {
    const { AgentService } = await import('./agent-service.ts');
    const service = new AgentService({} as JarvisConfig);

    (service as unknown as { buildAmbientFactsBlock: (text: string, projectId?: string) => string })
      .buildAmbientFactsBlock('hello', service.getActiveProject() ?? undefined);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({ text: 'hello', projectId: undefined });
  });
});
