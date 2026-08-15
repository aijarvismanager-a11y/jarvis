/**
 * Phase 10 demo scenario 1: "simple website creation" - a project runs
 * through the full ManagerAgent pipeline (Planner -> AIRouter -> TaskDispatcher
 * -> SelfHealingRunner -> Handoff) end to end, using a hand-rolled mock
 * LLMProvider so this needs no real API key and makes no external calls.
 *
 * Follows the existing MockProvider/LLMManager test pattern from
 * src/agents/conv/conv-orchestrator.test.ts.
 */
import { describe, expect, it, beforeEach } from 'bun:test';
import { initDatabase, getDb } from '../vault/schema.ts';
import { LLMManager } from '../llm/manager.ts';
import type { LLMProvider, LLMMessage, LLMOptions, LLMResponse, LLMStreamEvent } from '../llm/provider.ts';
import { TaskRegistry } from '../agents/conv/task-registry.ts';
import { TaskDispatcher, type TaskRunner } from '../agents/conv/task-dispatcher.ts';
import { AIRouter } from './router.ts';
import { ManagerAgent } from './manager-agent.ts';
import { getProjectTasks } from '../vault/project-tasks.ts';
import { getHandoffsForTask } from '../agents/handoff.ts';

class MockProvider implements LLMProvider {
  name = 'mock';
  private queue: LLMResponse[];
  constructor(responses: LLMResponse[]) {
    this.queue = [...responses];
  }
  async chat(_messages: LLMMessage[], _opts?: LLMOptions): Promise<LLMResponse> {
    const next = this.queue.shift();
    if (!next) {
      return { content: 'fallback', tool_calls: [], usage: { input_tokens: 0, output_tokens: 0 }, model: 'mock', finish_reason: 'stop' };
    }
    return next;
  }
  // eslint-disable-next-line require-yield
  async *stream(): AsyncIterable<LLMStreamEvent> {
    throw new Error('stream not used in these tests');
  }
  async listModels(): Promise<string[]> { return ['mock']; }
}

function textResponse(content: string): LLMResponse {
  return { content, tool_calls: [], usage: { input_tokens: 10, output_tokens: 5 }, model: 'mock', finish_reason: 'stop' };
}

function makeLLM(provider: LLMProvider): LLMManager {
  const llm = new LLMManager();
  llm.registerProvider(provider);
  llm.setTierMap({
    conversation: { provider: provider.name },
    low: { provider: provider.name },
    medium: { provider: provider.name },
    high: { provider: provider.name },
  });
  return llm;
}

describe('ManagerAgent end-to-end: simple website creation', () => {
  beforeEach(() => {
    initDatabase(':memory:');
  });

  it('plans a 3-subtask website project, runs the dependency graph, and completes it', async () => {
    // Planner's single LLM call (template 'plan', tier 'high') returns a JSON
    // plan: research -> (design + copy, both depending on research) -> the
    // Planner enforces depends_on can only reference earlier indices.
    // Deliberately avoids template: 'code' here - SelfHealingRunner defaults
    // qaCheck to true for 'code' subtasks (self-healing.ts), which would run
    // QAAgent's REAL tsc/bun test suite against this repo (minutes, real
    // subprocesses) since ManagerAgent doesn't expose a way to scope
    // QAAgent's cwd per-subtask. QAAgent itself is covered end to end in
    // qa.e2e.test.ts; this file's focus is the Planner/Router/Dispatcher/
    // Handoff wiring, so 'general' stands in for the design subtask.
    const plannerResponse = textResponse(JSON.stringify([
      { title: 'Research the target audience and competitors', template: 'research', priority: 'normal', depends_on: [] },
      { title: 'Design the site structure and write the HTML/CSS', template: 'general', priority: 'high', depends_on: [0] },
      { title: 'Write the homepage copy', template: 'write', priority: 'normal', depends_on: [0] },
    ]));

    const provider = new MockProvider([plannerResponse]);
    const llm = makeLLM(provider);
    const router = new AIRouter(llm);
    const registry = new TaskRegistry({ db: () => getDb() });

    // Fake runner: simulates the orchestrator's tool loop by just producing
    // a plausible completion per subtask template - the point of this test
    // is to exercise ManagerAgent/Planner/TaskDispatcher wiring and the
    // dependency-graph scheduler, not the full agent tool loop (already
    // covered by conv-orchestrator.test.ts / task-dispatcher tests).
    const runner: TaskRunner = async ({ template, intent }) => ({
      kind: 'completed',
      text: `[${template}] done: ${intent}`,
      conversation: [],
    });
    const dispatcher = new TaskDispatcher(llm, registry, runner);
    const manager = new ManagerAgent(router, dispatcher);

    const result = await manager.handleRequest('Demo Website', 'Build a simple marketing website for a coffee shop.');

    expect(result.project.name).toBe('Demo Website');
    expect(result.outcomes).toHaveLength(3);
    expect(result.outcomes.every((o) => o.status === 'COMPLETED')).toBe(true);

    // Dependency ordering: subtasks 1 and 2 (design, copy) must not be
    // marked settled before subtask 0 (research) - verified indirectly by
    // both depending subtasks actually resolving to COMPLETED at all, since
    // ManagerAgent's runPlan() would have cancelled them had research failed.
    const research = result.outcomes.find((o) => o.index === 0)!;
    const design = result.outcomes.find((o) => o.index === 1)!;
    const copy = result.outcomes.find((o) => o.index === 2)!;
    expect(research.status).toBe('COMPLETED');
    expect(design.status).toBe('COMPLETED');
    expect(copy.status).toBe('COMPLETED');

    // Project-scoped task rows exist for all three subtasks with dependencies wired.
    const tasks = getProjectTasks(result.project.id);
    expect(tasks).toHaveLength(3);
    const designTask = tasks.find((t) => t.title === 'Design the site structure and write the HTML/CSS')!;
    expect(designTask.dependencies).toContain(research.task_id);

    // Each subtask hands off back to the manager.
    for (const outcome of result.outcomes) {
      const handoffs = getHandoffsForTask(outcome.task_id);
      expect(handoffs.length).toBeGreaterThan(0);
      expect(handoffs[0]!.status).toBe('completed');
    }
  });

  it('falls back to a single general subtask when the planner LLM returns unparseable output, and still completes the project', async () => {
    const provider = new MockProvider([textResponse('not valid json, the model ignored instructions')]);
    const llm = makeLLM(provider);
    const router = new AIRouter(llm);
    const registry = new TaskRegistry({ db: () => getDb() });
    const runner: TaskRunner = async ({ originalMessage }) => ({ kind: 'completed', text: `done: ${originalMessage}`, conversation: [] });
    const dispatcher = new TaskDispatcher(llm, registry, runner);
    const manager = new ManagerAgent(router, dispatcher);

    const result = await manager.handleRequest('Fallback Project', 'Build something.');

    expect(result.outcomes).toHaveLength(1);
    expect(result.outcomes[0]!.status).toBe('COMPLETED');
  });

  it('cascades cancellation to dependents when a subtask fails', async () => {
    const plannerResponse = textResponse(JSON.stringify([
      { title: 'Set up the project scaffold', template: 'code', priority: 'high', depends_on: [] },
      { title: 'Build the checkout flow on top of the scaffold', template: 'code', priority: 'high', depends_on: [0] },
    ]));
    const provider = new MockProvider([plannerResponse]);
    const llm = makeLLM(provider);
    const router = new AIRouter(llm);
    const registry = new TaskRegistry({ db: () => getDb() });

    // Every dispatched task fails with a non-retryable auth error so
    // SelfHealingRunner exhausts immediately (no retry loop to wait out).
    const runner: TaskRunner = async () => {
      throw new Error('401 unauthorized: invalid_api_key');
    };
    const dispatcher = new TaskDispatcher(llm, registry, runner);
    const manager = new ManagerAgent(router, dispatcher);

    const result = await manager.handleRequest('Checkout Project', 'Build a checkout flow.');

    const scaffold = result.outcomes.find((o) => o.index === 0)!;
    const checkout = result.outcomes.find((o) => o.index === 1)!;
    expect(scaffold.status).toBe('FAILED');
    expect(checkout.status).toBe('CANCELLED');
    expect(checkout.summary).toContain('dependency failed');
  });
});
