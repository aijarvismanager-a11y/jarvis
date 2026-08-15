/**
 * `run` action -- POST `{ cwd?, includeBuild?, lintScripts? }` to
 * `/v1/jarvis/qa/run` and return the QA report.
 */

import { createAction, Property } from "@activepieces/pieces-framework";

export const runAction = createAction({
  name: "run",
  displayName: "Run QA Checks",
  description:
    "Run typecheck/lint/(optionally build)/unit tests and static checks (broken links, missing files, config errors). Deterministic -- no LLM judgment involved.",
  outputSample: {
    passed: true,
    checks: [{ name: "typescript", automated: true, passed: true, summary: "No errors.", duration_ms: 4200 }],
    ran_at: 1745000000000,
  },
  props: {
    cwd: Property.ShortText({
      displayName: "Working directory",
      description: "Optional. Defaults to the daemon repo root.",
      required: false,
    }),
    includeBuild: Property.Checkbox({
      displayName: "Include build check",
      description: "Runs `bun run build:ui` -- slower and needs model assets. Off by default.",
      required: false,
      defaultValue: false,
    }),
    lintScripts: Property.Array({
      displayName: "Lint scripts",
      description: "Optional. Overrides the default guard-script list.",
      required: false,
    }),
  },
  async run(context) {
    const url = trimSlash(context.server.apiUrl) + "/v1/jarvis/qa/run";
    const body: Record<string, unknown> = {};
    const cwd = context.propsValue["cwd"];
    if (typeof cwd === "string" && cwd.length > 0) body["cwd"] = cwd;
    if (context.propsValue["includeBuild"] === true) body["includeBuild"] = true;
    const lintScripts = context.propsValue["lintScripts"];
    if (Array.isArray(lintScripts) && lintScripts.length > 0) body["lintScripts"] = lintScripts;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${context.server.token}` },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`jarvis-qa: daemon responded ${response.status}: ${text.slice(0, 500)}`);
    }
    return await response.json();
  },
});

function trimSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}
