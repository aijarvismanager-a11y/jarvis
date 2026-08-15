/**
 * `commit` action -- POST `{ repoPath, message, all? }` to
 * `/v1/jarvis/git/commit`.
 */

import { createAction, Property } from "@activepieces/pieces-framework";

interface GitResultLike {
  ok: boolean;
  output: string;
  error?: string;
}

export const commitAction = createAction({
  name: "commit",
  displayName: "Git Commit",
  description: "Stage all changes and create a commit in a local git repository.",
  outputSample: { ok: true, output: "[main abc1234] message" },
  props: {
    repoPath: Property.ShortText({
      displayName: "Repository path",
      description: "Absolute path to the local git repository.",
      required: true,
    }),
    message: Property.LongText({ displayName: "Commit message", required: true }),
    all: Property.Checkbox({
      displayName: "Stage all changes (-A)",
      required: false,
      defaultValue: true,
    }),
  },
  async run(context) {
    const url = trimSlash(context.server.apiUrl) + "/v1/jarvis/git/commit";
    const repoPath = context.propsValue["repoPath"];
    const message = context.propsValue["message"];
    if (typeof repoPath !== "string" || repoPath.length === 0) {
      throw new Error("jarvis-git: repoPath is required and must be a non-empty string");
    }
    if (typeof message !== "string" || message.length === 0) {
      throw new Error("jarvis-git: message is required and must be a non-empty string");
    }
    const body: Record<string, unknown> = { repoPath, message };
    if (context.propsValue["all"] === false) body["all"] = false;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${context.server.token}` },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`jarvis-git: daemon responded ${response.status}: ${text.slice(0, 500)}`);
    }
    return (await response.json()) as GitResultLike;
  },
});

function trimSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}
