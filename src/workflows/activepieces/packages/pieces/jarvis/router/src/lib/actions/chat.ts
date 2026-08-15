/**
 * `chat` action -- POST `{ template, mode?, prompt, system?, subsystem? }` to
 * `/v1/jarvis/router/chat` and surface the reply plus the routing decision
 * actually used (tier, mode, recent error rate).
 */

import { createAction, Property } from "@activepieces/pieces-framework";

interface ChatResponse {
  text: string;
  tier: string;
  mode: string;
  recent_error_rate: number | null;
}

export const chatAction = createAction({
  name: "chat",
  displayName: "Ask via AI Router (Provider Failover)",
  description:
    "Send a prompt through the cost-mode router. Automatically retries and falls up across providers within the resolved tier.",
  outputSample: {
    text: "Here's the summary you asked for...",
    tier: "medium",
    mode: "balanced",
    recent_error_rate: 0.02,
  },
  props: {
    template: Property.StaticDropdown({
      displayName: "Task template",
      description: "Shapes the default cost mode and system prompt style.",
      required: true,
      defaultValue: "general",
      options: {
        disabled: false,
        options: [
          { value: "research", label: "Research" },
          { value: "code", label: "Code" },
          { value: "plan", label: "Plan" },
          { value: "write", label: "Write" },
          { value: "general", label: "General" },
        ],
      },
    }),
    mode: Property.StaticDropdown({
      displayName: "Cost mode",
      description: "Overrides the template's default cost mode.",
      required: false,
      options: {
        disabled: false,
        options: [
          { value: "cheap", label: "Cheap" },
          { value: "balanced", label: "Balanced" },
          { value: "quality", label: "Quality" },
        ],
      },
    }),
    prompt: Property.LongText({ displayName: "Prompt", required: true }),
    system: Property.LongText({
      displayName: "System prompt",
      description: "Optional. Appended to Jarvis's default system prompt.",
      required: false,
    }),
    subsystem: Property.ShortText({
      displayName: "Usage label",
      description: "Optional. Tags llm_usage rows for this call (defaults to workflow_router).",
      required: false,
    }),
  },
  async run(context) {
    const url = trimSlash(context.server.apiUrl) + "/v1/jarvis/router/chat";
    const template = context.propsValue["template"];
    const prompt = context.propsValue["prompt"];
    if (typeof template !== "string" || template.length === 0) {
      throw new Error("jarvis-router: template is required");
    }
    if (typeof prompt !== "string" || prompt.length === 0) {
      throw new Error("jarvis-router: prompt is required and must be a non-empty string");
    }
    const body: Record<string, unknown> = { template, prompt };
    const mode = context.propsValue["mode"];
    if (typeof mode === "string" && mode.length > 0) body["mode"] = mode;
    const system = context.propsValue["system"];
    if (typeof system === "string" && system.length > 0) body["system"] = system;
    const subsystem = context.propsValue["subsystem"];
    if (typeof subsystem === "string" && subsystem.length > 0) body["subsystem"] = subsystem;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${context.server.token}` },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`jarvis-router: daemon responded ${response.status}: ${text.slice(0, 500)}`);
    }
    return (await response.json()) as ChatResponse;
  },
});

function trimSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}
