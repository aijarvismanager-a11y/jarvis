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
import {
  findProjects,
  getProject,
  updateProjectStatus,
  updateProjectExecutionMode,
  setProjectRules,
  type ProjectStatus,
  type ExecutionMode,
  type ProjectTemplate,
} from '../../vault/projects.ts';
import { findDecisions, createDecision } from '../../vault/decisions.ts';
import { getProjectTasks } from '../../vault/project-tasks.ts';
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
const VALID_TEMPLATES: readonly ProjectTemplate[] = [
  'website', 'web_app', 'software', 'research', 'content', 'data_project', 'automation', 'custom',
];
const VALID_COUNCIL_MODES = ['cheap', 'balanced', 'quality'] as const;
const VALID_TASK_TEMPLATES = ['research', 'code', 'plan', 'write', 'general'] as const;

export type AIManagerApiContext = {
  getLLMManager: () => LLMManager;
  getTaskDispatcher: () => TaskDispatcher | null;
};

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
    return new ManagerAgent(router, dispatcher);
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
          };
          if (!body.name || typeof body.name !== 'string') return error('name is required', 400);
          if (!body.request || typeof body.request !== 'string') return error('request is required', 400);
          if (body.template && !VALID_TEMPLATES.includes(body.template)) {
            return error(`template must be one of: ${VALID_TEMPLATES.join(', ')}`, 400);
          }
          if (body.execution_mode && !VALID_EXECUTION_MODES.includes(body.execution_mode)) {
            return error(`execution_mode must be one of: ${VALID_EXECUTION_MODES.join(', ')}`, 400);
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
          const body = (await req.json()) as { status?: ProjectStatus; execution_mode?: ExecutionMode; rules?: string[] };
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
