/**
 * AI Manager REST API (spec section 47). Mounted alongside the daemon's
 * existing routes (see src/daemon/index.ts, same pattern as
 * createWorkflowRoutes) rather than folded into api-routes.ts directly -
 * keeps this feature's surface independently reviewable, matching how the
 * workflow engine's routes are mounted separately.
 *
 * GET endpoints work in classic mode (no conversation tier configured).
 * POST /projects/:id/run requires a TaskDispatcher, which only exists when
 * llm.tiers.conversation is configured (see AgentService.getTaskDispatcher) -
 * those routes 503 with a clear reason otherwise, rather than silently
 * falling back to a different execution path.
 */

import { AIRouter, ManagerAgent, AICouncil, type CouncilSeat } from '../index.ts';
import type { LLMManager } from '../../llm/manager.ts';
import type { TaskDispatcher } from '../../agents/conv/task-dispatcher.ts';
import type { ApprovalManager } from '../../authority/approval.ts';
import type { AuthorityEngine } from '../../authority/engine.ts';
import type { AuditTrail } from '../../authority/audit.ts';
import { getActionForTool } from '../../authority/tool-action-map.ts';
import {
  githubCreateIssueTool,
  githubCreatePrTool,
  githubPrStatusTool,
  githubReviewTool,
} from '../../actions/tools/github.ts';
import {
  findProjects,
  getProject,
  updateProjectStatus,
  updateProjectExecutionMode,
  updateProjectCostMode,
  setProjectRules,
  type ProjectStatus,
  type ExecutionMode,
  type CostMode,
  type ProjectTemplate,
} from '../../vault/projects.ts';
import { findDecisions, createDecision } from '../../vault/decisions.ts';
import { getProjectTasks, getProjectTaskFields } from '../../vault/project-tasks.ts';
import { getAgentPerformance } from '../../vault/agent-performance.ts';
import { getDb } from '../../vault/schema.ts';

const CORS = { 'Access-Control-Allow-Origin': '*' } as const;

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: CORS });
}

function error(message: string, status = 400): Response {
  return json({ error: message }, status);
}

function errorFromException(err: unknown): Response {
  return error(err instanceof Error ? err.message : String(err), 500);
}

const VALID_PROJECT_STATUSES: readonly ProjectStatus[] = ['active', 'paused', 'completed', 'archived'];
const VALID_EXECUTION_MODES: readonly ExecutionMode[] = ['auto', 'assisted', 'manual'];
const VALID_COST_MODES: readonly CostMode[] = ['cheap', 'balanced', 'quality'];
const VALID_TEMPLATES: readonly ProjectTemplate[] = [
  'website', 'web_app', 'software', 'research', 'content', 'data_project', 'automation', 'custom',
];
const VALID_COUNCIL_MODES = ['cheap', 'balanced', 'quality'] as const;
const VALID_TASK_TEMPLATES = ['research', 'code', 'plan', 'write', 'general'] as const;

export type AIManagerApiContext = {
  getLLMManager: () => LLMManager;
  getTaskDispatcher: () => TaskDispatcher | null;
  getApprovalManager: () => ApprovalManager;
  getAuthorityEngine: () => AuthorityEngine;
  getAuditTrail: () => AuditTrail;
};

// Phase 16-C: a dashboard-triggered GitHub action has no agent identity to
// check authority against, so it's given a synthetic actor with the top
// authority level (10) - a human clicking a button in their own dashboard
// is at least as trusted as any agent role could be. It still goes through
// the same AuthorityEngine.checkAuthority + AuditTrail.log() sequence
// src/agents/orchestrator.ts's executeTool() uses for agent-initiated
// calls (src/authority/engine.ts, src/authority/audit.ts), so the same
// context rules (e.g. a future git-push-style tool_name rule) would still
// apply - it can't bypass a gate the conversational path enforces.
const DASHBOARD_ACTOR_ID = 'dashboard';
const DASHBOARD_ACTOR_NAME = 'Dashboard';
const DASHBOARD_ACTOR_ROLE_ID = 'dashboard';
const DASHBOARD_AUTHORITY_LEVEL = 10;

const GITHUB_ACTION_TOOLS = {
  github_create_issue: githubCreateIssueTool,
  github_create_pr: githubCreatePrTool,
  github_pr_status: githubPrStatusTool,
  github_pr_review: githubReviewTool,
} as const;
type GitHubActionToolName = keyof typeof GITHUB_ACTION_TOOLS;
const VALID_GITHUB_ACTION_TOOLS = Object.keys(GITHUB_ACTION_TOOLS) as GitHubActionToolName[];
const VALID_REVIEW_EVENTS = ['APPROVE', 'REQUEST_CHANGES', 'COMMENT'] as const;

/** All handoffs (structured JSON reports) filed for a project, newest first. */
function listProjectHandoffs(projectId: string, limit: number): unknown[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, from_agent, to_agent, content, priority, created_at, task_id
       FROM agent_messages WHERE project_id = ? AND type = 'report' ORDER BY created_at DESC LIMIT ?`,
    )
    .all(projectId, limit) as Array<{
    id: string;
    from_agent: string;
    to_agent: string;
    content: string;
    priority: string;
    created_at: number;
    task_id: string | null;
  }>;

  return rows.map((row) => {
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(row.content);
    } catch {
      /* non-JSON report message; surface raw content instead */
    }
    return {
      id: row.id,
      from_agent: row.from_agent,
      to_agent: row.to_agent,
      priority: row.priority,
      created_at: row.created_at,
      task_id: row.task_id,
      handoff: parsed,
    };
  });
}

export function createAIManagerRoutes(ctx: AIManagerApiContext): Record<string, unknown> {
  const managerAgentFor = (): ManagerAgent | null => {
    const dispatcher = ctx.getTaskDispatcher();
    if (!dispatcher) return null;
    const router = new AIRouter(ctx.getLLMManager());
    return new ManagerAgent(router, dispatcher, ctx.getApprovalManager());
  };

  return {
    '/api/ai-manager/projects': {
      GET: (req: Request) => {
        const params = new URL(req.url).searchParams;
        const status = params.get('status') as ProjectStatus | null;
        if (status && !VALID_PROJECT_STATUSES.includes(status)) {
          return error(`status must be one of: ${VALID_PROJECT_STATUSES.join(', ')}`, 400);
        }
        return json(findProjects(status ? { status } : undefined));
      },
      // Runs the full Planner -> Router -> Assignment -> Execution -> Handoff
      // pass synchronously and returns once the project's task graph has
      // settled. For a long-running project this blocks the HTTP request
      // for the duration - acceptable for this pass (see manager-agent.ts);
      // a future iteration can move this behind the WebSocket event stream
      // the rest of the dashboard already uses for long operations.
      POST: async (req: Request) => {
        try {
          const body = (await req.json()) as {
            name?: string;
            request?: string;
            template?: ProjectTemplate;
            execution_mode?: ExecutionMode;
            cost_mode?: CostMode;
          };
          if (!body.name || typeof body.name !== 'string') return error('name is required', 400);
          if (!body.request || typeof body.request !== 'string') return error('request is required', 400);
          if (body.template && !VALID_TEMPLATES.includes(body.template)) {
            return error(`template must be one of: ${VALID_TEMPLATES.join(', ')}`, 400);
          }
          if (body.execution_mode && !VALID_EXECUTION_MODES.includes(body.execution_mode)) {
            return error(`execution_mode must be one of: ${VALID_EXECUTION_MODES.join(', ')}`, 400);
          }
          if (body.cost_mode && !VALID_COST_MODES.includes(body.cost_mode)) {
            return error(`cost_mode must be one of: ${VALID_COST_MODES.join(', ')}`, 400);
          }

          const manager = managerAgentFor();
          if (!manager) {
            return error(
              'AI Manager project execution requires llm.tiers.conversation to be configured (TaskDispatcher unavailable in classic mode).',
              503,
            );
          }

          const result = await manager.handleRequest(body.name, body.request, {
            template: body.template,
            execution_mode: body.execution_mode,
            cost_mode: body.cost_mode,
          });
          return json(result, 201);
        } catch (err) {
          return errorFromException(err);
        }
      },
    },

    '/api/ai-manager/projects/:id': {
      GET: (req: Request & { params: { id: string } }) => {
        const project = getProject(req.params.id);
        if (!project) return error('Project not found', 404);
        return json(project);
      },
      PATCH: async (req: Request & { params: { id: string } }) => {
        try {
          const body = (await req.json()) as {
            status?: ProjectStatus;
            execution_mode?: ExecutionMode;
            cost_mode?: CostMode;
            rules?: string[];
          };
          let project = getProject(req.params.id);
          if (!project) return error('Project not found', 404);

          if (body.status) {
            if (!VALID_PROJECT_STATUSES.includes(body.status)) {
              return error(`status must be one of: ${VALID_PROJECT_STATUSES.join(', ')}`, 400);
            }
            project = updateProjectStatus(req.params.id, body.status);
          }
          if (body.execution_mode) {
            if (!VALID_EXECUTION_MODES.includes(body.execution_mode)) {
              return error(`execution_mode must be one of: ${VALID_EXECUTION_MODES.join(', ')}`, 400);
            }
            project = updateProjectExecutionMode(req.params.id, body.execution_mode);
          }
          if (body.cost_mode) {
            if (!VALID_COST_MODES.includes(body.cost_mode)) {
              return error(`cost_mode must be one of: ${VALID_COST_MODES.join(', ')}`, 400);
            }
            project = updateProjectCostMode(req.params.id, body.cost_mode);
          }
          if (body.rules) {
            if (!Array.isArray(body.rules) || !body.rules.every((r) => typeof r === 'string')) {
              return error('rules must be an array of strings', 400);
            }
            project = setProjectRules(req.params.id, body.rules);
          }
          return json(project);
        } catch (err) {
          return errorFromException(err);
        }
      },
    },

    '/api/ai-manager/projects/:id/tasks': {
      // Kanban board data for one project (spec section 25).
      GET: (req: Request & { params: { id: string } }) => {
        if (!getProject(req.params.id)) return error('Project not found', 404);
        return json(getProjectTasks(req.params.id));
      },
    },

    // Phase 11-A: the only way back to running for a subtask that paused on
    // `needs_input` - see src/ai-manager/manager-agent.ts's resumeSubtask().
    '/api/ai-manager/projects/:id/tasks/:taskId/resume': {
      POST: async (req: Request & { params: { id: string; taskId: string } }) => {
        try {
          const project = getProject(req.params.id);
          if (!project) return error('Project not found', 404);
          const task = getProjectTaskFields(req.params.taskId);
          if (!task || task.project_id !== req.params.id) return error('Task not found in this project', 404);

          const body = (await req.json()) as { input?: string };
          if (!body.input || typeof body.input !== 'string') return error('input is required', 400);

          const manager = managerAgentFor();
          if (!manager) {
            return error(
              'AI Manager project execution requires llm.tiers.conversation to be configured (TaskDispatcher unavailable in classic mode).',
              503,
            );
          }

          const result = await manager.resumeSubtask(req.params.id, req.params.taskId, body.input);
          return json(result);
        } catch (err) {
          return errorFromException(err);
        }
      },
    },

    '/api/ai-manager/projects/:id/decisions': {
      GET: (req: Request & { params: { id: string } }) => {
        if (!getProject(req.params.id)) return error('Project not found', 404);
        return json(findDecisions({ project_id: req.params.id }));
      },
      POST: async (req: Request & { params: { id: string } }) => {
        try {
          if (!getProject(req.params.id)) return error('Project not found', 404);
          const body = (await req.json()) as { statement?: string; reason?: string; made_by?: string };
          if (!body.statement || typeof body.statement !== 'string') return error('statement is required', 400);
          const decision = createDecision(body.statement, {
            project_id: req.params.id,
            reason: body.reason,
            made_by: body.made_by,
          });
          return json(decision, 201);
        } catch (err) {
          return errorFromException(err);
        }
      },
    },

    '/api/ai-manager/projects/:id/handoffs': {
      GET: (req: Request & { params: { id: string } }) => {
        if (!getProject(req.params.id)) return error('Project not found', 404);
        const params = new URL(req.url).searchParams;
        const limit = Math.min(Number(params.get('limit')) || 50, 200);
        return json(listProjectHandoffs(req.params.id, limit));
      },
    },

    // Phase 16-C: GitHub issue/PR actions triggerable from the dashboard,
    // rather than only from inside an agent conversation. Wraps the same
    // tool `execute()` functions an agent call would use
    // (src/actions/tools/github.ts), gated through the same authority
    // check + audit log as src/agents/orchestrator.ts's executeTool() -
    // see the DASHBOARD_ACTOR_* comment above for the synthetic actor.
    '/api/ai-manager/github/action': {
      POST: async (req: Request) => {
        try {
          const body = (await req.json()) as {
            tool?: string;
            repo_path?: string;
            title?: string;
            body?: string;
            head?: string;
            base?: string;
            number?: number;
            event?: string;
            /** Phase 18-C: optional - scopes the audit_trail rows this call writes. */
            project_id?: string;
          };
          if (!body.tool || !VALID_GITHUB_ACTION_TOOLS.includes(body.tool as GitHubActionToolName)) {
            return error(`tool must be one of: ${VALID_GITHUB_ACTION_TOOLS.join(', ')}`, 400);
          }
          if (body.project_id !== undefined && !getProject(body.project_id)) {
            return error('Project not found', 404);
          }
          if (!body.repo_path || typeof body.repo_path !== 'string') {
            return error('repo_path is required', 400);
          }
          const toolName = body.tool as GitHubActionToolName;
          const tool = GITHUB_ACTION_TOOLS[toolName];

          if ((toolName === 'github_create_issue' || toolName === 'github_create_pr') && !body.title) {
            return error('title is required', 400);
          }
          if (toolName === 'github_create_pr' && (!body.head || !body.base)) {
            return error('head and base are required', 400);
          }
          if ((toolName === 'github_pr_status' || toolName === 'github_pr_review') && typeof body.number !== 'number') {
            return error('number is required', 400);
          }
          if (toolName === 'github_pr_review') {
            if (!body.event || !VALID_REVIEW_EVENTS.includes(body.event as (typeof VALID_REVIEW_EVENTS)[number])) {
              return error(`event must be one of: ${VALID_REVIEW_EVENTS.join(', ')}`, 400);
            }
          }

          const actionCategory = getActionForTool(toolName, tool.category);
          const decision = ctx.getAuthorityEngine().checkAuthority({
            agentId: DASHBOARD_ACTOR_ID,
            agentAuthorityLevel: DASHBOARD_AUTHORITY_LEVEL,
            agentRoleId: DASHBOARD_ACTOR_ROLE_ID,
            toolName,
            toolCategory: tool.category,
            actionCategory,
            temporaryGrants: new Map(),
          });

          const decisionType = decision.allowed
            ? decision.requiresApproval
              ? ('approval_required' as const)
              : ('allowed' as const)
            : ('denied' as const);

          if (!decision.allowed) {
            ctx.getAuditTrail().log({
              agent_id: DASHBOARD_ACTOR_ID,
              agent_name: DASHBOARD_ACTOR_NAME,
              tool_name: toolName,
              action_category: actionCategory,
              authority_decision: decisionType,
              approval_id: null,
              executed: false,
              execution_time_ms: null,
              channel: 'click',
              project_id: body.project_id ?? null,
            });
            return error(`Denied: ${decision.reason}`, 403);
          }
          if (decision.requiresApproval) {
            // Phase 17-B: the 4 GitHub action tools are already registered in
            // the daemon's shared ToolRegistry (src/actions/tools/builtin.ts's
            // GITHUB_TOOLS spread), the same registry DeferredExecutor executes
            // against for every other deferred approval - so a dashboard click
            // can go through the exact same request → approve (dashboard's
            // Authority tab) → DeferredExecutor.executeApproved() path a
            // conversational tool call would, rather than being told to go
            // start a conversation instead.
            const params: Record<string, unknown> = { repo_path: body.repo_path };
            if (body.title !== undefined) params.title = body.title;
            if (body.body !== undefined) params.body = body.body;
            if (body.head !== undefined) params.head = body.head;
            if (body.base !== undefined) params.base = body.base;
            if (body.number !== undefined) params.number = body.number;
            if (body.event !== undefined) params.event = body.event;

            // Phase 18-C: ApprovalRequest itself has no project_id column
            // (out of scope to add one - see the Phase 18 plan doc), so the
            // project id is appended to the context string instead, same as
            // the repo_path is today.
            const request = ctx.getApprovalManager().createRequest({
              agentId: DASHBOARD_ACTOR_ID,
              agentName: DASHBOARD_ACTOR_NAME,
              toolName: toolName,
              toolArguments: params,
              actionCategory,
              urgency: 'normal',
              reason: decision.reason ?? 'Dashboard-triggered GitHub action requires approval',
              context: body.project_id
                ? `Dashboard: ${toolName} on ${body.repo_path} (project ${body.project_id})`
                : `Dashboard: ${toolName} on ${body.repo_path}`,
              executionMode: 'deferred',
            });

            ctx.getAuditTrail().log({
              agent_id: DASHBOARD_ACTOR_ID,
              agent_name: DASHBOARD_ACTOR_NAME,
              tool_name: toolName,
              action_category: actionCategory,
              authority_decision: decisionType,
              approval_id: request.id,
              executed: false,
              execution_time_ms: null,
              channel: 'click',
              project_id: body.project_id ?? null,
            });

            return json({ status: 'pending_approval', approval_id: request.id }, 202);
          }

          ctx.getAuditTrail().log({
            agent_id: DASHBOARD_ACTOR_ID,
            agent_name: DASHBOARD_ACTOR_NAME,
            tool_name: toolName,
            action_category: actionCategory,
            authority_decision: decisionType,
            approval_id: null,
            executed: true,
            execution_time_ms: null,
            channel: 'click',
            project_id: body.project_id ?? null,
          });

          const params: Record<string, unknown> = { repo_path: body.repo_path };
          if (body.title !== undefined) params.title = body.title;
          if (body.body !== undefined) params.body = body.body;
          if (body.head !== undefined) params.head = body.head;
          if (body.base !== undefined) params.base = body.base;
          if (body.number !== undefined) params.number = body.number;
          if (body.event !== undefined) params.event = body.event;

          const result = await tool.execute(params);
          return json({ result });
        } catch (err) {
          return errorFromException(err);
        }
      },
    },

    // AI Council (spec section 16) - fan a question out to several cost-mode
    // seats in parallel, then a chair pass synthesizes a verdict. Only needs
    // an LLMManager (works in classic mode too, no TaskDispatcher required).
    // Optional project_id scopes the recorded Decision; pass record:false to
    // skip writing a Decision row (e.g. a UI "preview" call).
    '/api/ai-manager/council': {
      POST: async (req: Request) => {
        try {
          const body = (await req.json()) as {
            question?: string;
            project_id?: string;
            record?: boolean;
            template?: string;
            seats?: Array<{ mode?: string; label?: string }>;
          };
          if (!body.question || typeof body.question !== 'string') {
            return error('question is required', 400);
          }
          if (body.project_id && !getProject(body.project_id)) {
            return error('Project not found', 404);
          }
          if (body.template && !VALID_TASK_TEMPLATES.includes(body.template as (typeof VALID_TASK_TEMPLATES)[number])) {
            return error(`template must be one of: ${VALID_TASK_TEMPLATES.join(', ')}`, 400);
          }
          let seats: CouncilSeat[] | undefined;
          if (body.seats) {
            if (!Array.isArray(body.seats) || body.seats.length === 0) {
              return error('seats must be a non-empty array', 400);
            }
            for (const seat of body.seats) {
              if (!seat.mode || !VALID_COUNCIL_MODES.includes(seat.mode as (typeof VALID_COUNCIL_MODES)[number])) {
                return error(`each seat.mode must be one of: ${VALID_COUNCIL_MODES.join(', ')}`, 400);
              }
            }
            seats = body.seats.map((s) => ({ mode: s.mode as CouncilSeat['mode'], label: s.label }));
          }

          const council = new AICouncil(new AIRouter(ctx.getLLMManager()));
          const verdict = await council.convene(body.question, {
            seats,
            template: body.template as (typeof VALID_TASK_TEMPLATES)[number] | undefined,
            project_id: body.project_id,
            record: body.record,
          });
          return json(verdict, 201);
        } catch (err) {
          return errorFromException(err);
        }
      },
    },

    // Agent performance (spec section 20) - success rate, avg duration, LLM
    // error rate, providers/models used, grouped by assigned_agent label.
    // Optional ?project_id= scopes to one project; ?days= bounds the LLM
    // usage window (task counts themselves are all-time).
    '/api/ai-manager/agents/performance': {
      GET: (req: Request) => {
        const params = new URL(req.url).searchParams;
        const projectId = params.get('project_id') ?? undefined;
        const daysParam = params.get('days');
        const daysBack = daysParam ? Number(daysParam) : undefined;
        if (daysParam && (!Number.isFinite(daysBack) || (daysBack as number) <= 0)) {
          return error('days must be a positive number', 400);
        }
        return json(getAgentPerformance({ projectId, daysBack }));
      },
    },
  };
}
