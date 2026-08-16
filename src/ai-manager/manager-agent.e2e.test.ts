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
import { getProjectTasks, getProjectTaskFields } from '../vault/project-tasks.ts';
import { getHandoffsForTask } from '../agents/handoff.ts';
import { ApprovalManager } from '../authority/approval.ts';

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
    const manager = new ManagerAgent(router, dispatcher, new ApprovalManager());

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

  it('Phase 33: fires the onHandoff callback once per filed Handoff, with the message id and project id', async () => {
    const plannerResponse = textResponse(JSON.stringify([
      { title: 'Research the target audience and competitors', template: 'research', priority: 'normal', depends_on: [] },
    ]));
    const provider = new MockProvider([plannerResponse]);
    const llm = makeLLM(provider);
    const router = new AIRouter(llm);
    const registry = new TaskRegistry({ db: () => getDb() });
    const runner: TaskRunner = async ({ template, intent }) => ({
      kind: 'completed',
      text: `[${template}] done: ${intent}`,
      conversation: [],
    });
    const dispatcher = new TaskDispatcher(llm, registry, runner);

    const seen: Array<{ handoff: Parameters<NonNullable<ConstructorParameters<typeof ManagerAgent>[4]>>[0]; messageId: string; projectId?: string }> = [];
    const manager = new ManagerAgent(router, dispatcher, new ApprovalManager(), 3, (handoff, messageId, projectId) => {
      seen.push({ handoff, messageId, projectId });
    });

    const result = await manager.handleRequest('Demo Website', 'Research the market.');

    expect(seen).toHaveLength(1);
    expect(seen[0]!.handoff.status).toBe('completed');
    expect(seen[0]!.handoff.to_agent).toBe('manager');
    expect(seen[0]!.projectId).toBe(result.project.id);
    // The pushed message id round-trips to the real persisted row.
    const handoffs = getHandoffsForTask(result.outcomes[0]!.task_id);
    expect(handoffs).toHaveLength(1);
    expect(typeof seen[0]!.messageId).toBe('string');
    expect(seen[0]!.messageId.length).toBeGreaterThan(0);
  });

  it('falls back to a single general subtask when the planner LLM returns unparseable output, and still completes the project', async () => {
    const provider = new MockProvider([textResponse('not valid json, the model ignored instructions')]);
    const llm = makeLLM(provider);
    const router = new AIRouter(llm);
    const registry = new TaskRegistry({ db: () => getDb() });
    const runner: TaskRunner = async ({ originalMessage }) => ({ kind: 'completed', text: `done: ${originalMessage}`, conversation: [] });
    const dispatcher = new TaskDispatcher(llm, registry, runner);
    const manager = new ManagerAgent(router, dispatcher, new ApprovalManager());

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
    const manager = new ManagerAgent(router, dispatcher, new ApprovalManager());

    // execution_mode: 'auto' - this test is about failure cascading, not
    // Phase 11-C's approval gating (which defaults to 'assisted' and would
    // gate these 'code' subtasks, hanging the test on an unresolved approval).
    const result = await manager.handleRequest('Checkout Project', 'Build a checkout flow.', { execution_mode: 'auto' });

    const scaffold = result.outcomes.find((o) => o.index === 0)!;
    const checkout = result.outcomes.find((o) => o.index === 1)!;
    expect(scaffold.status).toBe('FAILED');
    expect(checkout.status).toBe('CANCELLED');
    expect(checkout.summary).toContain('dependency failed');
  });

  it('Phase 11-A: resumes a WAITING subtask via resumeSubtask(), then continues its blocked dependent', async () => {
    const plannerResponse = textResponse(JSON.stringify([
      { title: 'Step A', template: 'general', priority: 'normal', depends_on: [] },
      { title: 'Step B', template: 'general', priority: 'normal', depends_on: [0] },
    ]));
    const provider = new MockProvider([plannerResponse]);
    const llm = makeLLM(provider);
    const router = new AIRouter(llm);
    const registry = new TaskRegistry({ db: () => getDb() });

    let stepACalls = 0;
    const runner: TaskRunner = async ({ intent }) => {
      if (intent === 'Step A') {
        stepACalls++;
        if (stepACalls === 1) {
          return {
            kind: 'paused',
            question: 'Which environment - staging or prod?',
            conversation: [{ role: 'user', content: 'do step A' } as never],
          };
        }
        return { kind: 'completed', text: 'Step A done after clarification.', conversation: [] };
      }
      return { kind: 'completed', text: `${intent} done`, conversation: [] };
    };
    const dispatcher = new TaskDispatcher(llm, registry, runner);
    const manager = new ManagerAgent(router, dispatcher, new ApprovalManager());

    const first = await manager.handleRequest('Resumable Project', 'Do step A then step B.', { execution_mode: 'auto' });

    // The graph stalls with only Step A settled (WAITING) - Step B never
    // even got a task row, since it was still blocked when handleRequest
    // returned (see manager-agent.ts's "blockedByWaiting" break).
    expect(first.outcomes).toHaveLength(1);
    expect(first.outcomes[0]!.status).toBe('WAITING');
    const waitingTaskId = first.outcomes[0]!.task_id;
    expect(getProjectTaskFields(waitingTaskId)!.project_status).toBe('WAITING');

    const resumed = await manager.resumeSubtask(first.project.id, waitingTaskId, 'staging');

    const stepA = resumed.outcomes.find((o) => o.index === 0)!;
    const stepB = resumed.outcomes.find((o) => o.index === 1)!;
    expect(stepA.status).toBe('COMPLETED');
    expect(stepB.status).toBe('COMPLETED');
    expect(getProjectTaskFields(waitingTaskId)!.project_status).toBe('COMPLETED');

    // Step B's task row now exists and correctly depends on Step A's task id.
    const tasks = getProjectTasks(resumed.project.id);
    const stepBTask = tasks.find((t) => t.title === 'Step B')!;
    expect(stepBTask.dependencies).toContain(waitingTaskId);
  });

  it('Phase 15-C: persists healing_attempts for a subtask that fails once then succeeds', async () => {
    const provider = new MockProvider([textResponse('not valid json, single fallback subtask')]);
    const llm = makeLLM(provider);
    const router = new AIRouter(llm);
    const registry = new TaskRegistry({ db: () => getDb() });

    let calls = 0;
    const runner: TaskRunner = async ({ intent }) => {
      calls++;
      if (calls === 1) throw new Error('429 rate limit exceeded');
      return { kind: 'completed', text: `${intent} done`, conversation: [] };
    };
    const dispatcher = new TaskDispatcher(llm, registry, runner);
    const manager = new ManagerAgent(router, dispatcher, new ApprovalManager());

    const result = await manager.handleRequest('Flaky Project', 'Do a thing.', { execution_mode: 'auto' });

    expect(result.outcomes).toHaveLength(1);
    expect(result.outcomes[0]!.status).toBe('COMPLETED');

    const fields = getProjectTaskFields(result.outcomes[0]!.task_id)!;
    expect(fields.retry_count).toBe(1);
    expect(fields.healing_attempts).toHaveLength(2);
    expect(fields.healing_attempts[0]).toMatchObject({ attempt: 1, strategy: 'initial', failure_class: 'transient' });
    expect(fields.healing_attempts[1]).toMatchObject({ attempt: 2, strategy: 'retry', failure_class: 'none' });

    // The superseded first-attempt task row is project-scoped and linked to
    // the winning task, per manager-agent.ts's runSubtask.
    const tasks = getProjectTasks(result.project.id);
    const superseded = tasks.find((t) => t.project_status === 'CANCELLED' && t.parent_task_id === result.outcomes[0]!.task_id);
    expect(superseded).toBeDefined();
  });

  it('resumeSubtask rejects a task that is not currently WAITING', async () => {
    const provider = new MockProvider([textResponse('not valid json')]);
    const llm = makeLLM(provider);
    const router = new AIRouter(llm);
    const registry = new TaskRegistry({ db: () => getDb() });
    const runner: TaskRunner = async () => ({ kind: 'completed', text: 'done', conversation: [] });
    const dispatcher = new TaskDispatcher(llm, registry, runner);
    const manager = new ManagerAgent(router, dispatcher, new ApprovalManager());

    const result = await manager.handleRequest('Already Done', 'Do a thing.', { execution_mode: 'auto' });
    expect(result.outcomes[0]!.status).toBe('COMPLETED');

    await expect(manager.resumeSubtask(result.project.id, result.outcomes[0]!.task_id, 'irrelevant')).rejects.toThrow(
      /not waiting for input/,
    );
  });
});

describe('ManagerAgent execution_mode gating (Phase 11-C)', () => {
  beforeEach(() => {
    initDatabase(':memory:');
  });

  it("'manual' mode gates every subtask: approval runs it, denial cancels it", async () => {
    const plannerResponse = textResponse(JSON.stringify([
      { title: 'Write the README', template: 'write', priority: 'normal', depends_on: [] },
      { title: 'Draft the changelog', template: 'write', priority: 'normal', depends_on: [] },
    ]));
    const provider = new MockProvider([plannerResponse]);
    const llm = makeLLM(provider);
    const router = new AIRouter(llm);
    const registry = new TaskRegistry({ db: () => getDb() });
    const runner: TaskRunner = async ({ intent }) => ({ kind: 'completed', text: `${intent} done`, conversation: [] });
    const dispatcher = new TaskDispatcher(llm, registry, runner);
    const approvals = new ApprovalManager();
    const manager = new ManagerAgent(router, dispatcher, approvals);

    // Both subtasks land pending-approval requests in the same wave (they
    // run in parallel via Promise.all) - approve one, deny the other, then
    // let handleRequest's await resolve once both are decided.
    const handled = manager.handleRequest('Docs Project', 'Write docs.', { execution_mode: 'manual' });

    let pending = approvals.getPending();
    while (pending.length < 2) {
      await new Promise((r) => setTimeout(r, 5));
      pending = approvals.getPending();
    }
    const readme = pending.find((r) => (JSON.parse(r.tool_arguments) as { title: string }).title === 'Write the README')!;
    const changelog = pending.find((r) => (JSON.parse(r.tool_arguments) as { title: string }).title === 'Draft the changelog')!;
    approvals.approve(readme.id, 'test-user');
    approvals.deny(changelog.id, 'test-user');

    const result = await handled;
    const readmeOutcome = result.outcomes.find((o) => o.title === 'Write the README')!;
    const changelogOutcome = result.outcomes.find((o) => o.title === 'Draft the changelog')!;
    expect(readmeOutcome.status).toBe('COMPLETED');
    expect(changelogOutcome.status).toBe('CANCELLED');
    expect(changelogOutcome.summary).toContain('not approved');
  });

  it("'assisted' mode gates only risk-bearing templates ('code'), leaving 'write' ungated", async () => {
    const plannerResponse = textResponse(JSON.stringify([
      { title: 'Implement the parser', template: 'code', priority: 'normal', depends_on: [] },
      { title: 'Write the release notes', template: 'write', priority: 'normal', depends_on: [] },
    ]));
    const provider = new MockProvider([plannerResponse]);
    const llm = makeLLM(provider);
    const router = new AIRouter(llm);
    const registry = new TaskRegistry({ db: () => getDb() });
    const runner: TaskRunner = async ({ intent }) => ({ kind: 'completed', text: `${intent} done`, conversation: [] });
    const dispatcher = new TaskDispatcher(llm, registry, runner);
    const approvals = new ApprovalManager();
    const manager = new ManagerAgent(router, dispatcher, approvals);

    const handled = manager.handleRequest('Mixed Project', 'Ship it.', { execution_mode: 'assisted' });

    let pending = approvals.getPending();
    while (pending.length < 1) {
      await new Promise((r) => setTimeout(r, 5));
      pending = approvals.getPending();
    }
    // Only the 'code' subtask should ever request approval - if 'write' also
    // gated, a second pending request would show up here too. Deny it rather
    // than approve: approving would let it reach SelfHealingRunner's default
    // QA gate for 'code' subtasks (self-healing.ts), which runs this repo's
    // REAL tsc/bun test - already covered end to end by qa.e2e.test.ts and
    // far too slow for this gating-focused test.
    expect(pending).toHaveLength(1);
    expect((JSON.parse(pending[0]!.tool_arguments) as { title: string }).title).toBe('Implement the parser');
    approvals.deny(pending[0]!.id, 'test-user');

    const result = await handled;
    const parser = result.outcomes.find((o) => o.title === 'Implement the parser')!;
    const notes = result.outcomes.find((o) => o.title === 'Write the release notes')!;
    expect(parser.status).toBe('CANCELLED');
    // 'write' never generated an approval request at all, so it ran normally.
    expect(notes.status).toBe('COMPLETED');
  });
});

describe('ManagerAgent project-scoped memory (Phase 13-A)', () => {
  beforeEach(() => {
    initDatabase(':memory:');
  });

  it('forwards project.id to the task runner as TaskRequest.project_id for every dispatched subtask', async () => {
    const plannerResponse = textResponse(JSON.stringify([
      { title: 'Draft the announcement', template: 'write', priority: 'normal', depends_on: [] },
    ]));
    const provider = new MockProvider([plannerResponse]);
    const llm = makeLLM(provider);
    const router = new AIRouter(llm);
    const registry = new TaskRegistry({ db: () => getDb() });

    const seenProjectIds: (string | undefined)[] = [];
    const runner: TaskRunner = async ({ intent, project_id }) => {
      seenProjectIds.push(project_id);
      return { kind: 'completed', text: `${intent} done`, conversation: [] };
    };
    const dispatcher = new TaskDispatcher(llm, registry, runner);
    const manager = new ManagerAgent(router, dispatcher, new ApprovalManager());

    const result = await manager.handleRequest('Launch Announcement', 'Announce the launch.');

    expect(seenProjectIds).toHaveLength(1);
    expect(seenProjectIds[0]).toBe(result.project.id);
  });
});
