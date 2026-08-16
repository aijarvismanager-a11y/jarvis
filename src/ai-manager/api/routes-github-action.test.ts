/**
 * Route-level round-trip test for POST /api/ai-manager/github/action
 * (Phase 16-C). Confirms the dashboard-triggered path goes through the same
 * AuthorityEngine.checkAuthority + AuditTrail.log() sequence an
 * agent-initiated tool call would (src/agents/orchestrator.ts's
 * executeTool), rather than bypassing the gate.
 */
import { beforeEach, describe, expect, it } from 'bun:test';
import { createAIManagerRoutes, type AIManagerApiContext } from './routes.ts';
import { initDatabase, getDb } from '../../vault/schema.ts';
import { AuthorityEngine, type AuthorityConfig } from '../../authority/engine.ts';
import { AuditTrail } from '../../authority/audit.ts';
import { ApprovalManager } from '../../authority/approval.ts';

type Handler = (req: Request) => Response | Promise<Response>;

function baseConfig(): AuthorityConfig {
  return {
    default_level: 1,
    governed_categories: [],
    overrides: [],
    context_rules: [],
    learning: { enabled: false, suggest_threshold: 5 },
    emergency_state: 'normal',
  };
}

function makeCtx(config: AuthorityConfig): AIManagerApiContext {
  const authorityEngine = new AuthorityEngine(config);
  const auditTrail = new AuditTrail();
  return {
    getLLMManager: () => { throw new Error('not needed for this test'); },
    getTaskDispatcher: () => null,
    getApprovalManager: () => new ApprovalManager(),
    getAuthorityEngine: () => authorityEngine,
    getAuditTrail: () => auditTrail,
  };
}

function postAction(ctx: AIManagerApiContext, body: unknown) {
  const routes = createAIManagerRoutes(ctx);
  const route = routes['/api/ai-manager/github/action'] as { POST: Handler };
  return route.POST(
    new Request('http://x/api/ai-manager/github/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

describe('POST /api/ai-manager/github/action', () => {
  beforeEach(() => {
    initDatabase(':memory:');
  });

  it('rejects an unknown tool with 400', async () => {
    const res = await postAction(makeCtx(baseConfig()), { tool: 'github_delete_everything', repo_path: '.' });
    expect(res.status).toBe(400);
  });

  it('requires repo_path', async () => {
    const res = await postAction(makeCtx(baseConfig()), { tool: 'github_create_issue', title: 'x' });
    expect(res.status).toBe(400);
  });

  it('requires title for github_create_issue', async () => {
    const res = await postAction(makeCtx(baseConfig()), { tool: 'github_create_issue', repo_path: '.' });
    expect(res.status).toBe(400);
  });

  it('requires head/base for github_create_pr', async () => {
    const res = await postAction(makeCtx(baseConfig()), { tool: 'github_create_pr', repo_path: '.', title: 'x' });
    expect(res.status).toBe(400);
  });

  it('requires number for github_pr_status', async () => {
    const res = await postAction(makeCtx(baseConfig()), { tool: 'github_pr_status', repo_path: '.' });
    expect(res.status).toBe(400);
  });

  it('requires a valid event for github_pr_review', async () => {
    const res = await postAction(makeCtx(baseConfig()), { tool: 'github_pr_review', repo_path: '.', number: 1, event: 'YOLO' });
    expect(res.status).toBe(400);
  });

  it('runs the tool and logs an allowed audit entry when authority permits (no GitHub token configured in the test env, so the tool itself returns a plain error string rather than throwing)', async () => {
    const ctx = makeCtx(baseConfig());
    const res = await postAction(ctx, { tool: 'github_create_issue', repo_path: '.', title: 'Bug report' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: string };
    expect(body.result).toContain('Issue creation failed');

    const rows = getDb().prepare('SELECT authority_decision, executed, tool_name FROM audit_trail').all() as Array<{
      authority_decision: string;
      executed: number;
      tool_name: string;
    }>;
    expect(rows.length).toBe(1);
    expect(rows[0]!.tool_name).toBe('github_create_issue');
    expect(rows[0]!.authority_decision).toBe('allowed');
    expect(rows[0]!.executed).toBe(1);
  });

  it('denies the action and does not execute when a context rule blocks it', async () => {
    const config = baseConfig();
    config.context_rules = [
      {
        id: 'no-issues-in-tests',
        action: 'git_operation',
        condition: 'tool_name',
        params: { tool_name: 'github_create_issue' },
        effect: 'deny',
        description: 'Blocked for this test.',
      },
    ];
    const ctx = makeCtx(config);
    const res = await postAction(ctx, { tool: 'github_create_issue', repo_path: '.', title: 'Bug report' });
    expect(res.status).toBe(403);

    const rows = getDb().prepare('SELECT authority_decision, executed FROM audit_trail').all() as Array<{
      authority_decision: string;
      executed: number;
    }>;
    expect(rows.length).toBe(1);
    expect(rows[0]!.authority_decision).toBe('denied');
    expect(rows[0]!.executed).toBe(0);
  });

  it('files a pending (deferred) approval request instead of executing when a context rule requires approval', async () => {
    const config = baseConfig();
    config.context_rules = [
      {
        id: 'issues-need-approval',
        action: 'git_operation',
        condition: 'tool_name',
        params: { tool_name: 'github_create_issue' },
        effect: 'require_approval',
        description: 'Needs approval for this test.',
      },
    ];
    const ctx = makeCtx(config);
    const res = await postAction(ctx, { tool: 'github_create_issue', repo_path: '.', title: 'Bug report' });
    expect(res.status).toBe(202);
    const body = (await res.json()) as { status: string; approval_id: string };
    expect(body.status).toBe('pending_approval');
    expect(body.approval_id).toBeTruthy();

    const rows = getDb().prepare('SELECT authority_decision, executed, approval_id FROM audit_trail').all() as Array<{
      authority_decision: string;
      executed: number;
      approval_id: string | null;
    }>;
    expect(rows.length).toBe(1);
    expect(rows[0]!.authority_decision).toBe('approval_required');
    expect(rows[0]!.executed).toBe(0);
    expect(rows[0]!.approval_id).toBe(body.approval_id);

    const approvalRow = ctx.getApprovalManager().getRequest(body.approval_id);
    expect(approvalRow).not.toBeNull();
    expect(approvalRow!.status).toBe('pending');
    expect(approvalRow!.execution_mode).toBe('deferred');
    expect(approvalRow!.tool_name).toBe('github_create_issue');
    expect(JSON.parse(approvalRow!.tool_arguments)).toMatchObject({ repo_path: '.', title: 'Bug report' });
  });
});
