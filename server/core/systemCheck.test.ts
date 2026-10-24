import { describe, expect, it } from "vitest";
import type { CommandRunner } from "./commandRunner.ts";
import { SystemCheck, explainClaudeFailure } from "./systemCheck.ts";

const runner = (answers: Record<string, { stdout?: string; code?: number } | "throw">): CommandRunner => async (_c, args) => {
  const a = answers[args[0] ?? ""];
  if (a === "throw" || !a) throw new Error("ENOENT");
  return { stdout: a.stdout ?? "", stderr: "", code: a.code ?? 0 };
};

describe("SystemCheck", () => {
  it("is ready when installed and logged in, and reuses that answer", async () => {
    let calls = 0;
    const base = runner({ "--version": { stdout: "2.1.309 (Claude Code)" }, auth: { stdout: '{"loggedIn":true}' } });
    const check = new SystemCheck(async (...a) => (calls++, base(...a)));
    expect(await check.claude()).toEqual({ state: "ready", version: "2.1.309" });
    await check.claude();
    expect(calls).toBe(2); // version + auth once; the second ask came from the cache
  });

  it("says what to do when it is missing or not signed in", async () => {
    expect((await new SystemCheck(runner({})).claude()).state).toBe("not_installed");
    const out = await new SystemCheck(runner({ "--version": { stdout: "2.1.309" }, auth: { stdout: '{"loggedIn":false}' } })).claude();
    expect(out.state).toBe("not_logged_in");
    expect((out as { message: string }).message).toContain("ログイン");
    expect((await new SystemCheck(runner({ "--version": { stdout: "1.0" }, auth: { stdout: "not json" } })).claude()).state).toBe("unknown");
  });
});

describe("explainClaudeFailure", () => {
  it("recognises sign-in, limit and missing-command problems", () => {
    expect(explainClaudeFailure("Error: Not logged in · Please run /login")).toContain("ログイン");
    expect(explainClaudeFailure("429 rate limit exceeded")).toContain("上限");
    expect(explainClaudeFailure("'claude' is not recognized as an internal command")).toContain("見つかりません");
    expect(explainClaudeFailure("something else")).toBeNull();
  });
});
