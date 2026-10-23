import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AIBroker } from "./aiBroker.ts";
import { AiDiscovery, CatalogSource } from "./aiDiscovery.ts";
import { seedRegistryProfiles } from "./aiRegistry.ts";
import { ClaudeCodeExecutor } from "./claudeCodeExecutor.ts";
import type { CommandRunner } from "./commandRunner.ts";
import { openDatabase, type Db } from "./db.ts";
import { MissionEngine, type ExecutionResult, type TaskExecutor } from "./missionEngine.ts";
import type { Planner } from "./planner.ts";
import { Store, type Task } from "./store.ts";
import { ProjectValidator } from "./taskValidator.ts";
import type { PlanDraft } from "./taskGraph.ts";
import { RoutingExecutor, WebAiExecutor } from "./webAiExecutor.ts";
import { WebHandoffHub } from "./webHandoff.ts";
import { setWebAiSettings } from "./webAiSites.ts";

// Phase 8: the spec's Test 1-7 (§62), run through the real engine, store, Claude Code
// executor and validator. Only the outside world is faked: the `claude`/`npm` processes and the web.

const HELP = `
  --allowedTools, --allowed-tools <tools...>  allow
  --disallowedTools, --disallowed-tools <tools...>  deny
  --no-session-persistence   x
  --output-format <format>   (choices: "text", "json", "stream-json")
  --permission-mode <mode>   (choices: "acceptEdits", "auto", "plan")
  --permission-prompts <target>  "host" or "none"
  -p, --print                Print response and exit
`;

let root: string;
let db: Db;
let store: Store;
beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "phase8-"));
  db = openDatabase(":memory:");
  store = new Store(db, root);
});
afterEach(() => {
  db.close();
  rmSync(root, { recursive: true, force: true });
});

const step = (key: string, role: string, objective: string, dependsOn: string[] = [], expectedOutputs: string[] = []) => ({ key, role, objective, inputs: [], expectedOutputs, constraints: [], dependsOn });
const planner = (draft: PlanDraft): Planner => ({ name: "scripted", plan: async () => draft });

/** Stand-in for the `claude` CLI: `onRun` plays the part of Claude Code editing files in the project dir. */
function fakeClaude(onRun: (call: { cwd: string; input: string; attempt: number }) => { code?: number; stderr?: string } | void) {
  let attempt = 0;
  const runner: CommandRunner = async (_c, args, opts) => {
    if (args[0] === "--help") return { stdout: HELP, stderr: "", code: 0 };
    attempt++;
    const r = onRun({ cwd: opts.cwd!, input: opts.input ?? "", attempt }) ?? {};
    return { stdout: JSON.stringify({ is_error: (r.code ?? 0) !== 0, result: `run ${attempt}` }), stderr: r.stderr ?? "", code: r.code ?? 0 };
  };
  return { runner, runs: () => attempt };
}
const put = (cwd: string, rel: string, body: string) => {
  mkdirSync(path.dirname(path.join(cwd, rel)), { recursive: true });
  writeFileSync(path.join(cwd, rel), body);
};
const tasksOf = (pid: string, mid: string) => store.listTasks(pid).filter((t) => t.missionId === mid);

describe("Test 1: simple website", () => {
  it("mission -> task graph -> Claude Code implements -> validation -> completed", async () => {
    store.createProject({ id: "site", name: "自己紹介サイト" });
    const { runner } = fakeClaude(({ cwd, input }) => {
      if (input.includes("HTMLを実装")) put(cwd, "code/index.html", "<!doctype html><title>me</title><h1>自己紹介</h1>");
      else put(cwd, "design/design.md", "# デザイン\n単一ページ");
    });
    const engine = new MissionEngine(store, {
      planner: planner({ summary: "", tasks: [step("d", "design", "デザインを決める", [], ["design/design.md"]), step("c", "coding", "HTMLを実装", ["d"], ["code/index.html"])] }),
      executor: new ClaudeCodeExecutor(store, { runner }),
      validator: new ProjectValidator(root, { runner: async () => ({ stdout: "", stderr: "", code: 0 }) }),
    });
    const { mission, proposal } = await engine.createMission({ projectId: "site", goal: "簡単な自己紹介サイトを作って" });
    expect(proposal.draft.tasks).toHaveLength(2);
    expect(tasksOf("site", mission.id)).toHaveLength(0); // nothing exists before approval
    engine.approvePlan("site", mission.id);
    expect(await engine.run("site", mission.id)).toBe("completed");
    expect(tasksOf("site", mission.id).map((t) => t.status)).toEqual(["completed", "completed"]);
    expect(readFileSync(path.join(root, "site", "code", "index.html"), "utf8")).toContain("自己紹介");
    expect(store.listArtifacts("site").map((a) => a.path).sort()).toEqual(["code/index.html", "design/design.md"]);
    expect(store.listValidations("site").every((v) => v.status === "passed")).toBe(true);
  });
});

describe("Test 2: research -> AI Discovery -> AI selection -> Artifact", () => {
  it("finds a missing capability on demand, then routes research to a web AI and saves the answer as an Artifact", async () => {
    store.createProject({ id: "r", name: "調査サイト" });
    store.upsertAiService({ id: "claude-code", name: "Claude Code (CLI)", accessMode: "cli", adapterType: "claude-code" });
    store.upsertAiService({ id: "gemini", name: "Gemini (Web)", url: "https://gemini.test" });
    seedRegistryProfiles(store);

    // Discovery only runs for a capability the registry lacks, and only saves what passes the free-tier check
    const fetchImpl = (async () => new Response("<p>Free plan: 20 messages per day. Pro plan $20 per month for more.</p>", { status: 200 })) as unknown as typeof fetch;
    const discovery = new AiDiscovery(store, { fetchImpl, sources: [new CatalogSource([{ id: "ocrbot", name: "OcrBot", url: "https://ocrbot.example.test", capabilities: { ocr: 4 } }])] });
    expect((await discovery.discover({ requiredCapabilities: ["research"] })).source).toBe("registry");
    const found = await discovery.discover({ requiredCapabilities: ["ocr"], save: true });
    expect(found.saved).toEqual(["ocrbot"]);
    expect(store.getAiService("ocrbot")).toMatchObject({ freeStatus: "free_tier", requiresApiKey: false });

    // the research task is the web AI's job (Claude Code is code-only here)
    store.setCapabilities("claude-code", { coding: 5 });
    setWebAiSettings(store, { enabled: true });
    const hub = new WebHandoffHub(store);
    const code: TaskExecutor = { name: "claude-code", adapterTypes: ["claude-code"], execute: async () => ({ ok: true }) };
    const engine = new MissionEngine(store, {
      planner: planner({ summary: "", tasks: [step("r", "research", "最新情報を調査", [], ["research/latest.md"])] }),
      executor: new RoutingExecutor(store, code, new WebAiExecutor(store, hub)),
      broker: new AIBroker(store),
    });
    const { mission } = await engine.createMission({ projectId: "r", goal: "最新情報を調査して表示するサイトを作って" });
    engine.approvePlan("r", mission.id);
    const done = engine.run("r", mission.id);
    let handoff = hub.list({ status: "pending" })[0];
    for (let i = 0; i < 300 && !handoff; i++) {
      await new Promise((r) => setTimeout(r, 20));
      handoff = hub.list({ status: "pending" })[0];
    }
    expect(handoff.aiId).toBe("gemini");
    hub.submit(handoff.id, "# 最新情報\n- 事実A");
    expect(await done).toBe("completed");
    const art = store.listArtifacts("r").find((a) => a.path === "research/latest.md")!;
    expect(art).toMatchObject({ sourceAi: "gemini" });
    expect(readFileSync(path.join(root, "r", "research", "latest.md"), "utf8")).toContain("事実A");
    expect(store.listDecisions("r").some((d) => String(d.title).includes("AI選定"))).toBe(true);
  });
});

describe("Test 3: AI failure -> fallback -> retry", () => {
  it("a failing AI is skipped on the retry and the next-best AI finishes the task", async () => {
    store.createProject({ id: "f", name: "f" });
    store.upsertAiService({ id: "claude-code", name: "Claude Code (CLI)", accessMode: "cli", adapterType: "claude-code" });
    store.upsertAiService({ id: "local-cli", name: "Local CLI", accessMode: "cli", adapterType: "cli" });
    seedRegistryProfiles(store, {});
    store.setCapabilities("claude-code", { coding: 5 });
    store.patchAiService("claude-code", { qualityScore: 5, freeStatus: "free_tier" });
    store.setCapabilities("local-cli", { coding: 3 });
    store.patchAiService("local-cli", { qualityScore: 3, freeStatus: "free" });
    const ranBy: string[] = [];
    const executor: TaskExecutor = {
      name: "multi",
      adapterTypes: ["claude-code", "cli"],
      execute: async (task: Task): Promise<ExecutionResult> => {
        ranBy.push(task.selectedAi ?? "?");
        return task.selectedAi === "claude-code" ? { ok: false, summary: "意図的な失敗" } : { ok: true };
      },
    };
    const engine = new MissionEngine(store, { planner: planner({ summary: "", tasks: [step("c", "coding", "実装")] }), executor, broker: new AIBroker(store) });
    const { mission } = await engine.createMission({ projectId: "f", goal: "g" });
    engine.approvePlan("f", mission.id);
    expect(await engine.run("f", mission.id)).toBe("completed");
    expect(ranBy).toEqual(["claude-code", "local-cli"]); // failure -> fallback
    const task = tasksOf("f", mission.id)[0];
    expect(task.retryCount).toBe(1); // -> retry
    expect(task.selectedAi).toBe("local-cli");
    expect(store.listEvents({ projectId: "f", limit: 500 }).some((e) => e.type === "AI_FALLBACK")).toBe(true);
    expect(store.listAiRuns("f").map((r) => [r.ai_id, r.status])).toEqual([["claude-code", "failed"], ["local-cli", "succeeded"]]);
  });

  it("with no other candidate the retry stays on the same AI instead of giving up early", async () => {
    store.createProject({ id: "f", name: "f" });
    store.upsertAiService({ id: "claude-code", name: "Claude Code (CLI)", accessMode: "cli", adapterType: "claude-code" });
    seedRegistryProfiles(store);
    let n = 0;
    const executor: TaskExecutor = { name: "one", adapterTypes: ["claude-code"], execute: async () => (++n < 3 ? { ok: false, summary: "flaky" } : { ok: true }) };
    const engine = new MissionEngine(store, { planner: planner({ summary: "", tasks: [step("c", "coding", "実装")] }), executor, broker: new AIBroker(store) });
    const { mission } = await engine.createMission({ projectId: "f", goal: "g" });
    engine.approvePlan("f", mission.id);
    expect(await engine.run("f", mission.id)).toBe("completed");
    expect(tasksOf("f", mission.id)[0]).toMatchObject({ selectedAi: "claude-code", retryCount: 2 });
  });
});

describe("Test 4: test failure -> diagnosis -> fix -> retest", () => {
  it("a failing npm test is fed back to Claude Code, which fixes the bug, and the retest passes", async () => {
    store.createProject({ id: "t", name: "t" });
    let fixed = false;
    const claude = fakeClaude(({ cwd, input, attempt }) => {
      put(cwd, "package.json", JSON.stringify({ scripts: { test: "node test.js" } }));
      put(cwd, "app.js", attempt === 1 ? "exports.add = (a, b) => a - b;" : "exports.add = (a, b) => a + b;");
      if (attempt === 2) {
        fixed = true;
        expect(input).toContain("add(1,2) expected 3"); // the real test failure output reached the prompt
      }
    });
    // `npm test` stand-in: reads the file Claude Code wrote and reports like a test runner
    const npm: CommandRunner = async (_c, args, opts) => {
      if (args[0] === "--check") return { stdout: "", stderr: "", code: 0 };
      const src = readFileSync(path.join(opts.cwd!, "app.js"), "utf8");
      return src.includes("a + b") ? { stdout: "1 passed", stderr: "", code: 0 } : { stdout: "FAIL add(1,2) expected 3 got -1", stderr: "", code: 1 };
    };
    const engine = new MissionEngine(store, {
      planner: planner({ summary: "", tasks: [step("c", "coding", "add関数を実装", [], ["app.js"])] }),
      executor: new ClaudeCodeExecutor(store, { runner: claude.runner }),
      validator: new ProjectValidator(root, { runner: npm }),
    });
    const { mission } = await engine.createMission({ projectId: "t", goal: "g" });
    engine.approvePlan("t", mission.id);
    expect(await engine.run("t", mission.id)).toBe("completed");
    expect(fixed).toBe(true);
    expect(store.listValidations("t").map((v) => [v.level, v.status])).toEqual([[3, "failed"], [3, "passed"]]);
  });
});

describe("Test 5: restart mid-run", () => {
  it("tasks, state and artifacts survive a restart, finished work is not redone", async () => {
    const file = path.join(root, "state", "orchestrator.db");
    const first = openDatabase(file);
    const s1 = new Store(first, root);
    s1.createProject({ id: "x", name: "x" });
    const draft = planner({ summary: "", tasks: [step("a", "design", "A", [], ["a.md"]), step("b", "coding", "B", ["a"], ["b.js"])] });
    const exec1: TaskExecutor = {
      name: "e",
      execute: async (task, ctx) => {
        if (task.objective === "A") {
          put(path.join(root, "x"), "a.md", "a");
          s1.createArtifact({ projectId: "x", taskId: task.id, path: "a.md", createdBy: "test" });
          return { ok: true, artifacts: ["a.md"] };
        }
        await new Promise((_r, rej) => ctx.signal.addEventListener("abort", () => rej(new Error("killed")), { once: true })); // B hangs: app "quits" here
        return { ok: true };
      },
    };
    const e1 = new MissionEngine(s1, { planner: draft, executor: exec1 });
    const { mission } = await e1.createMission({ projectId: "x", goal: "g" });
    e1.approvePlan("x", mission.id);
    void e1.run("x", mission.id);
    for (let i = 0; i < 200 && s1.listTasks("x").find((t) => t.objective === "B")?.status !== "running"; i++) await new Promise((r) => setTimeout(r, 10));
    expect(s1.listTasks("x").map((t) => [t.objective, t.status])).toEqual([["A", "completed"], ["B", "running"]]);
    first.close(); // hard stop: no pause, B is left "running" in the file

    // new process: reopen the same file
    const second = openDatabase(file);
    try {
      const s2 = new Store(second, root);
      expect(s2.getMission("x", mission.id)!.status).toBe("running"); // restored
      expect(s2.listArtifacts("x").map((a) => a.path)).toEqual(["a.md"]);
      expect(s2.listTasks("x").find((t) => t.objective === "B")!.status).toBe("running"); // crash leftover
      const ran: string[] = [];
      const e2 = new MissionEngine(s2, { planner: draft, executor: { name: "e", execute: async (t) => (ran.push(t.objective), { ok: true }) } });
      expect(await e2.run("x", mission.id)).toBe("completed");
      expect(ran).toEqual(["B"]); // A is not redone
    } finally {
      second.close();
    }
  });
});

describe("Test 6: multiple projects", () => {
  it("project A and B run at the same time and their files never mix", async () => {
    store.createProject({ id: "pa", name: "A" });
    store.createProject({ id: "pb", name: "B" });
    const claude = fakeClaude(({ cwd }) => {
      put(cwd, "code/main.txt", `owner=${path.basename(cwd)}`);
    });
    const engine = new MissionEngine(store, {
      planner: planner({ summary: "", tasks: [step("c", "coding", "実装", [], ["code/main.txt"])] }),
      executor: new ClaudeCodeExecutor(store, { runner: claude.runner }),
    });
    const a = await engine.createMission({ projectId: "pa", goal: "A" });
    const b = await engine.createMission({ projectId: "pb", goal: "B" });
    engine.approvePlan("pa", a.mission.id);
    engine.approvePlan("pb", b.mission.id);
    expect(await Promise.all([engine.run("pa", a.mission.id), engine.run("pb", b.mission.id)])).toEqual(["completed", "completed"]);
    expect(readFileSync(path.join(root, "pa", "code", "main.txt"), "utf8")).toBe("owner=pa");
    expect(readFileSync(path.join(root, "pb", "code", "main.txt"), "utf8")).toBe("owner=pb");
    expect(readdirSync(root).filter((d) => d === "pa" || d === "pb").sort()).toEqual(["pa", "pb"]);
    expect(store.listArtifacts("pa").every((x) => x.projectId === "pa")).toBe(true);
    expect(store.listTasks("pa").every((t) => t.missionId === a.mission.id)).toBe(true);
    expect(store.listTasks("pb").every((t) => t.missionId === b.mission.id)).toBe(true);
    expect(existsSync(path.join(root, "pa", "pb"))).toBe(false);
  });
});

describe("Test 7: free-only, no API keys", () => {
  it("the whole flow runs with no API key in the environment and Cost Guard blocks key-requiring AIs", async () => {
    const saved = { ...process.env };
    for (const k of ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY"]) delete process.env[k];
    try {
      store.createProject({ id: "free", name: "free" });
      store.upsertAiService({ id: "claude-code", name: "Claude Code (CLI)", accessMode: "cli", adapterType: "claude-code" });
      store.upsertAiService({ id: "paid-api", name: "Paid API", accessMode: "api", adapterType: "claude-code", requiresApiKey: true, freeStatus: "paid", capabilities: ["coding"] });
      seedRegistryProfiles(store);
      store.setCapabilities("paid-api", { coding: 5 });
      store.patchAiService("paid-api", { qualityScore: 5 });
      const chosen: (string | null)[] = [];
      const claude = fakeClaude(({ cwd }) => put(cwd, "x.txt", "ok"));
      const inner = new ClaudeCodeExecutor(store, { runner: claude.runner });
      const executor: TaskExecutor = { name: "cc", adapterTypes: ["claude-code"], execute: (t, c) => (chosen.push(t.selectedAi), inner.execute(t, c)) };
      const engine = new MissionEngine(store, {
        planner: planner({ summary: "", tasks: [step("c", "coding", "実装", [], ["x.txt"])] }),
        executor,
        broker: new AIBroker(store),
        validator: new ProjectValidator(root, { runner: async () => ({ stdout: "", stderr: "", code: 0 }) }),
      });
      const { mission } = await engine.createMission({ projectId: "free", goal: "g" }); // budget policy defaults to free_only
      engine.approvePlan("free", mission.id);
      expect(await engine.run("free", mission.id)).toBe("completed");
      expect(chosen).toEqual(["claude-code"]);
      expect(store.listEvents({ projectId: "free", limit: 500 }).find((e) => e.type === "AI_SELECTED")!.payload).toMatchObject({ excluded: [expect.objectContaining({ aiId: "paid-api" })] });
    } finally {
      process.env = saved;
    }
  });
});
