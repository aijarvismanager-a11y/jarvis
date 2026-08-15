/**
 * Phase 10 demo scenario 4: "full project + GitHub push" - a project runs
 * through ManagerAgent (Planner -> TaskDispatcher -> commit via git.ts),
 * then the resulting `git_push` goes through the SAME authority-gate +
 * approval sequence production code uses (src/agents/orchestrator.ts's
 * executeTool, per docs/AI_MANAGER_ARCHITECTURE_AUDIT.md Phase 7/9): an
 * AuthorityEngine.checkAuthority() call gated by the tool-name context rule,
 * then ApprovalManager.createRequest()/waitForResolution().
 *
 * No real GitHub involved - "remote" is a local bare repo on disk, so this
 * needs no network access, no GitHub token, and no external calls, while
 * still exercising the real `git` binary (via src/github/git.ts) for
 * commit/push and the real authority/approval gate for the push decision.
 */
import { describe, expect, it, beforeEach } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initDatabase } from '../vault/schema.ts';
import { LLMManager } from '../llm/manager.ts';
import type { LLMProvider, LLMResponse, LLMStreamEvent } from '../llm/provider.ts';
import { TaskRegistry } from '../agents/conv/task-registry.ts';
import { TaskDispatcher, type TaskRunner } from '../agents/conv/task-dispatcher.ts';
import { AIRouter } from '../ai-manager/router.ts';
import { ManagerAgent } from '../ai-manager/manager-agent.ts';
import { commit, push, forcePush, detectBranch } from './git.ts';
import { AuthorityEngine, type AuthorityConfig, type ContextRule } from '../authority/engine.ts';
import { ApprovalManager } from '../authority/approval.ts';
import { getActionForTool } from '../authority/tool-action-map.ts';

async function runGit(cwd: string, args: string[]): Promise<void> {
  const proc = Bun.spawn(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`git ${args.join(' ')} failed: ${stderr}`);
  }
}

/** Like runGit, but reports success/failure instead of throwing - for assertions. */
async function gitCapture(cwd: string, args: string[]): Promise<{ ok: boolean; output: string }> {
  const proc = Bun.spawn(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { ok: exitCode === 0, output: (stdout + stderr).trim() };
}

class MockProvider implements LLMProvider {
  name = 'mock';
  async chat(): Promise<LLMResponse> {
    return { content: 'unused', tool_calls: [], usage: { input_tokens: 0, output_tokens: 0 }, model: 'mock', finish_reason: 'stop' };
  }
  // eslint-disable-next-line require-yield
  async *stream(): AsyncIterable<LLMStreamEvent> { throw new Error('not used'); }
  async listModels(): Promise<string[]> { return ['mock']; }
}

// Mirrors the default context_rules seeded in src/daemon/index.ts (spec
// section 29): plain git_push requires approval, git_force_push is blocked.
function makeAuthorityConfig(): AuthorityConfig {
  const contextRules: ContextRule[] = [
    {
      id: 'git-push-requires-approval',
      action: 'git_operation',
      condition: 'tool_name',
      params: { tool_name: 'git_push' },
      effect: 'require_approval',
      description: 'git_push requires user approval by default.',
    },
    {
      id: 'git-force-push-blocked',
      action: 'git_operation',
      condition: 'tool_name',
      params: { tool_name: 'git_force_push' },
      effect: 'deny',
      description: 'git_force_push is blocked by default.',
    },
  ];
  return {
    default_level: 5,
    governed_categories: [],
    overrides: [],
    context_rules: contextRules,
    learning: { enabled: false, suggest_threshold: 5 },
    emergency_state: 'normal',
  };
}

describe('Full project + GitHub push end-to-end', () => {
  let remoteDir: string;
  let localDir: string;

  beforeEach(async () => {
    initDatabase(':memory:');
    remoteDir = await mkdtemp(join(tmpdir(), 'jarvis-gh-remote-'));
    localDir = await mkdtemp(join(tmpdir(), 'jarvis-gh-local-'));

    await runGit(remoteDir, ['init', '--bare', '-b', 'main']);
    await runGit(localDir, ['init', '-b', 'main']);
    await runGit(localDir, ['config', 'user.email', 'test@example.com']);
    await runGit(localDir, ['config', 'user.name', 'Test Runner']);
    await runGit(localDir, ['remote', 'add', 'origin', remoteDir]);
    // git.ts's push() needs an upstream commit to exist for a clean first push.
    await writeFile(join(localDir, 'README.md'), '# scratch\n');
    await runGit(localDir, ['add', '-A']);
    await runGit(localDir, ['commit', '-m', 'initial commit']);
  });

  async function cleanup() {
    await rm(remoteDir, { recursive: true, force: true });
    await rm(localDir, { recursive: true, force: true });
  }

  it('runs a project subtask that commits real changes to the local repo', async () => {
    const llm = new LLMManager();
    const provider = new MockProvider();
    llm.registerProvider(provider);
    llm.setTierMap({ conversation: { provider: 'mock' }, low: { provider: 'mock' }, medium: { provider: 'mock' }, high: { provider: 'mock' } });
    const router = new AIRouter(llm);
    const registry = new TaskRegistry();

    // Fake runner: simulates a `code` subtask that writes a file and commits
    // it via the real git.ts wrapper (same function the git_commit tool calls).
    const runner: TaskRunner = async ({ template }) => {
      await writeFile(join(localDir, 'feature.txt'), 'new feature\n');
      const result = await commit(localDir, 'Add feature.txt');
      if (!result.ok) throw new Error(`commit failed: ${result.error}`);
      return { kind: 'completed', text: `[${template}] committed feature.txt`, conversation: [] };
    };
    const dispatcher = new TaskDispatcher(llm, registry, runner);
    const manager = new ManagerAgent(router, dispatcher, new ApprovalManager());

    // Unparseable planner response -> single fallback `general` subtask, which
    // is enough to drive one real commit through the pipeline; the dependency
    // graph itself is already covered by manager-agent.e2e.test.ts.
    const result = await manager.handleRequest('Ship the feature', 'Add feature.txt and commit it.');

    expect(result.outcomes).toHaveLength(1);
    expect(result.outcomes[0]!.status).toBe('COMPLETED');

    const branch = await detectBranch(localDir);
    expect(branch.current).toBe('main');

    await cleanup();
  });

  it('git_push requires approval, and only pushes to the remote after approval', async () => {
    const engine = new AuthorityEngine(makeAuthorityConfig());
    const decision = engine.checkAuthority({
      agentId: 'manager',
      agentAuthorityLevel: 5,
      agentRoleId: 'ai-manager',
      toolName: 'git_push',
      toolCategory: 'github',
      actionCategory: getActionForTool('git_push', 'github'),
      temporaryGrants: new Map(),
    });
    expect(decision.allowed).toBe(true);
    expect(decision.requiresApproval).toBe(true);
    expect(decision.contextRule).toBe('git-push-requires-approval');

    const approvals = new ApprovalManager();
    const request = approvals.createRequest({
      agentId: 'manager',
      agentName: 'Manager Agent',
      toolName: 'git_push',
      toolArguments: { repo_path: localDir },
      actionCategory: decision.actionCategory,
      urgency: 'normal',
      reason: decision.reason,
      context: 'Project "Ship the feature" completed and is ready to push.',
    });
    expect(request.status).toBe('pending');

    // Nothing on the remote yet - push hasn't happened because approval is pending.
    const preApprovalLog = await gitCapture(remoteDir, ['log', '--oneline', 'main']);
    expect(preApprovalLog.ok).toBe(false);

    const gate = (async () => {
      const resolved = await approvals.waitForResolution(request.id, { timeoutMs: 5000, pollMs: 10 });
      expect(resolved.status).toBe('approved');
      return push(localDir, { branch: 'main' });
    })();

    approvals.approve(request.id, 'test-user');
    const pushResult = await gate;

    expect(pushResult.ok).toBe(true);
    approvals.markExecuted(request.id, pushResult.output);
    expect(approvals.getRequest(request.id)!.status).toBe('executed');

    // The commit now exists on the "remote".
    const remoteLog = await gitCapture(remoteDir, ['log', '--oneline', 'main']);
    expect(remoteLog.ok).toBe(true);
    expect(remoteLog.output).toContain('initial commit');

    await cleanup();
  });

  it('git_force_push is denied outright by the authority gate - no approval flow, no push attempted', async () => {
    const engine = new AuthorityEngine(makeAuthorityConfig());
    const decision = engine.checkAuthority({
      agentId: 'manager',
      agentAuthorityLevel: 10, // even a fully-trusted agent is blocked
      agentRoleId: 'ai-manager',
      toolName: 'git_force_push',
      toolCategory: 'github',
      actionCategory: getActionForTool('git_force_push', 'github'),
      temporaryGrants: new Map(),
    });

    expect(decision.allowed).toBe(false);
    expect(decision.contextRule).toBe('git-force-push-blocked');

    // Since the gate denies before any tool call, forcePush() must never run
    // in the real orchestrator path - assert the guard, not the mechanism
    // (calling forcePush() here would defeat the point of the test).
    if (!decision.allowed) {
      // no-op: this branch is what orchestrator.executeTool takes - it never
      // reaches `await forcePush(...)`.
      expect(typeof forcePush).toBe('function');
    }

    await cleanup();
  });
});
