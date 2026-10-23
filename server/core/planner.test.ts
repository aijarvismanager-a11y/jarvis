import { describe, expect, it } from "vitest";
import { ClaudeCodePlanner, buildPlannerPrompt, extractPlanJson, needsShell, parseCliCapabilities, spawnRunner, type CommandRunner } from "./planner.ts";

// Excerpt of a real `claude --help` (v2.x): the planner must derive its flags from this, not assume them.
const HELP = `Usage: claude [options] [command] [prompt]
Options:
  --json-schema <schema>                JSON Schema for structured output
                                        validation (only works with --print).
  --no-session-persistence              Disable session persistence
  --output-format <format>              Output format (only works with --print):
                                        "text" (default), "json" (single
                                        result), or "stream-json" (realtime
                                        streaming) (choices: "text", "json",
                                        "stream-json")
  --permission-mode <mode>              Permission mode to use for the session
                                        (choices: "acceptEdits", "auto",
                                        "bypassPermissions", "manual",
                                        "dontAsk", "plan")
  -p, --print                           Print response and exit
`;

const PLAN = { summary: "s", tasks: [{ key: "a", role: "design", objective: "o" }, { key: "b", role: "coding", objective: "o2", dependsOn: ["a"] }] };

function fakeRunner(plan: unknown, help = HELP): { runner: CommandRunner; calls: { args: string[]; input?: string }[] } {
  const calls: { args: string[]; input?: string }[] = [];
  const runner: CommandRunner = async (_c, args, opts) => {
    calls.push({ args, input: opts.input });
    if (args[0] === "--help") return { stdout: help, stderr: "", code: 0 };
    return { stdout: JSON.stringify({ type: "result", result: "```json\n" + JSON.stringify(plan) + "\n```" }), stderr: "", code: 0 };
  };
  return { runner, calls };
}

describe("parseCliCapabilities", () => {
  it("detects flags present in the help text", () => {
    expect(parseCliCapabilities(HELP)).toEqual({ print: true, outputFormatJson: true, jsonSchema: true, permissionModePlan: true, noSessionPersistence: true });
  });
  it("reports nothing for an unrelated help text", () => {
    expect(parseCliCapabilities("Usage: other [options]")).toEqual({ print: false, outputFormatJson: false, jsonSchema: false, permissionModePlan: false, noSessionPersistence: false });
  });
  it("does not treat a similarly named flag as supported", () => {
    expect(parseCliCapabilities("  --print-extra  foo").print).toBe(false);
  });
});

describe("ClaudeCodePlanner", () => {
  it("builds args only from detected capabilities and sends the prompt on stdin", async () => {
    const { runner, calls } = fakeRunner(PLAN);
    const draft = await new ClaudeCodePlanner({ runner }).plan({ goal: "商品管理アプリ", constraints: [], technologyPreferences: [] });
    expect(draft.tasks).toHaveLength(2);
    expect(calls[0].args).toEqual(["--help"]);
    const run = calls[1];
    expect(run.args).toContain("--print");
    expect(run.args).toContain("--permission-mode");
    expect(run.args[run.args.indexOf("--permission-mode") + 1]).toBe("plan");
    expect(run.input).toContain("商品管理アプリ");
    expect(run.args.join(" ")).not.toContain("商品管理アプリ");
  });

  it("passes the JSON schema only when no shell is involved", () => {
    const caps = parseCliCapabilities(HELP);
    const planner = new ClaudeCodePlanner();
    expect(planner.buildArgs(caps, false)).toContain("--json-schema");
    expect(planner.buildArgs(caps, true)).not.toContain("--json-schema");
    expect(needsShell("claude", "win32")).toBe(true);
    expect(needsShell("C:/x/claude.exe", "win32")).toBe(false);
    expect(needsShell("claude", "linux")).toBe(false);
  });

  it("caches the help lookup", async () => {
    const { runner, calls } = fakeRunner(PLAN);
    const p = new ClaudeCodePlanner({ runner });
    await p.plan({ goal: "g", constraints: [], technologyPreferences: [] });
    await p.plan({ goal: "g", constraints: [], technologyPreferences: [] });
    expect(calls.filter((c) => c.args[0] === "--help")).toHaveLength(1);
  });

  it("refuses to plan when read-only plan mode is unavailable", async () => {
    const { runner } = fakeRunner(PLAN, "  -p, --print   Print\n");
    await expect(new ClaudeCodePlanner({ runner }).plan({ goal: "g", constraints: [], technologyPreferences: [] })).rejects.toThrow(/plan/);
  });

  it("refuses when --print is unsupported", async () => {
    const { runner } = fakeRunner(PLAN, "Usage: claude");
    await expect(new ClaudeCodePlanner({ runner }).plan({ goal: "g", constraints: [], technologyPreferences: [] })).rejects.toThrow();
  });

  it("rejects cyclic or malformed plans from the model", async () => {
    const cyc = { tasks: [{ key: "a", role: "r", dependsOn: ["b"] }, { key: "b", role: "r", dependsOn: ["a"] }] };
    await expect(new ClaudeCodePlanner({ runner: fakeRunner(cyc).runner }).plan({ goal: "g", constraints: [], technologyPreferences: [] })).rejects.toThrow(/循環/);
    await expect(new ClaudeCodePlanner({ runner: fakeRunner({ nope: 1 }).runner }).plan({ goal: "g", constraints: [], technologyPreferences: [] })).rejects.toThrow(/解釈/);
  });

  it("surfaces a non-zero exit code", async () => {
    const runner: CommandRunner = async (_c, args) => (args[0] === "--help" ? { stdout: HELP, stderr: "", code: 0 } : { stdout: "", stderr: "not logged in", code: 1 });
    await expect(new ClaudeCodePlanner({ runner }).plan({ goal: "g", constraints: [], technologyPreferences: [] })).rejects.toThrow(/not logged in/);
  });
});

describe("helpers", () => {
  it("extractPlanJson handles structured_output, fenced and bare json", () => {
    expect(extractPlanJson(JSON.stringify({ structured_output: PLAN }))).toEqual(PLAN);
    expect(extractPlanJson(JSON.stringify({ result: "text " + JSON.stringify(PLAN) + " end" }))).toEqual(PLAN);
    expect(extractPlanJson(JSON.stringify(PLAN))).toEqual(PLAN);
    expect(extractPlanJson("garbage")).toBeUndefined();
  });
  it("the replan prompt carries context", () => {
    const p = buildPlannerPrompt({ goal: "g", constraints: ["c1"], technologyPreferences: ["ts"], completed: [{ role: "design", objective: "d" }], failed: [{ role: "coding", objective: "x", reason: "boom" }], feedback: "もっと小さく" });
    for (const s of ["c1", "ts", "design", "boom", "もっと小さく"]) expect(p).toContain(s);
  });
});

describe("real claude --help (read-only, no model call)", () => {
  it("is parseable when claude is installed", async () => {
    let res;
    try {
      res = await spawnRunner("claude", ["--help"], { timeoutMs: 30_000 });
    } catch {
      return; // claude not installed in this environment
    }
    if (res.code !== 0) return;
    expect(parseCliCapabilities(res.stdout).print).toBe(true);
  }, 40_000);
});
