/**
 * `write` action -- POST `{ subjectId, predicate, object, confidence?,
 * source? }` to `/v1/jarvis/memory/write` and return the created Fact.
 */

import { createAction, Property } from "@activepieces/pieces-framework";

export const writeAction = createAction({
  name: "write",
  displayName: "Write a Memory Fact",
  description: "Add a subject/predicate/object fact to the vault knowledge graph.",
  outputSample: {
    id: "fact_abc123",
    subject_id: "entity_1",
    predicate: "prefers",
    object: "dark mode",
    confidence: 1,
  },
  props: {
    subjectId: Property.ShortText({
      displayName: "Subject entity ID",
      description: "Must be an existing vault entity id.",
      required: true,
    }),
    predicate: Property.ShortText({ displayName: "Predicate", required: true }),
    object: Property.LongText({ displayName: "Object", required: true }),
    confidence: Property.Number({
      displayName: "Confidence (0-1)",
      required: false,
    }),
    source: Property.ShortText({ displayName: "Source", required: false }),
  },
  async run(context) {
    const url = trimSlash(context.server.apiUrl) + "/v1/jarvis/memory/write";
    const subjectId = context.propsValue["subjectId"];
    const predicate = context.propsValue["predicate"];
    const object = context.propsValue["object"];
    if (typeof subjectId !== "string" || subjectId.length === 0) {
      throw new Error("jarvis-memory: subjectId is required and must be a non-empty string");
    }
    if (typeof predicate !== "string" || predicate.length === 0) {
      throw new Error("jarvis-memory: predicate is required and must be a non-empty string");
    }
    if (typeof object !== "string" || object.length === 0) {
      throw new Error("jarvis-memory: object is required and must be a non-empty string");
    }
    const body: Record<string, unknown> = { subjectId, predicate, object };
    const confidence = context.propsValue["confidence"];
    if (typeof confidence === "number" && Number.isFinite(confidence)) body["confidence"] = confidence;
    const source = context.propsValue["source"];
    if (typeof source === "string" && source.length > 0) body["source"] = source;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${context.server.token}` },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`jarvis-memory: daemon responded ${response.status}: ${text.slice(0, 500)}`);
    }
    return await response.json();
  },
});

function trimSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}
