/**
 * `/v1/jarvis/memory/write` -- Phase 9 "Memory Write" node. Backs
 * `createFact()` (src/vault/facts.ts): writes a subject/predicate/object
 * triple into the vault's knowledge graph. `subjectId` must be an existing
 * entity id -- this route is deliberately narrow (one vault write kind, the
 * knowledge-graph fact) rather than a generic "write anything" endpoint;
 * see docs/AI_MANAGER_ARCHITECTURE_AUDIT.md section 4 on why there's no
 * single generic vault-write function to wrap instead.
 */

import { json, err, parseJsonObject, type RouteContext, type RouteHandler } from "./shared";

export interface MemoryWriteRequest {
  subjectId: string;
  predicate: string;
  object: string;
  confidence?: number;
  source?: string;
}

export type MemoryWriteResponse = unknown;

export type MemoryWriteFn = (
  req: MemoryWriteRequest,
  ctx: { runId: string; projectId: string },
) => Promise<MemoryWriteResponse>;

export interface JarvisMemoryRouteDeps {
  memoryWrite?: MemoryWriteFn;
}

export function createJarvisMemoryWriteRoute(deps: JarvisMemoryRouteDeps): RouteHandler {
  return async (ctx: RouteContext) => {
    if (!deps.memoryWrite) {
      return err("jarvis memory.write not configured", 503);
    }
    const raw = await parseJsonObject(ctx);
    if (raw instanceof Response) return raw;
    if (typeof raw.subjectId !== "string" || raw.subjectId.length === 0) {
      return err("subjectId must be a non-empty string", 400);
    }
    if (typeof raw.predicate !== "string" || raw.predicate.length === 0) {
      return err("predicate must be a non-empty string", 400);
    }
    if (typeof raw.object !== "string" || raw.object.length === 0) {
      return err("object must be a non-empty string", 400);
    }
    const out: MemoryWriteRequest = { subjectId: raw.subjectId, predicate: raw.predicate, object: raw.object };
    if (raw.confidence !== undefined) {
      if (typeof raw.confidence !== "number" || raw.confidence < 0 || raw.confidence > 1) {
        return err("confidence must be a number between 0 and 1", 400);
      }
      out.confidence = raw.confidence;
    }
    if (typeof raw.source === "string" && raw.source.length > 0) out.source = raw.source;

    const reply = await deps.memoryWrite(out, {
      runId: ctx.claims.runId,
      projectId: ctx.claims.projectId,
    });
    return json(reply);
  };
}
