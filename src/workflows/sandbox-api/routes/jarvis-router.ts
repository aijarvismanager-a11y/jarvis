/**
 * `/v1/jarvis/router/chat` -- Phase 9 "Provider Failover" node. Backs a
 * piece action that asks a question through `AIRouter.chat()` instead of a
 * fixed tier: cost-mode aware (cheap/balanced/quality), and inherits
 * `LLMManager.chatTier`'s existing per-tier retry + fall-up chain for free
 * (see src/ai-manager/router.ts) -- this route is the failover primitive
 * itself, not a wrapper around a separate mechanism.
 */

import { json, err, parseJsonObject, type RouteContext, type RouteHandler } from "./shared";

export interface RouterChatRequest {
  template: "research" | "code" | "plan" | "write" | "general";
  mode?: "cheap" | "balanced" | "quality";
  prompt: string;
  system?: string;
  /** Usage-tracking label. Defaults to "workflow_router" when unset. */
  subsystem?: string;
}

export interface RouterChatResponse {
  text: string;
  tier: string;
  mode: string;
  recent_error_rate: number | null;
}

export type RouterChatFn = (
  req: RouterChatRequest,
  ctx: { runId: string; projectId: string },
) => Promise<RouterChatResponse>;

export interface JarvisRouterRouteDeps {
  routerChat?: RouterChatFn;
}

const VALID_TEMPLATES = ["research", "code", "plan", "write", "general"];
const VALID_MODES = ["cheap", "balanced", "quality"];

export function createJarvisRouterChatRoute(deps: JarvisRouterRouteDeps): RouteHandler {
  return async (ctx: RouteContext) => {
    if (!deps.routerChat) {
      return err("jarvis router.chat not configured", 503);
    }
    const raw = await parseJsonObject(ctx);
    if (raw instanceof Response) return raw;
    if (typeof raw.template !== "string" || !VALID_TEMPLATES.includes(raw.template)) {
      return err(`template must be one of: ${VALID_TEMPLATES.join(", ")}`, 400);
    }
    if (typeof raw.prompt !== "string" || raw.prompt.length === 0) {
      return err("prompt must be a non-empty string", 400);
    }
    const out: RouterChatRequest = {
      template: raw.template as RouterChatRequest["template"],
      prompt: raw.prompt,
    };
    if (raw.mode !== undefined) {
      if (typeof raw.mode !== "string" || !VALID_MODES.includes(raw.mode)) {
        return err(`mode must be one of: ${VALID_MODES.join(", ")}`, 400);
      }
      out.mode = raw.mode as RouterChatRequest["mode"];
    }
    if (typeof raw.system === "string") out.system = raw.system;
    if (typeof raw.subsystem === "string" && raw.subsystem.length > 0) out.subsystem = raw.subsystem;

    const reply = await deps.routerChat(out, {
      runId: ctx.claims.runId,
      projectId: ctx.claims.projectId,
    });
    return json(reply);
  };
}
