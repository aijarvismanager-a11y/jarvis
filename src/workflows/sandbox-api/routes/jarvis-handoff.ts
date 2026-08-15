/**
 * `/v1/jarvis/handoff/*` -- Phase 9 "Handoff" and "Review" nodes.
 *
 *  - `send` backs "Handoff": files a structured Handoff record (spec section
 *    14) via `sendHandoff()` (src/agents/handoff.ts) so a task isn't
 *    considered complete until a Handoff exists for it.
 *  - `list` backs "Review": lets a downstream step read back every Handoff
 *    filed for a task -- e.g. a reviewer step inspecting what a prior agent
 *    reported before deciding to approve/re-run.
 */

import { json, err, parseJsonObject, type RouteContext, type RouteHandler } from "./shared";

export interface HandoffSendRequest {
  task_id: string;
  from_agent: string;
  to_agent: string;
  status: "completed" | "failed" | "needs_input";
  summary: string;
  instructions?: string[];
  artifacts?: string[];
  decisions?: string[];
  warnings?: string[];
  open_questions?: string[];
  next_action: string;
  project_id?: string;
  priority?: "low" | "normal" | "high" | "urgent";
}

export interface HandoffSendResponse {
  id: string;
}

export type HandoffSendFn = (
  req: HandoffSendRequest,
  ctx: { runId: string; projectId: string },
) => Promise<HandoffSendResponse>;

export interface HandoffListRequest {
  task_id: string;
}

export type HandoffListResponse = {
  handoffs: unknown[];
};

export type HandoffListFn = (
  req: HandoffListRequest,
  ctx: { runId: string; projectId: string },
) => Promise<HandoffListResponse>;

export interface JarvisHandoffRouteDeps {
  handoffSend?: HandoffSendFn;
  handoffList?: HandoffListFn;
}

const VALID_STATUSES = ["completed", "failed", "needs_input"];
const STRING_ARRAY_FIELDS = ["instructions", "artifacts", "decisions", "warnings", "open_questions"] as const;

function requireString(raw: Record<string, unknown>, field: string): string | Response {
  const v = raw[field];
  if (typeof v !== "string" || v.length === 0) {
    return err(`${field} must be a non-empty string`, 400);
  }
  return v;
}

export function createJarvisHandoffSendRoute(deps: JarvisHandoffRouteDeps): RouteHandler {
  return async (ctx: RouteContext) => {
    if (!deps.handoffSend) {
      return err("jarvis handoff.send not configured", 503);
    }
    const raw = await parseJsonObject(ctx);
    if (raw instanceof Response) return raw;

    const task_id = requireString(raw, "task_id");
    if (task_id instanceof Response) return task_id;
    const from_agent = requireString(raw, "from_agent");
    if (from_agent instanceof Response) return from_agent;
    const to_agent = requireString(raw, "to_agent");
    if (to_agent instanceof Response) return to_agent;
    const summary = requireString(raw, "summary");
    if (summary instanceof Response) return summary;
    const next_action = requireString(raw, "next_action");
    if (next_action instanceof Response) return next_action;
    if (typeof raw.status !== "string" || !VALID_STATUSES.includes(raw.status)) {
      return err(`status must be one of: ${VALID_STATUSES.join(", ")}`, 400);
    }

    const out: HandoffSendRequest = {
      task_id,
      from_agent,
      to_agent,
      status: raw.status as HandoffSendRequest["status"],
      summary,
      next_action,
    };
    for (const field of STRING_ARRAY_FIELDS) {
      const v = raw[field];
      if (v === undefined) continue;
      if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) {
        return err(`${field} must be an array of strings`, 400);
      }
      (out as unknown as Record<string, unknown>)[field] = v;
    }
    if (typeof raw.project_id === "string" && raw.project_id.length > 0) out.project_id = raw.project_id;
    if (typeof raw.priority === "string" && raw.priority.length > 0) {
      out.priority = raw.priority as HandoffSendRequest["priority"];
    }

    const reply = await deps.handoffSend(out, {
      runId: ctx.claims.runId,
      projectId: ctx.claims.projectId,
    });
    return json(reply);
  };
}

export function createJarvisHandoffListRoute(deps: JarvisHandoffRouteDeps): RouteHandler {
  return async (ctx: RouteContext) => {
    if (!deps.handoffList) {
      return err("jarvis handoff.list not configured", 503);
    }
    const raw = await parseJsonObject(ctx);
    if (raw instanceof Response) return raw;
    const task_id = requireString(raw, "task_id");
    if (task_id instanceof Response) return task_id;

    const reply = await deps.handoffList({ task_id }, {
      runId: ctx.claims.runId,
      projectId: ctx.claims.projectId,
    });
    return json(reply);
  };
}
