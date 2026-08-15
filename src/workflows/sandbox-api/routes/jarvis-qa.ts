/**
 * `/v1/jarvis/qa/run` -- Phase 9 "QA" node. Backs `QAAgent.run()`
 * (src/ai-manager/qa.ts): deterministic typecheck/lint/build/test/static
 * checks, independent of any LLM judgment.
 */

import { json, err, parseJsonObject, type RouteContext, type RouteHandler } from "./shared";

export interface QARunRequest {
  cwd?: string;
  includeBuild?: boolean;
  lintScripts?: string[];
}

export type QARunResponse = unknown;

export type QARunFn = (
  req: QARunRequest,
  ctx: { runId: string; projectId: string },
) => Promise<QARunResponse>;

export interface JarvisQARouteDeps {
  qaRun?: QARunFn;
}

export function createJarvisQARunRoute(deps: JarvisQARouteDeps): RouteHandler {
  return async (ctx: RouteContext) => {
    if (!deps.qaRun) {
      return err("jarvis qa.run not configured", 503);
    }
    const raw = await parseJsonObject(ctx);
    if (raw instanceof Response) return raw;

    const out: QARunRequest = {};
    if (typeof raw.cwd === "string" && raw.cwd.length > 0) out.cwd = raw.cwd;
    if (raw.includeBuild === true) out.includeBuild = true;
    if (raw.lintScripts !== undefined) {
      if (!Array.isArray(raw.lintScripts) || raw.lintScripts.some((x) => typeof x !== "string")) {
        return err("lintScripts must be an array of strings", 400);
      }
      out.lintScripts = raw.lintScripts as string[];
    }

    const reply = await deps.qaRun(out, {
      runId: ctx.claims.runId,
      projectId: ctx.claims.projectId,
    });
    return json(reply);
  };
}
