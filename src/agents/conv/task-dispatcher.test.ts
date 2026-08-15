/**
 * Unit tests for task-dispatcher.ts's own dispatch-time paths that aren't
 * already covered by resume-task.test.ts (pause/resume) or
 * conv-orchestrator.test.ts (the delegate-tool happy path): a runner that
 * throws, cancellation before the runner ever starts, and the long-output
 * summarization path (both the condensing call and its fallback).
 */
import { describe, expect, it, beforeEach } from 'bun:test';
import { LLMManager } from '../../llm/manager.ts';
import type { LLMProvider, LLMMessage, LLMOptions, LLMResponse, LLMStreamEvent } from '../../llm/provider.ts';
import { TaskRegistry } from './task-registry.ts';
import { TaskDispatcher, type TaskRunner } from './task-dispatcher.ts';

class StubLLM implements LLMProvider {
  name = 'stub';
  constructor(private response: LLMResponse | (() => LLMResponse) = { content: 'condensed', tool_calls: [], usage: { input_tokens: 1, output_tokens: 1 }, model: 'stub', finish_reason: 'stop' }) {}
  async chat(): Promise<LLMResponse> {
    if (typeof this.response === 'function') return this.response();
    return this.response;
  }
  // eslint-disable-next-line require-yield
  async *stream(): AsyncIterable<LLMStreamEvent> { throw new Error('not used'); }
  async listModels(): Promise<string[]> { return ['stub']; }
}

function makeManager(provider: LLMProvider = new StubLLM()): LLMManager {
  const m = new LLMManager();
  m.registerProvider(provider);
  m.setTierMap({ low: { provider: provider.name }, medium: { provider: provider.name } });
  return m;
}

describe('TaskDispatcher.dispatch', () => {
  let registry: TaskRegistry;

  beforeEach(() => {
    registry = new TaskRegistry();
  });

  it('a runner that throws produces a failed envelope with the error message truncated to 200 chars', async () => {
    const longError = 'x'.repeat(500);
    const runner: TaskRunner = async () => {
      throw new Error(longError);
    };
    const dispatcher = new TaskDispatcher(makeManager(), registry, runner);

    const env = await dispatcher.dispatch({ tier: 'medium', template: 'general', intent: 'do a thing' });

    expect(env.status).toBe('failed');
    expect(env.error).toBe(longError);
    expect(env.summary).toContain('Task failed:');
    expect(env.summary.length).toBeLessThanOrEqual('Task failed: '.length + 200);

    const rec = registry.get(env.task_id)!;
    expect(rec.status).toBe('failed');
  });

  it('a runner that throws a non-Error value still produces a failed envelope (String() fallback)', async () => {
    const runner: TaskRunner = async () => {
      // eslint-disable-next-line @typescript-eslint/no-throw-literal
      throw 'plain string rejection';
    };
    const dispatcher = new TaskDispatcher(makeManager(), registry, runner);

    const env = await dispatcher.dispatch({ tier: 'medium', template: 'general', intent: 'do a thing' });
    expect(env.status).toBe('failed');
    expect(env.error).toBe('plain string rejection');
  });

  it('marks the task cancelled when the abort signal fired while the runner was in flight, even though the runner resolved normally', async () => {
    // TaskDispatcher only distinguishes "cancelled" from "completed" by
    // checking abort.signal.aborted AFTER the runner resolves (see
    // runAndHandle in task-dispatcher.ts) - a runner is expected to notice
    // the signal and wind down, but its return value doesn't itself carry
    // cancellation; the dispatcher re-checks the signal once the runner
    // returns, regardless of what it returned.
    let runnerCalled = false;
    const runner: TaskRunner = async ({ signal }) => {
      runnerCalled = true;
      await new Promise((resolve) => signal.addEventListener('abort', () => resolve(undefined)));
      return { kind: 'completed', text: 'work done just before abort was noticed', conversation: [] };
    };
    const dispatcher = new TaskDispatcher(makeManager(), registry, runner);

    const dispatchPromise = dispatcher.dispatch({ tier: 'medium', template: 'general', intent: 'X' });
    // The registry assigns the abort controller synchronously inside
    // dispatch() before awaiting the runner, so by the time dispatch()'s
    // promise is pending we can already look the task up and abort it.
    const [record] = registry.inFlight();
    expect(record).toBeDefined();
    registry.abort(record!.id);

    const env = await dispatchPromise;
    expect(runnerCalled).toBe(true);
    expect(env.status).toBe('cancelled');
    expect(env.summary).toContain('cancelled during execution');
  });

  it('short output passes through summarize() verbatim without an LLM call', async () => {
    const provider = new StubLLM(() => {
      throw new Error('summarize should not have been called for short output');
    });
    const runner: TaskRunner = async () => ({ kind: 'completed', text: 'Short result.', conversation: [] });
    const dispatcher = new TaskDispatcher(makeManager(provider), registry, runner);

    const env = await dispatcher.dispatch({ tier: 'medium', template: 'general', intent: 'X' });
    expect(env.status).toBe('completed');
    expect(env.summary).toBe('Short result.');
  });

  it('empty output is reported as "Task produced no output."', async () => {
    const runner: TaskRunner = async () => ({ kind: 'completed', text: '   ', conversation: [] });
    const dispatcher = new TaskDispatcher(makeManager(), registry, runner);

    const env = await dispatcher.dispatch({ tier: 'medium', template: 'general', intent: 'X' });
    expect(env.summary).toBe('Task produced no output.');
  });

  it('long output (>3000 chars) is condensed via the low tier LLM call', async () => {
    const longText = 'word '.repeat(1000); // well over 3000 chars
    const provider = new StubLLM({ content: 'Condensed summary of the long result.', tool_calls: [], usage: { input_tokens: 5, output_tokens: 5 }, model: 'stub', finish_reason: 'stop' });
    const runner: TaskRunner = async () => ({ kind: 'completed', text: longText, conversation: [] });
    const dispatcher = new TaskDispatcher(makeManager(provider), registry, runner);

    const env = await dispatcher.dispatch({ tier: 'medium', template: 'general', intent: 'X' });
    expect(env.status).toBe('completed');
    expect(env.summary).toBe('Condensed summary of the long result.');
  });

  it('falls back to a truncated slice when the condensing LLM call itself fails', async () => {
    const longText = 'word '.repeat(1000);
    const provider = new StubLLM(() => {
      throw new Error('condensing provider is down');
    });
    const runner: TaskRunner = async () => ({ kind: 'completed', text: longText, conversation: [] });
    const dispatcher = new TaskDispatcher(makeManager(provider), registry, runner);

    const env = await dispatcher.dispatch({ tier: 'medium', template: 'general', intent: 'X' });
    expect(env.status).toBe('completed');
    expect(env.summary.length).toBeLessThanOrEqual(403); // 400 chars + '...'
    expect(env.summary.endsWith('...')).toBe(true);
  });

  it('templatePromptFor returns a distinct, non-empty prompt per template', () => {
    const templates = ['research', 'code', 'plan', 'write', 'general'] as const;
    const prompts = templates.map((t) => TaskDispatcher.templatePromptFor(t));
    expect(new Set(prompts).size).toBe(templates.length);
    for (const p of prompts) expect(p.length).toBeGreaterThan(0);
  });
});
