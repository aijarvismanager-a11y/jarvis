/**
 * `/v1/jarvis/decision/write` -- Phase 9 "Decision Write" node. Backs
 * `createDecision()` (src/vault/decisions.ts): records a statement into
 * Decision Memory (spec section 17) so it doesn't get re-litigated later.
 */

import { json, err, parseJsonObject, type RouteContext, type RouteHandler } from "./shared";

export interface DecisionWriteRequest {
  statement: string;
  project_id?: string;
  reason?: string;
  made_by?: string;
}

export type DecisionWriteResponse = unknown;

export type DecisionWriteFn = (
  req: DecisionWriteRequest,
  ctx: { runId: string; projectId: string },
) => Promise<DecisionWriteResponse>;

export interface JarvisDecisionRouteDeps {
  decisionWrite?: DecisionWriteFn;
}

export function createJarvisDecisionWriteRoute(deps: JarvisDecisionRouteDeps): RouteHandler {
  return async (ctx: RouteContext) => {
    if (!deps.decisionWrite) {
      return err("jarvis decision.write not configured", 503);
    }
    const raw = await parseJsonObject(ctx);
    if (raw instanceof Response) return raw;
    if (typeof raw.statement !== "string" || raw.statement.length === 0) {
      return err("statement must be a non-empty string", 400);
    }
    const out: DecisionWriteRequest = { statement: raw.statement };
    if (typeof raw.project_id === "string" && raw.project_id.length > 0) out.project_id = raw.project_id;
    if (typeof raw.reason === "string" && raw.reason.length > 0) out.reason = raw.reason;
    if (typeof raw.made_by === "string" && raw.made_by.length > 0) out.made_by = raw.made_by;

    const reply = await deps.decisionWrite(out, {
      runId: ctx.claims.runId,
      projectId: ctx.claims.projectId,
    });
    return json(reply);
  };
}
