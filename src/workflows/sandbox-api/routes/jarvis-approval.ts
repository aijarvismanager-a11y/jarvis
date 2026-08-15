/**
 * `/v1/jarvis/approval/request` -- Phase 9 "Approval" node: a generic
 * human-in-the-loop gate a flow can insert before a sensitive step. Creates
 * an `ApprovalRequest` and blocks until it resolves (approved/denied/
 * expired) or the timeout elapses, mirroring the same
 * `ApprovalManager.createRequest` + `waitForResolution` sequence the
 * in-process authority gate uses (see `AgentOrchestrator.executeTool`,
 * src/agents/orchestrator.ts) -- so a flow-originated approval shows up
 * alongside agent-originated ones on the dashboard/channels, not as a
 * bespoke second mechanism.
 *
 * Always created with `execution_mode: 'inline'`: nothing should
 * auto-execute on approval here (unlike a tool-call gate, there's no tool
 * bound to this request) -- the flow itself decides what to do next based
 * on the returned status.
 */

import { json, err, parseJsonObject, type RouteContext, type RouteHandler } from "./shared";

export interface ApprovalRequestRequest {
  toolName: string;
  actionCategory: string;
  reason: string;
  arguments?: Record<string, unknown>;
  urgency?: "urgent" | "normal";
  context?: string;
  timeoutMs?: number;
}

export interface ApprovalRequestResponse {
  requestId: string;
  status: "approved" | "denied" | "expired" | "executed" | "pending";
}

export type ApprovalRequestFn = (
  req: ApprovalRequestRequest,
  ctx: { runId: string; projectId: string },
) => Promise<ApprovalRequestResponse>;

export interface JarvisApprovalRouteDeps {
  approvalRequest?: ApprovalRequestFn;
}

const VALID_URGENCY = ["urgent", "normal"];

export function createJarvisApprovalRequestRoute(deps: JarvisApprovalRouteDeps): RouteHandler {
  return async (ctx: RouteContext) => {
    if (!deps.approvalRequest) {
      return err("jarvis approval.request not configured", 503);
    }
    const raw = await parseJsonObject(ctx);
    if (raw instanceof Response) return raw;
    if (typeof raw.toolName !== "string" || raw.toolName.length === 0) {
      return err("toolName must be a non-empty string", 400);
    }
    if (typeof raw.actionCategory !== "string" || raw.actionCategory.length === 0) {
      return err("actionCategory must be a non-empty string", 400);
    }
    if (typeof raw.reason !== "string" || raw.reason.length === 0) {
      return err("reason must be a non-empty string", 400);
    }
    const out: ApprovalRequestRequest = {
      toolName: raw.toolName,
      actionCategory: raw.actionCategory,
      reason: raw.reason,
    };
    if (raw.arguments !== undefined) {
      if (typeof raw.arguments !== "object" || raw.arguments === null || Array.isArray(raw.arguments)) {
        return err("arguments must be an object", 400);
      }
      out.arguments = raw.arguments as Record<string, unknown>;
    }
    if (raw.urgency !== undefined) {
      if (typeof raw.urgency !== "string" || !VALID_URGENCY.includes(raw.urgency)) {
        return err(`urgency must be one of: ${VALID_URGENCY.join(", ")}`, 400);
      }
      out.urgency = raw.urgency as ApprovalRequestRequest["urgency"];
    }
    if (typeof raw.context === "string") out.context = raw.context;
    if (raw.timeoutMs !== undefined) {
      if (typeof raw.timeoutMs !== "number" || !Number.isFinite(raw.timeoutMs) || raw.timeoutMs <= 0) {
        return err("timeoutMs must be a positive number", 400);
      }
      out.timeoutMs = raw.timeoutMs;
    }

    const reply = await deps.approvalRequest(out, {
      runId: ctx.claims.runId,
      projectId: ctx.claims.projectId,
    });
    return json(reply);
  };
}
