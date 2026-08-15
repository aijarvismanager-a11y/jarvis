/**
 * Phase 10 demo scenario 2: "code review" - exercises QAAgent's deterministic
 * checklist end to end against a real scratch directory (no LLM/API key
 * needed - QAAgent is intentionally not LLM-driven, see qa.ts), and its
 * integration into SelfHealingRunner's post-completion QA gate, which is how
 * ManagerAgent actually invokes a "review" of a `code` subtask's output
 * before marking it COMPLETED (spec section 36-37).
 */
import { describe, expect, it, beforeEach } from 'bun:test';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initDatabase } from '../vault/schema.ts';
import { LLMManager } from '../llm/manager.ts';
import type { LLMProvider, LLMMessage, LLMOptions, LLMResponse, LLMStreamEvent } from '../llm/provider.ts';
import { TaskRegistry } from '../agents/conv/task-registry.ts';
import { TaskDispatcher, type TaskRunner } from '../agents/conv/task-dispatcher.ts';
import { AIRouter } from './router.ts';
import { QAAgent } from './qa.ts';
import { SelfHealingRunner } from './self-healing.ts';

class MockProvider implements LLMProvider {
  name = 'mock';
  async chat(): Promise<LLMResponse> {
    return { content: 'unused', tool_calls: [], usage: { input_tokens: 0, output_tokens: 0 }, model: 'mock', finish_reason: 'stop' };
  }
  // eslint-disable-next-line require-yield
  async *stream(): AsyncIterable<LLMStreamEvent> { throw new Error('not used'); }
  async listModels(): Promise<string[]> { return ['mock']; }
}

function makeLLM(): LLMManager {
  const llm = new LLMManager();
  const provider = new MockProvider();
  llm.registerProvider(provider);
  llm.setTierMap({ conversation: { provider: 'mock' }, low: { provider: 'mock' }, medium: { provider: 'mock' }, high: { provider: 'mock' } });
  return llm;
}

describe('QAAgent end-to-end: code review checklist', () => {
  let scratchDir: string;

  beforeEach(async () => {
    initDatabase(':memory:');
    scratchDir = await mkdtemp(join(tmpdir(), 'jarvis-qa-e2e-'));
  });

  async function cleanup() {
    await rm(scratchDir, { recursive: true, force: true });
  }

  it('passes a clean project: valid tsconfig, no lint scripts configured, one trivial passing test', async () => {
    await writeFile(join(scratchDir, 'package.json'), JSON.stringify({ name: 'scratch', module: 'index.ts' }));
    await writeFile(join(scratchDir, 'index.ts'), 'export const ok = true;\n');
    await writeFile(join(scratchDir, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, module: 'esnext' }, include: ['index.ts'] }));
    // bun test exits non-zero when zero test files match, so the "clean
    // project" case needs at least one trivially-passing test file - this
    // mirrors any real project QAAgent would review.
    await writeFile(join(scratchDir, 'index.test.ts'), "import { test, expect } from 'bun:test';\ntest('ok', () => { expect(true).toBe(true); });\n");

    const qa = new QAAgent();
    const report = await qa.run({ cwd: scratchDir, lintScripts: [] });

    expect(report.passed).toBe(true);
    const byName = Object.fromEntries(report.checks.map((c) => [c.name, c]));
    expect(byName.typescript!.passed).toBe(true);
    expect(byName.lint!.passed).toBe(true);
    expect(byName.missing_files!.passed).toBe(true);
    expect(byName.configuration_errors!.passed).toBe(true);
    // ui_tests / runtime_errors are honestly reported as not automated, per qa.ts's design.
    expect(byName.ui_tests!.automated).toBe(false);
    expect(byName.runtime_errors!.automated).toBe(false);

    await cleanup();
  });

  it('fails typescript and configuration_errors checks on a broken project', async () => {
    await writeFile(join(scratchDir, 'package.json'), '{ not valid json');
    await writeFile(join(scratchDir, 'index.ts'), 'export const broken: string = 42;\n');
    await writeFile(join(scratchDir, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true }, include: ['index.ts'] }));

    const qa = new QAAgent();
    const report = await qa.run({ cwd: scratchDir, lintScripts: [] });

    expect(report.passed).toBe(false);
    const byName = Object.fromEntries(report.checks.map((c) => [c.name, c]));
    expect(byName.typescript!.passed).toBe(false);
    expect(byName.configuration_errors!.passed).toBe(false);

    await cleanup();
  });

  it('reports missing declared entry points', async () => {
    await writeFile(join(scratchDir, 'package.json'), JSON.stringify({ name: 'scratch', main: 'dist/missing.js' }));
    await writeFile(join(scratchDir, 'tsconfig.json'), JSON.stringify({ compilerOptions: {} }));

    const qa = new QAAgent();
    const report = await qa.run({ cwd: scratchDir, lintScripts: [] });

    const missing = report.checks.find((c) => c.name === 'missing_files')!;
    expect(missing.passed).toBe(false);
    expect(missing.summary).toContain('dist/missing.js');

    await cleanup();
  });

  it('flags a broken relative link in markdown docs', async () => {
    await writeFile(join(scratchDir, 'package.json'), JSON.stringify({ name: 'scratch' }));
    await writeFile(join(scratchDir, 'tsconfig.json'), JSON.stringify({ compilerOptions: {} }));
    await writeFile(join(scratchDir, 'README.md'), 'See [the guide](./docs/guide.md) for details.\n');

    const qa = new QAAgent();
    const report = await qa.run({ cwd: scratchDir, lintScripts: [] });

    const links = report.checks.find((c) => c.name === 'broken_links')!;
    expect(links.passed).toBe(false);
    expect(links.detail).toContain('guide.md');

    await cleanup();
  });

  it('gates SelfHealingRunner: a code subtask that completes but fails QA is reported as failed, exhausted, with a qa_failed decision', async () => {
    await writeFile(join(scratchDir, 'package.json'), '{ not valid json');
    await writeFile(join(scratchDir, 'tsconfig.json'), JSON.stringify({ compilerOptions: {} }));

    const llm = makeLLM();
    const router = new AIRouter(llm);
    const registry = new TaskRegistry();
    const runner: TaskRunner = async () => ({ kind: 'completed', text: 'Wrote the code.', conversation: [] });
    const dispatcher = new TaskDispatcher(llm, registry, runner);
    const healer = new SelfHealingRunner(router, dispatcher, new QAAgent(), 3);

    const result = await healer.run({
      template: 'code',
      mode: 'quality',
      intent: 'Implement the feature',
      original_message: 'Implement the feature.',
      qaCheck: true,
      qaOptions: { cwd: scratchDir, lintScripts: [] },
    });

    expect(result.envelope.status).toBe('failed');
    expect(result.envelope.error).toBe('qa_failed');
    expect(result.exhausted).toBe(true);
    expect(result.qa_report).not.toBeNull();
    expect(result.qa_report!.passed).toBe(false);
    // Dispatch itself only ran once - QA gating happens after a completed dispatch, not as a dispatch retry.
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0]!.envelope.status).toBe('completed');

    await cleanup();
  });
});
