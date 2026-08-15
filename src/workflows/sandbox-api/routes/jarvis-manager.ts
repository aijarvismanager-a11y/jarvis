/**
 * `/v1/jarvis/manager/*` -- Phase 9 "AI Task" and "Agent Assignment" nodes.
 *
 *  - `run-project` backs "AI Task": runs the full Planner -> Router ->
 *    Assignment -> Execution -> Handoff pass via `ManagerAgent.handleRequest`
 *    (see src/ai-manager/manager-agent.ts) and returns once the project's
 *    task graph has settled. Requires a TaskDispatcher (conversation tier
 *    configured); 503s otherwise, same convention as the AI Manager REST API
 *    (src/ai-manager/api/routes.ts).
 *  - `assign-agent` backs "Agent Assignment": a pure routing decision
 *    (`AIRouter.route`) -- which tier/mode a task of this template would be
 *    assigned to, plus its recent reliability -- without executing anything.
 */

import { json, err, parseJsonObject, type RouteContext, type RouteHandler } from "./shared";

export interface ManagerRunProjectRequest {
  name: string;
  request: string;
  template?: string;
  execution_mode?: "auto" | "assisted" | "manual";
}

export type ManagerRunProjectResponse = unknown;

export type ManagerRunProjectFn = (
  req: ManagerRunProjectRequest,
  ctx: { runId: string; projectId: string },
) => Promise<ManagerRunProjectResponse>;

export interface ManagerAssignAgentRequest {
  template: "research" | "code" | "plan" | "write" | "general";
  mode?: "cheap" | "balanced" | "quality";
}

export interface ManagerAssignAgentResponse {
  tier: string;
  mode: string;
  recent_error_rate: number | null;
}

export type ManagerAssignAgentFn = (
  req: ManagerAssignAgentRequest,
  ctx: { runId: string; projectId: string },
) => Promise<ManagerAssignAgentResponse>;

export interface JarvisManagerRouteDeps {
  managerRunProject?: ManagerRunProjectFn;
  managerAssignAgent?: ManagerAssignAgentFn;
}

const VALID_EXECUTION_MODES = ["auto", "assisted", "manual"];
const VALID_TEMPLATES = ["research", "code", "plan", "write", "general"];
const VALID_MODES = ["cheap", "balanced", "quality"];
// Distinct from VALID_TEMPLATES above (that's TaskTemplate, for assign-agent).
// run-project's `template` is a ProjectTemplate (src/vault/projects.ts) --
// validated here too, not just in managerRunProject, so an invalid value
// gets this route's normal 400 instead of surfacing as a 500 from a thrown
// Error deeper in the backend.
const VALID_PROJECT_TEMPLATES = [
  "website", "web_app", "software", "research", "content", "data_project", "automation", "custom",
];

export function createJarvisManagerRunProjectRoute(deps: JarvisManagerRouteDeps): RouteHandler {
  return async (ctx: RouteContext) => {
    if (!deps.managerRunProject) {
      return err("jarvis manager.run-project not configured", 503);
    }
    const raw = await parseJsonObject(ctx);
    if (raw instanceof Response) return raw;
    if (typeof raw.name !== "string" || raw.name.length === 0) {
      return err("name must be a non-empty string", 400);
    }
    if (typeof raw.request !== "string" || raw.request.length === 0) {
      return err("request must be a non-empty string", 400);
    }
    const out: ManagerRunProjectRequest = { name: raw.name, request: raw.request };
    if (raw.template !== undefined) {
      if (typeof raw.template !== "string" || !VALID_PROJECT_TEMPLATES.includes(raw.template)) {
        return err(`template must be one of: ${VALID_PROJECT_TEMPLATES.join(", ")}`, 400);
      }
      out.template = raw.template;
    }
    if (raw.execution_mode !== undefined) {
      if (typeof raw.execution_mode !== "string" || !VALID_EXECUTION_MODES.includes(raw.execution_mode)) {
        return err(`execution_mode must be one of: ${VALID_EXECUTION_MODES.join(", ")}`, 400);
      }
      out.execution_mode = raw.execution_mode as ManagerRunProjectRequest["execution_mode"];
    }

    const reply = await deps.managerRunProject(out, {
      runId: ctx.claims.runId,
      projectId: ctx.claims.projectId,
    });
    return json(reply);
  };
}

export function createJarvisManagerAssignAgentRoute(deps: JarvisManagerRouteDeps): RouteHandler {
  return async (ctx: RouteContext) => {
    if (!deps.managerAssignAgent) {
      return err("jarvis manager.assign-agent not configured", 503);
    }
    const raw = await parseJsonObject(ctx);
    if (raw instanceof Response) return raw;
    if (typeof raw.template !== "string" || !VALID_TEMPLATES.includes(raw.template)) {
      return err(`template must be one of: ${VALID_TEMPLATES.join(", ")}`, 400);
    }
    const out: ManagerAssignAgentRequest = { template: raw.template as ManagerAssignAgentRequest["template"] };
    if (raw.mode !== undefined) {
      if (typeof raw.mode !== "string" || !VALID_MODES.includes(raw.mode)) {
        return err(`mode must be one of: ${VALID_MODES.join(", ")}`, 400);
      }
      out.mode = raw.mode as ManagerAssignAgentRequest["mode"];
    }

    const reply = await deps.managerAssignAgent(out, {
      runId: ctx.claims.runId,
      projectId: ctx.claims.projectId,
    });
    return json(reply);
  };
}
