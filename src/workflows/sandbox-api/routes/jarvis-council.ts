/**
 * `/v1/jarvis/council/convene` -- Phase 9 "AI Council" node. Backs
 * `AICouncil.convene()` (src/ai-manager/council.ts): fans a question out to
 * several cost-mode seats in parallel, has a chair pass synthesize a
 * verdict, and (by default) records the verdict as a Decision.
 */

import { json, err, parseJsonObject, type RouteContext, type RouteHandler } from "./shared";

export interface CouncilSeatInput {
  mode: "cheap" | "balanced" | "quality";
  label?: string;
}

export interface CouncilConveneRequest {
  question: string;
  seats?: CouncilSeatInput[];
  template?: "research" | "code" | "plan" | "write" | "general";
  project_id?: string;
  record?: boolean;
}

export type CouncilConveneResponse = unknown;

export type CouncilConveneFn = (
  req: CouncilConveneRequest,
  ctx: { runId: string; projectId: string },
) => Promise<CouncilConveneResponse>;

export interface JarvisCouncilRouteDeps {
  councilConvene?: CouncilConveneFn;
}

const VALID_MODES = ["cheap", "balanced", "quality"];
const VALID_TEMPLATES = ["research", "code", "plan", "write", "general"];

export function createJarvisCouncilConveneRoute(deps: JarvisCouncilRouteDeps): RouteHandler {
  return async (ctx: RouteContext) => {
    if (!deps.councilConvene) {
      return err("jarvis council.convene not configured", 503);
    }
    const raw = await parseJsonObject(ctx);
    if (raw instanceof Response) return raw;
    if (typeof raw.question !== "string" || raw.question.length === 0) {
      return err("question must be a non-empty string", 400);
    }
    const out: CouncilConveneRequest = { question: raw.question };

    if (raw.seats !== undefined) {
      if (!Array.isArray(raw.seats)) return err("seats must be an array", 400);
      const seats: CouncilSeatInput[] = [];
      for (const s of raw.seats) {
        if (typeof s !== "object" || s === null) return err("each seat must be an object", 400);
        const seat = s as Record<string, unknown>;
        if (typeof seat.mode !== "string" || !VALID_MODES.includes(seat.mode)) {
          return err(`each seat's mode must be one of: ${VALID_MODES.join(", ")}`, 400);
        }
        const entry: CouncilSeatInput = { mode: seat.mode as CouncilSeatInput["mode"] };
        if (typeof seat.label === "string" && seat.label.length > 0) entry.label = seat.label;
        seats.push(entry);
      }
      out.seats = seats;
    }
    if (raw.template !== undefined) {
      if (typeof raw.template !== "string" || !VALID_TEMPLATES.includes(raw.template)) {
        return err(`template must be one of: ${VALID_TEMPLATES.join(", ")}`, 400);
      }
      out.template = raw.template as CouncilConveneRequest["template"];
    }
    if (typeof raw.project_id === "string" && raw.project_id.length > 0) out.project_id = raw.project_id;
    if (raw.record === false) out.record = false;

    const reply = await deps.councilConvene(out, {
      runId: ctx.claims.runId,
      projectId: ctx.claims.projectId,
    });
    return json(reply);
  };
}
