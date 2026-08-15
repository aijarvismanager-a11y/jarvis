/**
 * `write` action -- POST `{ statement, project_id?, reason?, made_by? }`
 * to `/v1/jarvis/decision/write` and return the created Decision.
 */

import { createAction, Property } from "@activepieces/pieces-framework";

export const writeAction = createAction({
  name: "write",
  displayName: "Record a Decision",
  description: "Write a statement to Decision Memory, optionally scoped to a project.",
  outputSample: {
    id: "dec_abc123",
    project_id: "proj_1",
    statement: "Use SQLite for this project's scale.",
    reason: "AI Council verdict.",
    made_by: "workflow",
  },
  props: {
    statement: Property.LongText({ displayName: "Statement", required: true }),
    projectId: Property.ShortText({ displayName: "Project ID", required: false }),
    reason: Property.LongText({ displayName: "Reason", required: false }),
    madeBy: Property.ShortText({
      displayName: "Made by",
      description: "Defaults to 'manager'.",
      required: false,
    }),
  },
  async run(context) {
    const url = trimSlash(context.server.apiUrl) + "/v1/jarvis/decision/write";
    const statement = context.propsValue["statement"];
    if (typeof statement !== "string" || statement.length === 0) {
      throw new Error("jarvis-decision: statement is required and must be a non-empty string");
    }
    const body: Record<string, unknown> = { statement };
    const projectId = context.propsValue["projectId"];
    if (typeof projectId === "string" && projectId.length > 0) body["project_id"] = projectId;
    const reason = context.propsValue["reason"];
    if (typeof reason === "string" && reason.length > 0) body["reason"] = reason;
    const madeBy = context.propsValue["madeBy"];
    if (typeof madeBy === "string" && madeBy.length > 0) body["made_by"] = madeBy;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${context.server.token}` },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`jarvis-decision: daemon responded ${response.status}: ${text.slice(0, 500)}`);
    }
    return await response.json();
  },
});

function trimSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}
