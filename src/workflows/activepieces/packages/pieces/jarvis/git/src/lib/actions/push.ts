/**
 * `push` action -- POST `{ repoPath, remote?, branch?, setUpstream? }` to
 * `/v1/jarvis/git/push`. The daemon backend gates this through
 * AuthorityEngine/ApprovalManager (require_approval by default) before
 * actually pushing -- this action just waits for the HTTP response, same
 * as any other approval-gated tool call.
 */

import { createAction, Property } from "@activepieces/pieces-framework";

interface GitResultLike {
  ok: boolean;
  output: string;
  error?: string;
}

export const pushAction = createAction({
  name: "push",
  displayName: "Git Push",
  description:
    "Push the current branch to its remote. Requires user approval by default (Jarvis's git safety rules) -- this step blocks until that resolves.",
  outputSample: { ok: true, output: "To github.com:org/repo.git\n   abc1234..def5678  main -> main" },
  props: {
    repoPath: Property.ShortText({
      displayName: "Repository path",
      description: "Absolute path to the local git repository.",
      required: true,
    }),
    remote: Property.ShortText({ displayName: "Remote", description: "Defaults to origin.", required: false }),
    branch: Property.ShortText({
      displayName: "Branch",
      description: "Defaults to the current branch.",
      required: false,
    }),
    setUpstream: Property.Checkbox({ displayName: "Set upstream (-u)", required: false }),
  },
  async run(context) {
    const url = trimSlash(context.server.apiUrl) + "/v1/jarvis/git/push";
    const repoPath = context.propsValue["repoPath"];
    if (typeof repoPath !== "string" || repoPath.length === 0) {
      throw new Error("jarvis-git: repoPath is required and must be a non-empty string");
    }
    const body: Record<string, unknown> = { repoPath };
    const remote = context.propsValue["remote"];
    if (typeof remote === "string" && remote.length > 0) body["remote"] = remote;
    const branch = context.propsValue["branch"];
    if (typeof branch === "string" && branch.length > 0) body["branch"] = branch;
    if (context.propsValue["setUpstream"] === true) body["setUpstream"] = true;

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
