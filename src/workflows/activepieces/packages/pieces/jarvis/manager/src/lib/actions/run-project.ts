/**
 * `runProject` action -- POST `{ name, request, template?, execution_mode? }`
 * to `/v1/jarvis/manager/run-project` and return the settled project +
 * subtask outcomes. Requires the daemon to have a conversation-tier
 * TaskDispatcher configured; 503s otherwise.
 */

import { createAction, Property } from "@activepieces/pieces-framework";

export const runProjectAction = createAction({
  name: "runProject",
  displayName: "Run an AI Task (project)",
  description:
    "Plan a request into a dependency graph of subtasks and run them to completion, respecting dependencies. Blocks until the whole graph settles.",
  outputSample: {
    project: { id: "proj_abc123", name: "Landing page", status: "completed" },
    outcomes: [
      { index: 0, title: "Draft copy", task_id: "task_1", status: "COMPLETED", summary: "Copy drafted." },
    ],
  },
  props: {
    name: Property.ShortText({ displayName: "Project name", required: true }),
    request: Property.LongText({
      displayName: "Request",
      description: "Plain-English description of what to build/do.",
      required: true,
    }),
    template: Property.StaticDropdown({
      displayName: "Project template",
      required: false,
      options: {
        disabled: false,
        options: [
          { value: "website", label: "Website" },
          { value: "web_app", label: "Web app" },
          { value: "software", label: "Software" },
          { value: "research", label: "Research" },
          { value: "content", label: "Content" },
          { value: "data_project", label: "Data project" },
          { value: "automation", label: "Automation" },
          { value: "custom", label: "Custom" },
        ],
      },
    }),
    executionMode: Property.StaticDropdown({
      displayName: "Execution mode",
      description: "How often the Manager pauses for confirmation.",
      required: false,
      options: {
        disabled: false,
        options: [
          { value: "auto", label: "Auto" },
          { value: "assisted", label: "Assisted" },
          { value: "manual", label: "Manual" },
        ],
      },
    }),
  },
  async run(context) {
    const url = trimSlash(context.server.apiUrl) + "/v1/jarvis/manager/run-project";
    const name = context.propsValue["name"];
    const request = context.propsValue["request"];
    if (typeof name !== "string" || name.length === 0) {
      throw new Error("jarvis-manager: name is required and must be a non-empty string");
    }
    if (typeof request !== "string" || request.length === 0) {
      throw new Error("jarvis-manager: request is required and must be a non-empty string");
    }
    const body: Record<string, unknown> = { name, request };
    const template = context.propsValue["template"];
    if (typeof template === "string" && template.length > 0) body["template"] = template;
    const executionMode = context.propsValue["executionMode"];
    if (typeof executionMode === "string" && executionMode.length > 0) {
      body["execution_mode"] = executionMode;
    }

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${context.server.token}` },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`jarvis-manager: daemon responded ${response.status}: ${text.slice(0, 500)}`);
    }
    return await response.json();
  },
});

function trimSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}
