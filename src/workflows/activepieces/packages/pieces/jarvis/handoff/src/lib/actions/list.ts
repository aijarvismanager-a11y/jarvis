/**
 * `list` action -- POST `{ task_id }` to `/v1/jarvis/handoff/list` and
 * return every Handoff filed for that task, oldest first. Used as a
 * "Review" step: inspect what a prior agent reported before deciding to
 * approve or re-run.
 */

import { createAction, Property } from "@activepieces/pieces-framework";

export const listAction = createAction({
  name: "list",
  displayName: "Review Handoffs for a Task",
  description: "List every handoff filed for a task, oldest first.",
  outputSample: {
    handoffs: [
      {
        task_id: "task_1",
        from_agent: "task_code",
        to_agent: "manager",
        status: "completed",
        summary: "Implemented the feature.",
        next_action: "advance",
      },
    ],
  },
  props: {
    taskId: Property.ShortText({ displayName: "Task ID", required: true }),
  },
  async run(context) {
    const url = trimSlash(context.server.apiUrl) + "/v1/jarvis/handoff/list";
    const taskId = context.propsValue["taskId"];
    if (typeof taskId !== "string" || taskId.length === 0) {
      throw new Error("jarvis-handoff: taskId is required and must be a non-empty string");
    }
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${context.server.token}` },
      body: JSON.stringify({ task_id: taskId }),
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
