/**
 * `request` action -- POST to `/v1/jarvis/approval/request` and block until
 * the request resolves (approved/denied/expired) or the timeout elapses.
 * The flow should branch on `status` afterward -- this action never
 * executes anything on the user's behalf.
 */

import { createAction, Property } from "@activepieces/pieces-framework";

interface ApprovalResponse {
  requestId: string;
  status: "approved" | "denied" | "expired" | "executed" | "pending";
}

export const requestAction = createAction({
  name: "request",
  displayName: "Request Approval",
  description:
    "Pause the flow and ask the user to approve or deny. Returns the resolved status (or 'pending' if the timeout elapsed first) -- branch on it downstream.",
  outputSample: { requestId: "appr_abc123", status: "approved" },
  props: {
    label: Property.ShortText({
      displayName: "Label",
      description: "Short name for what's being approved (shown as the tool name).",
      required: true,
    }),
    actionCategory: Property.StaticDropdown({
      displayName: "Action category",
      description: "Classifies impact for the dashboard's approval card.",
      required: true,
      options: {
        disabled: false,
        options: [
          { value: "read_data", label: "Read data" },
          { value: "write_data", label: "Write data" },
          { value: "delete_data", label: "Delete data" },
          { value: "send_message", label: "Send message" },
          { value: "send_email", label: "Send email" },
          { value: "execute_command", label: "Execute command" },
          { value: "install_software", label: "Install software" },
          { value: "make_payment", label: "Make payment" },
          { value: "modify_settings", label: "Modify settings" },
          { value: "spawn_agent", label: "Spawn agent" },
          { value: "terminate_agent", label: "Terminate agent" },
          { value: "access_browser", label: "Access browser" },
          { value: "control_app", label: "Control app" },
          { value: "git_operation", label: "Git operation" },
        ],
      },
    }),
    reason: Property.LongText({ displayName: "Reason", required: true }),
    context: Property.LongText({
      displayName: "Context",
      description: "Extra detail shown alongside the reason.",
      required: false,
    }),
    arguments: Property.Json({
      displayName: "Arguments",
      description: "Optional structured detail about what's being approved.",
      required: false,
    }),
    urgency: Property.StaticDropdown({
      displayName: "Urgency",
      required: false,
      options: {
        disabled: false,
        options: [
          { value: "normal", label: "Normal" },
          { value: "urgent", label: "Urgent" },
        ],
      },
    }),
    timeoutMs: Property.Number({
      displayName: "Timeout (ms)",
      description: "Defaults to 5 minutes.",
      required: false,
    }),
  },
  async run(context) {
    const url = trimSlash(context.server.apiUrl) + "/v1/jarvis/approval/request";
    const label = context.propsValue["label"];
    const actionCategory = context.propsValue["actionCategory"];
    const reason = context.propsValue["reason"];
    if (typeof label !== "string" || label.length === 0) {
      throw new Error("jarvis-approval: label is required and must be a non-empty string");
    }
    if (typeof actionCategory !== "string" || actionCategory.length === 0) {
      throw new Error("jarvis-approval: actionCategory is required");
    }
    if (typeof reason !== "string" || reason.length === 0) {
      throw new Error("jarvis-approval: reason is required and must be a non-empty string");
    }
    const body: Record<string, unknown> = { toolName: label, actionCategory, reason };
    const ctxDetail = context.propsValue["context"];
    if (typeof ctxDetail === "string" && ctxDetail.length > 0) body["context"] = ctxDetail;
    const args = context.propsValue["arguments"];
    if (typeof args === "object" && args !== null && !Array.isArray(args)) body["arguments"] = args;
    const urgency = context.propsValue["urgency"];
    if (typeof urgency === "string" && urgency.length > 0) body["urgency"] = urgency;
    const timeoutMs = context.propsValue["timeoutMs"];
    if (typeof timeoutMs === "number" && Number.isFinite(timeoutMs) && timeoutMs > 0) {
      body["timeoutMs"] = timeoutMs;
    }

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${context.server.token}` },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`jarvis-approval: daemon responded ${response.status}: ${text.slice(0, 500)}`);
    }
    return (await response.json()) as ApprovalResponse;
  },
});

function trimSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}
