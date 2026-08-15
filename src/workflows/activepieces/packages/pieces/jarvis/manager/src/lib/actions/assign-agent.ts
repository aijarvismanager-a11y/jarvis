/**
 * `assignAgent` action -- POST `{ template, mode? }` to
 * `/v1/jarvis/manager/assign-agent` and return the routing decision
 * (tier/mode/recent error rate) without executing anything.
 */

import { createAction, Property } from "@activepieces/pieces-framework";

interface AssignAgentResponse {
  tier: string;
  mode: string;
  recent_error_rate: number | null;
}

export const assignAgentAction = createAction({
  name: "assignAgent",
  displayName: "Preview Agent Assignment",
  description:
    "Resolve which tier/mode a task of this template would be assigned to, plus its recent reliability, without running it.",
  outputSample: { tier: "medium", mode: "balanced", recent_error_rate: 0.02 },
  props: {
    template: Property.StaticDropdown({
      displayName: "Task template",
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
  },
  async run(context) {
    const url = trimSlash(context.server.apiUrl) + "/v1/jarvis/manager/assign-agent";
    const template = context.propsValue["template"];
    if (typeof template !== "string" || template.length === 0) {
      throw new Error("jarvis-manager: template is required");
    }
    const body: Record<string, unknown> = { template };
    const mode = context.propsValue["mode"];
    if (typeof mode === "string" && mode.length > 0) body["mode"] = mode;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${context.server.token}` },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`jarvis-manager: daemon responded ${response.status}: ${text.slice(0, 500)}`);
    }
    return (await response.json()) as AssignAgentResponse;
  },
});

function trimSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}
