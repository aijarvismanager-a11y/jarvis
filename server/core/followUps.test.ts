import { describe, expect, it } from "vitest";
import { FollowUpAsker, buildFollowUpPrompt, parseFollowUps } from "./followUps.ts";

describe("follow-up questions", () => {
  it("reads the questions out of Claude's json output", () => {
    const out = JSON.stringify({ result: '```json\n{"questions":["予算は?"," 対象は? ",3,""]}\n```' });
    expect(parseFollowUps(out)).toEqual(["予算は?", "対象は?"]);
    expect(parseFollowUps("not json")).toEqual([]);
  });
  it("sends the answer to a light model that may not edit files", async () => {
    const calls: { args: string[]; input?: string }[] = [];
    const runner = async (_c: string, args: string[], o: { input?: string }) => {
      calls.push({ args, input: o.input });
      if (args.includes("--help")) return { code: 0, stdout: "--print --output-format json --permission-mode plan (choices: \"plan\") --model --effort", stderr: "", timedOut: false };
      return { code: 0, stdout: JSON.stringify({ result: '{"questions":["どれを優先しますか?"]}' }), stderr: "", timedOut: false };
    };
    const qs = await new FollowUpAsker({ runner: runner as never }).ask("| a | b |\n|---|---|\n| 1 | 2 |");
    expect(qs).toEqual(["どれを優先しますか?"]);
    const run = calls[1]!;
    expect(run.args).toContain("plan");
    expect(run.input).toBe(buildFollowUpPrompt("| a | b |\n|---|---|\n| 1 | 2 |"));
  });
});
