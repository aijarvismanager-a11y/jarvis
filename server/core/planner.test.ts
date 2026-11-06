import { describe, expect, it } from "vitest";
import { HISTORY_TASK_KEY, withHistoryUpdateTask, ClaudeCodePlanner, buildPlannerPrompt, extractPlanJson, needsShell, parseCliCapabilities, spawnRunner, type CommandRunner } from "./planner.ts";

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
    expect(parseCliCapabilities(HELP)).toMatchObject({ print: true, outputFormatJson: true, jsonSchema: true, permissionModePlan: true, noSessionPersistence: true });
  });
  it("reports nothing for an unrelated help text", () => {
    expect(parseCliCapabilities("Usage: other [options]")).toMatchObject({ print: false, outputFormatJson: false, jsonSchema: false, permissionModePlan: false, noSessionPersistence: false });
  });
  it("does not treat a similarly named flag as supported", () => {
    expect(parseCliCapabilities("  --print-extra  foo").print).toBe(false);
  });
});

describe("ClaudeCodePlanner", () => {
  it("builds args only from detected capabilities and sends the prompt on stdin", async () => {
    const { runner, calls } = fakeRunner(PLAN);
    const draft = await new ClaudeCodePlanner({ runner }).plan({ goal: "商品管理アプリ", constraints: [], technologyPreferences: [] });
    expect(draft.tasks).toHaveLength(3); // + the last step that starts the new project's CHANGELOG.md
    expect(draft.tasks[2]!.objective).toContain("CHANGELOG.md が無ければ新しく作り");
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

  it("says so when the planning ran out of time, instead of an empty crash message", async () => {
    const runner: CommandRunner = async (_c, args) => (args[0] === "--help" ? { stdout: HELP, stderr: "", code: 0 } : { stdout: "", stderr: "", code: null, timedOut: true });
    await expect(new ClaudeCodePlanner({ runner, timeoutMs: 600_000 }).plan({ goal: "g", constraints: [], technologyPreferences: [] })).rejects.toThrow(/タイムアウト.*10分/);
  });

  it("gives an existing project 20 minutes to be read and planned, a new idea 5", async () => {
    const seen: number[] = [];
    const runner: CommandRunner = async (_c, args, opts) => {
      if (args[0] === "--help") return { stdout: HELP, stderr: "", code: 0 };
      seen.push(opts.timeoutMs ?? 0);
      return { stdout: JSON.stringify({ type: "result", result: JSON.stringify(PLAN) }), stderr: "", code: 0 };
    };
    const planner = new ClaudeCodePlanner({ runner });
    await planner.plan({ goal: "g", constraints: [], technologyPreferences: [] });
    await planner.plan({ goal: "g", constraints: [], technologyPreferences: [], existingProject: true });
    expect(seen).toEqual([5 * 60_000, 20 * 60_000]);
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

  it("plans from the project folder, and asks once more when the answer was prose", async () => {
    const cwds: (string | undefined)[] = [];
    let asked = 0;
    const runner: CommandRunner = async (_c, args, opts) => {
      if (args[0] === "--help") return { stdout: HELP, stderr: "", code: 0 };
      cwds.push(opts.cwd);
      asked += 1;
      // first answer: a question in prose (what the model does when it is unsure); second: the plan
      const result = asked === 1 ? "どのファイルを変更してよいですか?" : "```json\n" + JSON.stringify(PLAN) + "\n```";
      return { stdout: JSON.stringify({ type: "result", result }), stderr: "", code: 0 };
    };
    const draft = await new ClaudeCodePlanner({ runner, cwd: "C:/orchestrator" }).plan({ goal: "g", constraints: [], technologyPreferences: [], cwd: "C:/projects/p1", existingProject: true });
    expect(draft.tasks).toHaveLength(PLAN.tasks.length + 1); // the plan changes code, so the project's own history is brought up to date last
    expect(cwds).toEqual(["C:/projects/p1", "C:/projects/p1"]);
    expect(buildPlannerPrompt({ goal: "g", constraints: [], technologyPreferences: [], existingProject: true })).toContain("既存のプロジェクト");
  });

  it("gives up after the second prose answer and shows how it began", async () => {
    const runner: CommandRunner = async (_c, args) => (args[0] === "--help" ? { stdout: HELP, stderr: "", code: 0 } : { stdout: JSON.stringify({ result: "質問があります" }), stderr: "", code: 0 });
    await expect(new ClaudeCodePlanner({ runner }).plan({ goal: "g", constraints: [], technologyPreferences: [] })).rejects.toThrow(/質問があります/);
  });

  it("surfaces a non-zero exit code", async () => {
    const runner: CommandRunner = async (_c, args) => (args[0] === "--help" ? { stdout: HELP, stderr: "", code: 0 } : { stdout: "", stderr: "not logged in", code: 1 });
    await expect(new ClaudeCodePlanner({ runner }).plan({ goal: "g", constraints: [], technologyPreferences: [] })).rejects.toThrow(/ログイン/); // recognised problems are explained in plain words
    const odd: CommandRunner = async (_c, args) => (args[0] === "--help" ? { stdout: HELP, stderr: "", code: 0 } : { stdout: "", stderr: "disk exploded", code: 3 });
    await expect(new ClaudeCodePlanner({ runner: odd }).plan({ goal: "g", constraints: [], technologyPreferences: [] })).rejects.toThrow(/code=3.*disk exploded/);
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

describe("withHistoryUpdateTask", () => {
  const draft = (roles: string[]) => ({ summary: "", tasks: roles.map((role, i) => ({ key: `t${i}`, role, objective: "x", inputs: [], expectedOutputs: [], constraints: [], dependsOn: [] })) });
  it("adds one last step that updates the project's own records when the plan changes code", () => {
    const out = withHistoryUpdateTask(draft(["research", "coding"]));
    const last = out.tasks[out.tasks.length - 1]!;
    expect(last.key).toBe(HISTORY_TASK_KEY);
    expect(last.dependsOn).toEqual(["t0", "t1"]);
    expect(last.objective).toContain("TESTLOG");
    expect(last.expectedOutputs).toEqual([]);
    expect(withHistoryUpdateTask(out).tasks).toHaveLength(3); // not added twice
  });
  it("leaves plans that change no code alone", () => {
    expect(withHistoryUpdateTask(draft(["research", "design"])).tasks).toHaveLength(2);
  });
});
