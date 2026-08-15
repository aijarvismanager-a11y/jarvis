/**
 * `convene` action -- POST `{ question, seats?, template?, project_id?,
 * record? }` to `/v1/jarvis/council/convene` and return the verdict.
 */

import { createAction, Property } from "@activepieces/pieces-framework";

export const conveneAction = createAction({
  name: "convene",
  displayName: "Convene the AI Council",
  description:
    "Ask a question through multiple independent AI seats, then synthesize their answers (with contradictions flagged) into one verdict. Records the verdict as a Decision unless disabled.",
  outputSample: {
    question: "Should we use Postgres or SQLite for this project?",
    opinions: [{ seat: "cheap", mode: "cheap", tier: "low", content: "...", confidence: 0.7 }],
    synthesis: "Use SQLite for this project's scale...",
    contradictions: [],
    decision: { id: "dec_abc123", statement: "Use SQLite." },
  },
  props: {
    question: Property.LongText({ displayName: "Question", required: true }),
    seats: Property.Json({
      displayName: "Seats",
      description:
        'Optional. Array of {"mode":"cheap|balanced|quality","label"?}. Defaults to one seat per cost mode.',
      required: false,
    }),
    template: Property.StaticDropdown({
      displayName: "Task template",
      required: false,
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
    projectId: Property.ShortText({ displayName: "Project ID", required: false }),
    record: Property.Checkbox({
      displayName: "Record as Decision",
      required: false,
      defaultValue: true,
    }),
  },
  async run(context) {
    const url = trimSlash(context.server.apiUrl) + "/v1/jarvis/council/convene";
    const question = context.propsValue["question"];
    if (typeof question !== "string" || question.length === 0) {
      throw new Error("jarvis-council: question is required and must be a non-empty string");
    }
    const body: Record<string, unknown> = { question };
    const seats = context.propsValue["seats"];
    if (Array.isArray(seats) && seats.length > 0) body["seats"] = seats;
    const template = context.propsValue["template"];
    if (typeof template === "string" && template.length > 0) body["template"] = template;
    const projectId = context.propsValue["projectId"];
    if (typeof projectId === "string" && projectId.length > 0) body["project_id"] = projectId;
    if (context.propsValue["record"] === false) body["record"] = false;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${context.server.token}` },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`jarvis-council: daemon responded ${response.status}: ${text.slice(0, 500)}`);
    }
    return await response.json();
  },
});

function trimSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}
