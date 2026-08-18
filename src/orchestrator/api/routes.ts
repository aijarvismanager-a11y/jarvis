/**
 * Orchestrator REST API - exposes the external AI Worker layer (spec
 * section 23: AI Status / Task / Handoff screens) to the dashboard.
 * Mounted alongside the daemon's other route sets (same pattern as
 * createAIManagerRoutes / createWorkflowRoutes in src/daemon/index.ts).
 */

import type { WorkerRegistry } from '../../workers/registry.ts';
import type { WorkerDefinition } from '../../workers/types.ts';
import type { TaskWorkerRunner } from '../task-runner.ts';
import type { TaskTemplate } from '../../agents/conv/task-envelope.ts';
import { listHandoffFiles } from '../handoff-file.ts';
import type { WorkspacePaths } from '../workspace.ts';
import { setWorkerEnabledPersisted } from '../../workers/settings.ts';
import { addCustomWorker, removeCustomWorker } from '../../workers/custom-registry.ts';
import { CommandWorker } from '../../workers/command-worker.ts';
import { addMcpWorker, removeMcpWorker } from '../../workers/mcp-registry.ts';
import { MCPWorker } from '../../workers/mcp.ts';
import type { WorkerCapability } from '../../workers/types.ts';
import { getCorsHeaders } from '../../daemon/api-routes.ts';

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: getCorsHeaders() });
}

function error(message: string, status = 400): Response {
  return json({ error: message }, status);
}

const VALID_TEMPLATES: TaskTemplate[] = ['research', 'code', 'plan', 'write', 'general'];
const VALID_CAPABILITIES: WorkerCapability[] = ['code', 'research', 'write', 'plan', 'image', 'general'];

export type OrchestratorApiContext = {
  getRegistry: () => WorkerRegistry;
  getRunner: () => TaskWorkerRunner;
  getWorkspace: () => WorkspacePaths;
  getDataDir: () => string;
};

function serializeWorker(def: WorkerDefinition) {
  // Workspace is a local filesystem path - not useful (and mildly sensitive)
  // to expose to the dashboard client.
  const { workspace: _workspace, ...rest } = def;
  return rest;
}

export function createOrchestratorRoutes(ctx: OrchestratorApiContext): Record<string, unknown> {
  return {
    '/api/orchestrator/workers': {
      GET: (_req: Request) => {
        return json({ workers: ctx.getRegistry().list().map((w) => serializeWorker(w.definition)) });
      },
    },

    '/api/orchestrator/workers/:name/enabled': {
      POST: async (req: Request & { params: { name: string } }) => {
        const worker = ctx.getRegistry().get(req.params.name);
        if (!worker) return error('Worker not found', 404);

        const body = (await req.json().catch(() => null)) as { enabled?: unknown } | null;
        if (!body || typeof body.enabled !== 'boolean') {
          return error('body must be { "enabled": boolean }', 400);
        }
        worker.definition.enabled = body.enabled;
        setWorkerEnabledPersisted(ctx.getDataDir(), worker.definition.name, body.enabled);
        return json({ worker: serializeWorker(worker.definition) });
      },
    },

    '/api/orchestrator/custom-workers': {
      POST: async (req: Request) => {
        const body = (await req.json().catch(() => null)) as
          | { name?: unknown; binary?: unknown; args?: unknown; capabilities?: unknown; timeout_ms?: unknown; retry?: unknown }
          | null;
        if (!body || typeof body.name !== 'string' || !body.name.trim()) {
          return error('name is required', 400);
        }
        if (typeof body.binary !== 'string' || !body.binary.trim()) {
          return error('binary is required', 400);
        }
        if (!Array.isArray(body.args) || !body.args.every((a) => typeof a === 'string')) {
          return error('args must be an array of strings', 400);
        }
        if (
          !Array.isArray(body.capabilities) ||
          body.capabilities.length === 0 ||
          !body.capabilities.every((c) => VALID_CAPABILITIES.includes(c as WorkerCapability))
        ) {
          return error(`capabilities must be a non-empty array from: ${VALID_CAPABILITIES.join(', ')}`, 400);
        }

        const config = {
          name: body.name.trim(),
          binary: body.binary.trim(),
          args: body.args as string[],
          capabilities: body.capabilities as WorkerCapability[],
          ...(typeof body.timeout_ms === 'number' ? { timeout_ms: body.timeout_ms } : {}),
          ...(typeof body.retry === 'number' ? { retry: body.retry } : {}),
        };

        const result = await addCustomWorker(ctx.getDataDir(), config);
        if (!result.ok) return error(result.error, 400);

        ctx.getRegistry().register(new CommandWorker({ ...result.config, workspace: ctx.getWorkspace().root }));
        return json({ worker: serializeWorker(ctx.getRegistry().get(config.name)!.definition) }, 201);
      },
    },

    '/api/orchestrator/custom-workers/:name': {
      DELETE: async (req: Request & { params: { name: string } }) => {
        const removed = await removeCustomWorker(ctx.getDataDir(), req.params.name);
        if (!removed) return error('Custom Worker not found', 404);
        ctx.getRegistry().unregister(req.params.name);
        return json({ removed: req.params.name });
      },
    },

    '/api/orchestrator/mcp-workers': {
      POST: async (req: Request) => {
        const body = (await req.json().catch(() => null)) as
          | { name?: unknown; command?: unknown; args?: unknown; tool?: unknown; promptParam?: unknown; capabilities?: unknown; timeout_ms?: unknown; retry?: unknown }
          | null;
        if (!body || typeof body.name !== 'string' || !body.name.trim()) {
          return error('name is required', 400);
        }
        if (typeof body.command !== 'string' || !body.command.trim()) {
          return error('command is required', 400);
        }
        if (!Array.isArray(body.args) || !body.args.every((a) => typeof a === 'string')) {
          return error('args must be an array of strings', 400);
        }
        if (typeof body.tool !== 'string' || !body.tool.trim()) {
          return error('tool is required', 400);
        }
        if (
          !Array.isArray(body.capabilities) ||
          body.capabilities.length === 0 ||
          !body.capabilities.every((c) => VALID_CAPABILITIES.includes(c as WorkerCapability))
        ) {
          return error(`capabilities must be a non-empty array from: ${VALID_CAPABILITIES.join(', ')}`, 400);
        }

        const config = {
          name: body.name.trim(),
          command: body.command.trim(),
          args: body.args as string[],
          tool: body.tool.trim(),
          capabilities: body.capabilities as WorkerCapability[],
          ...(typeof body.promptParam === 'string' && body.promptParam.trim() ? { promptParam: body.promptParam.trim() } : {}),
          ...(typeof body.timeout_ms === 'number' ? { timeout_ms: body.timeout_ms } : {}),
          ...(typeof body.retry === 'number' ? { retry: body.retry } : {}),
        };

        const result = await addMcpWorker(ctx.getDataDir(), config);
        if (!result.ok) return error(result.error, 400);

        ctx.getRegistry().register(new MCPWorker({ ...result.config, workspace: ctx.getWorkspace().root }));
        return json({ worker: serializeWorker(ctx.getRegistry().get(config.name)!.definition) }, 201);
      },
    },

    '/api/orchestrator/mcp-workers/:name': {
      DELETE: async (req: Request & { params: { name: string } }) => {
        const removed = await removeMcpWorker(ctx.getDataDir(), req.params.name);
        if (!removed) return error('MCP Worker not found', 404);
        ctx.getRegistry().unregister(req.params.name);
        return json({ removed: req.params.name });
      },
    },

    '/api/orchestrator/handoffs': {
      GET: async (req: Request) => {
        const limitParam = new URL(req.url).searchParams.get('limit');
        const parsedLimit = limitParam === null ? 50 : parseInt(limitParam, 10);
        const limit = Math.min(Math.max(Number.isNaN(parsedLimit) ? 50 : parsedLimit, 0), 200);
        return json({ handoffs: await listHandoffFiles(ctx.getWorkspace().handoff, limit) });
      },
    },

    '/api/orchestrator/tasks': {
      POST: async (req: Request) => {
        const body = (await req.json().catch(() => null)) as
          | { task_id?: unknown; template?: unknown; prompt?: unknown; worker?: unknown }
          | null;
        if (!body || typeof body.task_id !== 'string' || !body.task_id) {
          return error('task_id is required', 400);
        }
        if (typeof body.template !== 'string' || !VALID_TEMPLATES.includes(body.template as TaskTemplate)) {
          return error(`template must be one of: ${VALID_TEMPLATES.join(', ')}`, 400);
        }
        if (typeof body.prompt !== 'string' || !body.prompt) {
          return error('prompt is required', 400);
        }

        try {
          const outcome = await ctx.getRunner().run({
            task_id: body.task_id,
            template: body.template as TaskTemplate,
            prompt: body.prompt,
            ...(typeof body.worker === 'string' ? { explicitWorker: body.worker } : {}),
          });
          return json(outcome);
        } catch (err) {
          return error(err instanceof Error ? err.message : String(err), 502);
        }
      },
    },
  };
}
