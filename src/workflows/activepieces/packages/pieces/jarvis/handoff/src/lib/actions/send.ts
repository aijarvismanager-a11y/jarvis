/**
 * `send` action -- POST the Handoff envelope to `/v1/jarvis/handoff/send`.
 */

import { createAction, Property } from "@activepieces/pieces-framework";

export const sendAction = createAction({
  name: "send",
  displayName: "File a Handoff",
  description:
    "Record a structured handoff: what was done, what's next, and any artifacts/decisions/warnings/open questions -- the Manager evaluates this before advancing the task.",
  outputSample: { id: "msg_abc123" },
  props: {
    taskId: Property.ShortText({ displayName: "Task ID", required: true }),
    fromAgent: Property.ShortText({ displayName: "From agent", required: true }),
    toAgent: Property.ShortText({ displayName: "To agent", required: true }),
    status: Property.StaticDropdown({
      displayName: "Status",
      required: true,
      options: {
        disabled: false,
        options: [
          { value: "completed", label: "Completed" },
          { value: "failed", label: "Failed" },
          { value: "needs_input", label: "Needs input" },
        ],
      },
    }),
    summary: Property.LongText({ displayName: "Summary", required: true }),
    nextAction: Property.ShortText({ displayName: "Next action", required: true }),
    instructions: Property.Array({ displayName: "Instructions", required: false }),
    artifacts: Property.Array({ displayName: "Artifacts", required: false }),
    decisions: Property.Array({ displayName: "Decisions", required: false }),
    warnings: Property.Array({ displayName: "Warnings", required: false }),
    openQuestions: Property.Array({ displayName: "Open questions", required: false }),
    projectId: Property.ShortText({ displayName: "Project ID", required: false }),
    priority: Property.StaticDropdown({
      displayName: "Priority",
      required: false,
      options: {
        disabled: false,
        options: [
          { value: "low", label: "Low" },
          { value: "normal", label: "Normal" },
          { value: "high", label: "High" },
          { value: "urgent", label: "Urgent" },
        ],
      },
    }),
  },
  async run(context) {
    const url = trimSlash(context.server.apiUrl) + "/v1/jarvis/handoff/send";
    const taskId = context.propsValue["taskId"];
    const fromAgent = context.propsValue["fromAgent"];
    const toAgent = context.propsValue["toAgent"];
    const status = context.propsValue["status"];
    const summary = context.propsValue["summary"];
    const nextAction = context.propsValue["nextAction"];
    for (const [name, value] of [
      ["taskId", taskId],
      ["fromAgent", fromAgent],
      ["toAgent", toAgent],
      ["status", status],
      ["summary", summary],
      ["nextAction", nextAction],
    ] as const) {
      if (typeof value !== "string" || value.length === 0) {
        throw new Error(`jarvis-handoff: ${name} is required and must be a non-empty string`);
      }
    }
    const body: Record<string, unknown> = {
      task_id: taskId,
      from_agent: fromAgent,
      to_agent: toAgent,
      status,
      summary,
      next_action: nextAction,
    };
    const instructions = context.propsValue["instructions"];
    if (Array.isArray(instructions) && instructions.length > 0) body["instructions"] = instructions;
    const artifacts = context.propsValue["artifacts"];
    if (Array.isArray(artifacts) && artifacts.length > 0) body["artifacts"] = artifacts;
    const decisions = context.propsValue["decisions"];
    if (Array.isArray(decisions) && decisions.length > 0) body["decisions"] = decisions;
    const warnings = context.propsValue["warnings"];
    if (Array.isArray(warnings) && warnings.length > 0) body["warnings"] = warnings;
    const openQuestions = context.propsValue["openQuestions"];
    if (Array.isArray(openQuestions) && openQuestions.length > 0) body["open_questions"] = openQuestions;
    const projectId = context.propsValue["projectId"];
    if (typeof projectId === "string" && projectId.length > 0) body["project_id"] = projectId;
    const priority = context.propsValue["priority"];
    if (typeof priority === "string" && priority.length > 0) body["priority"] = priority;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${context.server.token}` },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`jarvis-handoff: daemon responded ${response.status}: ${text.slice(0, 500)}`);
    }
    return await response.json();
  },
});

function trimSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}
