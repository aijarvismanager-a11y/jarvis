import express from "express";
import http from "node:http";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "./db.ts";
import { Store, type Task } from "./store.ts";
import { MissionEngine, type TaskExecutor } from "./missionEngine.ts";
import { createOrchestratorRouter } from "./api.ts";
import { AIBroker } from "./aiBroker.ts";
import { seedRegistryProfiles } from "./aiRegistry.ts";
import { ChromiumDriver, findBrowserExecutable, WebAiBlockedError, WebAiPromptTooLongError, WebAiUiError, parseOverLimit, type WebChatDriver, type WebChatPage } from "./browserDriver.ts";
import { RoutingExecutor, WebAiExecutor, buildWebPrompt, parseFileBlocks, unwrapSingleFence } from "./webAiExecutor.ts";
import { WebHandoffHub } from "./webHandoff.ts";
import { classifyBlocker, setWebAiSettings } from "./webAiSites.ts";

let db: Db;
let store: Store;
let root: string;
const pid = "p1";

beforeEach(() => {
  db = openDatabase(":memory:");
  root = mkdtempSync(path.join(os.tmpdir(), "web-ai-"));
  store = new Store(db, root);
  store.setSetting("allowManualTextAis", true); // these tests exercise the manual copy-and-paste path
  store.createProject({ id: pid, name: "p" });
  store.upsertAiService({ id: "claude-code", name: "Claude Code (CLI)", accessMode: "cli", adapterType: "claude-code" });
  store.upsertAiService({ id: "gemini", name: "Gemini (Web)", url: "https://gemini.test" });
  seedRegistryProfiles(store);
});
afterEach(() => {
  db.close();
  rmSync(root, { recursive: true, force: true });
});

const mission = () => store.createMission({ projectId: pid, goal: "依頼目標", status: "running" });
function makeTask(over: Partial<Parameters<Store["createTask"]>[0]> = {}): Task {
  const m = mission();
  return store.createTask({ projectId: pid, missionId: m.id, role: "research", objective: "市場調査", selectedAi: "gemini", status: "running", ...over });
}
const ctxFor = (task: Task, signal = new AbortController().signal) => ({ mission: store.getMission(pid, task.missionId)!, signal });
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
async function pendingHandoff(hub: WebHandoffHub) {
  for (let i = 0; i < 600; i++) {
    const h = hub.list({ status: "pending" })[0];
    if (h) return h;
    await tick();
  }
  throw new Error("no pending handoff");
}

/** Scripted driver: every method can be told to fail. */
class FakeDriver implements WebChatDriver {
  opens = 0;
  filled: string[] = [];
  sent = 0;
  closed = 0;
  openError: Error | null = null;
  fillError: Error | null = null;
  responseError: Error | null = null;
  answer = "AIの回答";
  async open(): Promise<WebChatPage> {
    this.opens++;
    if (this.openError) throw this.openError;
    return {
      fillPrompt: async (t) => {
        if (this.fillError) throw this.fillError;
        this.filled.push(t);
      },
      submit: async () => void this.sent++,
      waitForResponse: async ({ signal }) => {
        if (this.responseError) throw this.responseError;
        return new Promise<string>((resolve, reject) => {
          if (this.sent > 0) return resolve(this.answer);
          signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true }); // Level 2: never sent -> keeps waiting
        });
      },
      close: async () => void this.closed++,
    };
  }
  async shutdown() {}
}

describe("web handoff hub", () => {
  it("survives a new hub instance, reuses the open handoff for a task, and rejects double answers", () => {
    const hub = new WebHandoffHub(store);
    const input = { projectId: pid, taskId: "t1", aiId: "gemini", aiName: "Gemini", url: "https://x.test", level: 1 as const, prompt: "P", note: null };
    const a = hub.request(input);
    expect(new WebHandoffHub(store).get(a.id)?.status).toBe("pending");
    expect(hub.request(input).id).toBe(a.id);
    expect(() => hub.submit(a.id, "  ")).toThrow(/空/);
    hub.submit(a.id, "answer");
    expect(() => hub.submit(a.id, "again")).toThrow(/処理済み/);
    expect(() => hub.skip(a.id)).toThrow(/処理済み/);
    expect(hub.request(input).id).toBe(a.id); // submitted but not yet consumed (e.g. restart in between)
    hub.markConsumed(a.id);
    expect(hub.request(input).id).not.toBe(a.id);
  });

  it("wait() resolves on submit and rejects on abort", async () => {
    const hub = new WebHandoffHub(store);
    const h = hub.request({ projectId: pid, taskId: "t1", aiId: "gemini", aiName: "G", url: null, level: 1, prompt: "P", note: null });
    const waiting = hub.wait(h.id, new AbortController().signal);
    hub.submit(h.id, "ok");
    expect((await waiting).resultText).toBe("ok");

    const h2 = hub.request({ projectId: pid, taskId: "t2", aiId: "gemini", aiName: "G", url: null, level: 1, prompt: "P", note: null });
    const ac = new AbortController();
    const aborted = hub.wait(h2.id, ac.signal);
    ac.abort();
    await expect(aborted).rejects.toThrow(/中断/);
    expect(hub.get(h2.id)?.status).toBe("pending"); // pause keeps it for the resume
  });
});

describe("prompt and answer handling", () => {
  it("tells the AI the answer becomes the file, or asks for FILE markers when there are several", () => {
    const base = { task: { role: "research", objective: "調べる", inputs: [], constraints: [] }, mission: { goal: "G" }, context: [] };
    expect(buildWebPrompt({ ...base, task: { ...base.task, expectedOutputs: ["research/a.md"] }, outputPaths: ["research/a.md"] })).toContain("「research/a.md」の内容として保存");
    const multi = buildWebPrompt({ ...base, task: { ...base.task, expectedOutputs: ["a.md", "b.md"] }, outputPaths: ["a.md", "b.md"] });
    expect(multi).toContain("=== FILE: a.md ===");
    expect(multi).toContain("=== FILE: b.md ===");
  });

  it("splits FILE blocks, ignores unknown paths, and unwraps a single code fence", () => {
    const text = "=== FILE: a.md ===\nAAA\n=== FILE: evil/../x.md ===\nNO\n=== FILE: b.js ===\n```js\nlet b = 1;\n```\n";
    const blocks = parseFileBlocks(text, ["a.md", "b.js"]);
    expect([...blocks.keys()]).toEqual(["a.md", "b.js"]);
    expect(blocks.get("b.js")).toBe("let b = 1;");
    expect(unwrapSingleFence("```\nx\n```")).toBe("x");
    expect(unwrapSingleFence("text ```a``` text")).toBe("text ```a``` text");
  });

  it("classifies a login page and a bot check, and leaves a normal page alone", () => {
    expect(classifyBlocker({ url: "https://chat.test/auth/login", text: "", hasChallengeFrame: false })).toBe("login");
    expect(classifyBlocker({ url: "https://chat.test/", text: "ログインして続ける", hasChallengeFrame: false })).toBe("login");
    expect(classifyBlocker({ url: "https://chat.test/", text: "Verify you are human", hasChallengeFrame: false })).toBe("captcha");
    expect(classifyBlocker({ url: "https://chat.test/", text: "", hasChallengeFrame: true })).toBe("captcha");
    expect(classifyBlocker({ url: "https://chat.test/", text: "Hello", hasChallengeFrame: false })).toBeNull();
  });
});

describe("Level 1 (manual)", () => {
  it("waits in `waiting`, saves the pasted answer as an artifact, and quotes earlier results into the prompt", async () => {
    const hub = new WebHandoffHub(store);
    const exec = new WebAiExecutor(store, hub);
    const dep = makeTask({ role: "design", objective: "設計", status: "completed" });
    store.createArtifact({ projectId: pid, taskId: dep.id, path: "design/spec.md", createdBy: "claude-code" });
    const specAbs = path.join(root, pid, "design", "spec.md");
    (await import("node:fs")).mkdirSync(path.dirname(specAbs), { recursive: true });
    (await import("node:fs")).writeFileSync(specAbs, "仕様の中身", "utf8");
    const task = store.createTask({ projectId: pid, missionId: dep.missionId, role: "research", objective: "市場調査", selectedAi: "gemini", status: "running", expectedOutputs: ["research/market.md"], dependsOn: [dep.id] });

    const run = exec.execute(task, ctxFor(task));
    const h = await pendingHandoff(hub);
    expect(h).toMatchObject({ level: 1, aiId: "gemini", url: "https://gemini.test" });
    expect(h.prompt).toContain("仕様の中身");
    expect(h.prompt).toContain("市場調査");
    expect(store.getTask(pid, task.id)!.status).toBe("waiting");
    hub.submit(h.id, "# 市場\n調査結果");

    const res = await run;
    expect(res).toMatchObject({ ok: true, artifacts: ["research/market.md"], aiId: "gemini", automationLevel: 1 });
    expect(readFileSync(path.join(root, pid, "research", "market.md"), "utf8")).toBe("# 市場\n調査結果\n");
    expect(store.getTask(pid, task.id)!.status).toBe("running");
    expect(store.listArtifacts(pid).find((a) => a.path === "research/market.md")).toMatchObject({ sourceAi: "gemini", sourceUrl: "https://gemini.test", taskId: task.id });
    expect(hub.get(h.id)?.consumed).toBe(true);
  });

  it("uses a default path under web-ai/ when the task declares none, and rejects a path escape", async () => {
    const hub = new WebHandoffHub(store);
    const exec = new WebAiExecutor(store, hub);
    const task = makeTask();
    const run = exec.execute(task, ctxFor(task));
    hub.submit((await pendingHandoff(hub)).id, "text");
    const res = await run;
    expect(res.artifacts?.[0]).toMatch(/^web-ai\/research-/);
    expect(existsSync(path.join(root, pid, res.artifacts![0]!))).toBe(true);
  });

  it("fails clearly when several outputs were requested but the answer has no FILE markers", async () => {
    const hub = new WebHandoffHub(store);
    const exec = new WebAiExecutor(store, hub);
    const task = makeTask({ expectedOutputs: ["a.md", "b.md"] });
    const run = exec.execute(task, ctxFor(task));
    hub.submit((await pendingHandoff(hub)).id, "ただの文章");
    const res = await run;
    expect(res.ok).toBe(false);
    expect(res.summary).toContain("a.md");
  });

  it("pause keeps the handoff for the resume; cancelling the mission closes it", async () => {
    const hub = new WebHandoffHub(store);
    const exec = new WebAiExecutor(store, hub);
    const task = makeTask();
    const ac = new AbortController();
    const run = exec.execute(task, ctxFor(task, ac.signal));
    const h = await pendingHandoff(hub);
    ac.abort();
    expect((await run).ok).toBe(false);
    expect(hub.get(h.id)?.status).toBe("pending");

    // resume: the same handoff is waited on again
    store.setTaskStatus(pid, task.id, "running");
    const again = exec.execute(store.getTask(pid, task.id)!, ctxFor(task));
    expect((await pendingHandoff(hub)).id).toBe(h.id);
    hub.submit(h.id, "late answer");
    expect((await again).ok).toBe(true);

    const t2 = makeTask();
    const ac2 = new AbortController();
    const run2 = exec.execute(t2, ctxFor(t2, ac2.signal));
    const h2 = await pendingHandoff(hub);
    store.setMissionStatus(pid, t2.missionId, "cancelled");
    ac2.abort();
    await run2;
    expect(hub.get(h2.id)?.status).toBe("cancelled");
  });

  it("times out a handoff nobody answers", async () => {
    const hub = new WebHandoffHub(store);
    const exec = new WebAiExecutor(store, hub, { handoffTimeoutMs: 40 });
    const task = makeTask();
    const res = await exec.execute(task, ctxFor(task));
    expect(res).toMatchObject({ ok: false });
    expect(res.summary).toContain("タイムアウト");
    expect(hub.list({ status: "cancelled" })).toHaveLength(1);
  });

  it("stays at Level 1 when the service is Level 3 but there is no driver or site profile", async () => {
    store.patchAiService("gemini", { automationLevel: 3 });
    const hub = new WebHandoffHub(store);
    const task = makeTask();
    const run = new WebAiExecutor(store, hub).execute(task, ctxFor(task));
    const h = await pendingHandoff(hub);
    expect(h.level).toBe(1);
    expect(h.note).toContain("Level 1");
    hub.submit(h.id, "x");
    await run;
  });
});

describe("Level 3 / Level 2 and automatic downgrade", () => {
  beforeEach(() => store.patchAiService("gemini", { automationLevel: 3 }));

  it("Level 3 types, sends, reads and saves with no human step", async () => {
    const driver = new FakeDriver();
    const hub = new WebHandoffHub(store);
    const task = makeTask();
    const res = await new WebAiExecutor(store, hub, { driver }).execute(task, ctxFor(task));
    expect(res).toMatchObject({ ok: true, automationLevel: 3 });
    expect(driver.filled).toHaveLength(1);
    expect(driver.sent).toBe(1);
    expect(driver.closed).toBe(1);
    expect(hub.list()).toHaveLength(0);
    expect(store.getTask(pid, task.id)!.status).toBe("running"); // never went to waiting
  });

  it("a site that says the prompt is too long: the cap is learned, a shorter prompt is sent at once, no downgrade", async () => {
    const driver = new FakeDriver();
    const real = driver.open.bind(driver);
    let first = true;
    driver.open = async () => {
      const page = await real();
      const fill = page.fillPrompt;
      page.fillPrompt = async (t) => {
        if (first) {
          first = false;
          throw new WebAiPromptTooLongError(1_346, t.length); // "クエリが上限を1,346文字超えています"
        }
        await fill(t);
      };
      return page;
    };
    const hub = new WebHandoffHub(store);
    const task = makeTask();
    const res = await new WebAiExecutor(store, hub, { driver }).execute(task, ctxFor(task));
    expect(res).toMatchObject({ ok: true, automationLevel: 3 });
    expect(driver.opens).toBe(2);
    expect(driver.filled).toHaveLength(1);
    const cap = store.getSetting<number | null>("web_prompt_cap:gemini", null);
    expect(cap).not.toBeNull();
    expect(driver.filled[0]!.length).toBeLessThanOrEqual(cap!);
    expect(store.getAiService("gemini")!.automationLevel).toBe(3); // not counted as a break of the automation
  });

  it("reads how far over the limit a site says the prompt is", () => {
    expect(parseOverLimit("クエリが上限を4,997文字超えています。送信するには短くしてください。")).toBe(4997);
    expect(parseOverLimit("クエリが上限を1,346文字超えています")).toBe(1346);
    expect(parseOverLimit("Your message exceeds the limit by 2,100 characters")).toBe(2100);
    expect(parseOverLimit("上限に達しました")).toBeNull();
  });

  it("a broken Level 3 falls to Level 2 for that run: the prompt is typed, the user sends, the answer is read from the page", async () => {
    const driver = new FakeDriver();
    driver.responseError = new Error("回答が取れない");
    const hub = new WebHandoffHub(store);
    const exec = new WebAiExecutor(store, hub, { driver });
    const task = makeTask();
    const run = exec.execute(task, ctxFor(task));
    const h = await pendingHandoff(hub);
    expect(h.level).toBe(2);
    expect(h.note).toContain("Level 3");
    hub.submit(h.id, "手で貼った回答");
    const res = await run;
    expect(res).toMatchObject({ ok: true, automationLevel: 2 });
    expect(driver.filled).toHaveLength(2); // once by Level 3, once by Level 2
    expect(store.getAiService("gemini")!.automationLevel).toBe(3); // one failure does not change the registry
  });

  it("Level 2 picks up the answer from the page by itself once the prompt was sent", async () => {
    store.patchAiService("gemini", { automationLevel: 2 });
    const driver = new FakeDriver();
    const hub = new WebHandoffHub(store);
    const task = makeTask();
    const run = new WebAiExecutor(store, hub, { driver }).execute(task, ctxFor(task));
    const h = await pendingHandoff(hub);
    expect(h.level).toBe(2);
    driver.sent = 1; // the user pressed send
    // the fake page only answers on the next poll, so nudge it by re-waiting: submit through the page watcher
    for (let i = 0; i < 50 && hub.get(h.id)!.status === "pending"; i++) await tick();
    if (hub.get(h.id)!.status === "pending") hub.submit(h.id, driver.answer); // watcher registered before `sent` flipped: same outcome via paste
    expect(await run).toMatchObject({ ok: true, automationLevel: 2 });
  });

  it("two breaks in a row lower the registry level and record why; a success resets the count", async () => {
    const driver = new FakeDriver();
    driver.responseError = new WebAiUiError("UIが変わった");
    const hub = new WebHandoffHub(store);
    const exec = new WebAiExecutor(store, hub, { driver });
    for (let i = 0; i < 2; i++) {
      const task = makeTask();
      const run = exec.execute(task, ctxFor(task));
      hub.submit((await pendingHandoff(hub)).id, "手動");
      await run;
    }
    expect(store.getAiService("gemini")!.automationLevel).toBe(2);
    expect(store.listDecisions(pid).some((d) => String(d.title).includes("自動降格"))).toBe(true);
    expect(store.listEvents({ projectId: pid, limit: 500 }).some((e) => e.type === "AUTOMATION_DOWNGRADED")).toBe(true);

    // reset on success
    store.patchAiService("gemini", { automationLevel: 3 });
    driver.responseError = new Error("一度だけ失敗");
    let task = makeTask();
    let run = exec.execute(task, ctxFor(task));
    hub.submit((await pendingHandoff(hub)).id, "手動");
    await run;
    driver.responseError = null;
    task = makeTask();
    expect((await exec.execute(task, ctxFor(task))).automationLevel).toBe(3);
    driver.responseError = new Error("また一度だけ");
    task = makeTask();
    run = exec.execute(task, ctxFor(task));
    hub.submit((await pendingHandoff(hub)).id, "手動");
    await run;
    expect(store.getAiService("gemini")!.automationLevel).toBe(3); // 1 failure, not 2 in a row
  });

  it("a login page or bot check is never pushed through: straight to Level 1 with the reason, and no downgrade counted", async () => {
    const driver = new FakeDriver();
    driver.openError = new WebAiBlockedError("captcha");
    const hub = new WebHandoffHub(store);
    const exec = new WebAiExecutor(store, hub, { driver });
    for (let i = 0; i < 3; i++) {
      const task = makeTask();
      const run = exec.execute(task, ctxFor(task));
      const h = await pendingHandoff(hub);
      expect(h.level).toBe(1);
      expect(h.note).toContain("CAPTCHA");
      hub.submit(h.id, "手動");
      await run;
    }
    expect(driver.opens).toBe(3); // Level 2 was not attempted against the blocked page
    expect(store.getAiService("gemini")!.automationLevel).toBe(3);
  });

  it("an open failure at Level 2 falls to Level 1", async () => {
    store.patchAiService("gemini", { automationLevel: 2 });
    const driver = new FakeDriver();
    driver.fillError = new WebAiUiError("入力欄なし");
    const hub = new WebHandoffHub(store);
    const task = makeTask();
    const run = new WebAiExecutor(store, hub, { driver }).execute(task, ctxFor(task));
    const h = await pendingHandoff(hub);
    expect(h.level).toBe(1);
    expect(driver.closed).toBe(1);
    hub.submit(h.id, "x");
    await run;
  });
});

describe("RoutingExecutor", () => {
  const code: TaskExecutor = { name: "claude-code", adapterTypes: ["claude-code"], execute: async () => ({ ok: true, summary: "code ran" }) };

  it("sends everything to Claude Code while the switch is off, and exposes web adapters only when on", async () => {
    const hub = new WebHandoffHub(store);
    const router = new RoutingExecutor(store, code, new WebAiExecutor(store, hub));
    expect(router.adapterTypes).toEqual(["claude-code"]);
    const task = makeTask();
    expect(await router.execute(task, ctxFor(task))).toMatchObject({ summary: "code ran", executor: "claude-code" });
    setWebAiSettings(store, { enabled: true });
    expect(router.adapterTypes).toEqual(["claude-code", "manual", "browser"]);
  });

  it("never gives code-editing tasks to a web AI", async () => {
    setWebAiSettings(store, { enabled: true });
    const router = new RoutingExecutor(store, code, new WebAiExecutor(store, new WebHandoffHub(store)));
    const task = makeTask({ role: "coding" });
    expect((await router.execute(task, ctxFor(task))).summary).toBe("code ran");
  });

  it("tells the Broker that only the code executor can take a code-editing task, so a web AI is never recorded as its owner", () => {
    setWebAiSettings(store, { enabled: true });
    const router = new RoutingExecutor(store, code, new WebAiExecutor(store, new WebHandoffHub(store)));
    expect(router.adapterTypesFor(makeTask({ role: "coding" }))).toEqual(["claude-code"]);
    expect(router.adapterTypesFor(makeTask({ role: "research" }))).toEqual(expect.arrayContaining(["manual", "browser"]));
  });

  it("skipping a handoff runs the task on Claude Code and records that", async () => {
    setWebAiSettings(store, { enabled: true });
    const hub = new WebHandoffHub(store);
    const router = new RoutingExecutor(store, code, new WebAiExecutor(store, hub));
    const task = makeTask();
    const run = router.execute(task, ctxFor(task));
    hub.skip((await pendingHandoff(hub)).id);
    expect(await run).toMatchObject({ ok: true, summary: "code ran", executor: "claude-code" });
    expect(store.getTask(pid, task.id)!.selectedAi).toBe("claude-code");
    expect(store.listEvents({ projectId: pid, limit: 500 }).some((e) => e.type === "WEB_AI_FALLBACK")).toBe(true);
  });
});

describe("mission end to end with a web AI", () => {
  it("Broker picks the web AI, the mission waits for the answer, then completes and records who ran it", async () => {
    store.setCapabilities("claude-code", { coding: 5 }); // Claude Code is no research candidate here
    store.patchAiService("claude-code", { qualityScore: 5 });
    // make research the web AI's job only
    store.setCapabilities("claude-code", { coding: 5 });
    setWebAiSettings(store, { enabled: true });
    const hub = new WebHandoffHub(store);
    const exec = new RoutingExecutor(store, code(), new WebAiExecutor(store, hub));
    const engine = new MissionEngine(store, {
      planner: { name: "p", plan: async () => ({ summary: "", tasks: [{ key: "r", role: "research", objective: "調査", inputs: [], expectedOutputs: ["research/r.md"], constraints: [], dependsOn: [] }] }) },
      executor: exec,
      broker: new AIBroker(store),
    });
    const { mission: m } = await engine.createMission({ projectId: pid, goal: "G" });
    engine.approvePlan(pid, m.id);
    const done = engine.run(pid, m.id);
    const h = await pendingHandoff(hub);
    expect(h.aiId).toBe("gemini");
    expect(store.listTasks(pid).find((t) => t.missionId === m.id)!.status).toBe("waiting");
    hub.submit(h.id, "調査結果");
    expect(await done).toBe("completed");
    const run = store.listAiRuns(pid)[0]!;
    expect(run).toMatchObject({ executor: "web-ai", ai_id: "gemini", automation_level: 1, status: "succeeded" });
    expect(readFileSync(path.join(root, pid, "research", "r.md"), "utf8")).toContain("調査結果");
  });

  function code(): TaskExecutor {
    return { name: "claude-code", adapterTypes: ["claude-code"], execute: async () => ({ ok: true }) };
  }
});

describe("web AI API", () => {
  let server: http.Server;
  let base: string;
  afterEach(() => new Promise<void>((r) => server.close(() => r())));

  const opened: string[] = [];
  async function boot(browserAvailable = true) {
    const hub = new WebHandoffHub(store);
    const engine = new MissionEngine(store, { planner: { name: "p", plan: async () => ({ summary: "", tasks: [] }) }, executor: { name: "x", execute: async () => ({ ok: true }) } });
    const app = express();
    app.use(express.json());
    app.use("/api/v2", createOrchestratorRouter({ store, engine, canExecute: true, tokenMatches: (c) => c === "tok", webAi: { hub, browserAvailable: () => browserAvailable, openLogin: (u) => void opened.push(u) } }));
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v2`;
    return hub;
  }
  const send = (method: string, url: string, body?: unknown, token: string | null = "tok") =>
    fetch(`${base}${url}`, { method, headers: { "content-type": "application/json", ...(token ? { "x-orchestrator-token": token } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });

  it("the switch needs the token and is off by default", async () => {
    await boot();
    expect(((await (await fetch(`${base}/web-ai/settings`)).json()) as { enabled: boolean }).enabled).toBe(false);
    expect((await send("PUT", "/web-ai/settings", { enabled: true }, null)).status).toBe(403);
    expect((await send("PUT", "/web-ai/settings", { enabled: true })).status).toBe(200);
    expect(((await (await fetch(`${base}/web-ai/settings`)).json()) as { enabled: boolean }).enabled).toBe(true);
  });

  it("opens the registered page for a manual sign-in, needs the token, and never takes a URL from the request", async () => {
    await boot();
    opened.length = 0;
    store.upsertAiService({ id: "site1", name: "Site1", url: "https://site1.test/chat" });
    store.upsertAiService({ id: "nourl", name: "NoUrl" });
    expect((await send("POST", "/ai-services/site1/open-login", {}, null)).status).toBe(403);
    expect((await send("POST", "/ai-services/site1/open-login", { url: "https://evil.test" })).status).toBe(200);
    expect(opened).toEqual(["https://site1.test/chat"]);
    expect((await send("POST", "/ai-services/nourl/open-login", {})).status).toBe(400);
    expect((await send("POST", "/ai-services/missing/open-login", {})).status).toBe(404);
    await new Promise<void>((r) => server.close(() => r()));
    await boot(false);
    expect((await send("POST", "/ai-services/site1/open-login", {})).status).toBe(400); // no browser
  });

  it("the user, not the system, raises the level; it needs a site profile and a browser", async () => {
    await boot();
    store.upsertAiService({ id: "mystery", name: "Mystery", url: "https://m.test" });
    expect((await send("PUT", "/ai-services/mystery/automation-level", { level: 3 })).status).toBe(400); // no selectors
    expect((await send("PUT", "/web-ai/sites/mystery", { inputSelector: "#q", responseSelector: ".a" })).status).toBe(200);
    expect((await send("PUT", "/web-ai/sites/mystery", { inputSelector: "#q", responseSelector: ".a", evil: 1 })).status).toBe(400);
    expect((await send("PUT", "/ai-services/mystery/automation-level", { level: 3 })).status).toBe(200);
    expect(store.getAiService("mystery")!.automationLevel).toBe(3);
    expect((await send("PUT", "/ai-services/gemini/automation-level", { level: 2 })).status).toBe(200); // bundled profile
    expect((await send("PUT", "/ai-services/gemini/automation-level", { level: 4 })).status).toBe(400);
    await new Promise<void>((r) => server.close(() => r()));
    await boot(false);
    expect((await send("PUT", "/ai-services/gemini/automation-level", { level: 3 })).status).toBe(400); // no browser
    expect((await send("PUT", "/ai-services/gemini/automation-level", { level: 1 })).status).toBe(200); // lowering always works
  });

  it("lists handoffs and accepts the answer or a skip (token required)", async () => {
    const hub = await boot();
    const a = hub.request({ projectId: pid, taskId: "t1", aiId: "gemini", aiName: "G", url: null, level: 1, prompt: "P", note: null });
    const b = hub.request({ projectId: pid, taskId: "t2", aiId: "gemini", aiName: "G", url: null, level: 1, prompt: "P", note: null });
    const list = (await (await fetch(`${base}/web-handoffs?status=pending`)).json()) as { handoffs: { id: string; prompt: string }[] };
    expect(list.handoffs.map((h) => h.id)).toEqual([a.id, b.id]);
    expect(list.handoffs[0]!.prompt).toBe("P");
    expect((await send("POST", `/web-handoffs/${a.id}/result`, { text: "ans" }, null)).status).toBe(403);
    expect((await send("POST", `/web-handoffs/${a.id}/result`, { text: "" })).status).toBe(400);
    expect((await send("POST", `/web-handoffs/${a.id}/result`, { text: "ans" })).status).toBe(200);
    expect((await send("POST", `/web-handoffs/${a.id}/result`, { text: "again" })).status).toBe(400);
    expect((await send("POST", `/web-handoffs/${b.id}/skip`, {})).status).toBe(200);
    expect(hub.get(b.id)?.status).toBe("skipped");
  });

  it("answers 501 when Web AI is not wired", async () => {
    const engine = new MissionEngine(store, { planner: { name: "p", plan: async () => ({ summary: "", tasks: [] }) }, executor: { name: "x", execute: async () => ({ ok: true }) } });
    const app = express();
    app.use(express.json());
    app.use("/api/v2", createOrchestratorRouter({ store, engine, canExecute: true, tokenMatches: () => true }));
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v2`;
    expect((await send("PUT", "/web-ai/settings", { enabled: true })).status).toBe(501);
    expect((await fetch(`${base}/web-handoffs`)).status).toBe(501);
  });
});

// ---- the real driver against a local mock chat page, in a real (headless) browser ----
const browser = findBrowserExecutable();
describe.skipIf(!browser)("ChromiumDriver against a mock chat site (real browser)", () => {
  let site: http.Server;
  let siteUrl: string;
  let driver: ChromiumDriver;
  let profile: string;

  const CHAT_PAGE = `<!doctype html><meta charset="utf-8"><body>
    <div id="log"></div>
    <textarea id="q"></textarea><button id="send">send</button><button id="stop" style="display:none">stop</button>
    <script>
      document.getElementById('send').onclick = () => {
        const v = document.getElementById('q').value; if (!v) return;
        document.getElementById('q').value = '';
        const a = document.createElement('div'); a.className = 'answer'; document.getElementById('log').appendChild(a);
        const full = 'ECHO: ' + v; let i = 0; document.getElementById('stop').style.display = 'inline';
        const t = setInterval(() => { i += 6; a.textContent = full.slice(0, i); if (i >= full.length) { clearInterval(t); document.getElementById('stop').style.display = 'none'; } }, 120);
      };
    </script>`;

  beforeEach(async () => {
    site = http.createServer((req, res) => {
      res.setHeader("content-type", "text/html; charset=utf-8");
      if (req.url === "/login") return void res.end("<!doctype html><meta charset=utf-8><h1>Log in</h1><p>Please sign in to continue</p>");
      if (req.url === "/captcha") return void res.end("<!doctype html><meta charset=utf-8><p>Verify you are human</p>");
      if (req.url === "/changed") return void res.end("<!doctype html><meta charset=utf-8><p>A redesigned page with no known elements</p>");
      res.end(CHAT_PAGE);
    });
    await new Promise<void>((r) => site.listen(0, "127.0.0.1", r));
    siteUrl = `http://127.0.0.1:${(site.address() as AddressInfo).port}`;
    profile = mkdtempSync(path.join(os.tmpdir(), "web-ai-profile-"));
    driver = new ChromiumDriver({ executable: browser!, profileDir: profile, headless: true, inputTimeoutMs: 2500 });
  });
  afterEach(async () => {
    await driver.shutdown();
    await new Promise<void>((r) => site.close(() => r()));
    await tick(500); // let the browser release its profile before removing it
    try {
      rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
    } catch {
      /* a lingering browser helper may still hold a temp file; the OS temp dir is cleaned later */
    }
  });

  const profileFor = { inputSelector: "#q", sendSelector: "#send", responseSelector: ".answer", stopSelector: "#stop" };

  it("types the prompt, sends it, waits for the streamed answer to finish, and returns the full text", async () => {
    const page = await driver.open({ url: siteUrl, site: profileFor });
    await page.fillPrompt("こんにちは world");
    await page.submit();
    const text = await page.waitForResponse({ timeoutMs: 20_000 });
    expect(text).toBe("ECHO: こんにちは world");
    await page.close();
  }, 60_000);

  it("a two-step picture site: confirms the generation, reads pictures inside links, and leaves the history's pictures out", async () => {
    const svg = (c: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="420" height="420"><rect width="420" height="420" fill="${c}"/></svg>`;
    const picSite = http.createServer((req, res) => {
      if (req.url?.startsWith("/img/")) {
        res.setHeader("content-type", "image/svg+xml");
        return void res.end(svg(req.url.includes("new") ? "#c33" : "#33c"));
      }
      res.setHeader("content-type", "text/html; charset=utf-8");
      if (req.url === "/library") return void res.end('<!doctype html><meta charset=utf-8><a href="#"><img src="/img/old1@2k.svg"></a>');
      res.end(`<!doctype html><meta charset="utf-8"><body>
        <a href="#"><img src="/img/old1@1k.svg"></a>
        <textarea id="q"></textarea><button id="send" aria-label="Generate image">arrow</button>
        <div id="sheet" style="display:none"><button>Generate Vector
SVG</button><button id="go">Generate</button></div>
        <div id="out"></div>
        <script>
          document.getElementById('send').onclick = () => { document.getElementById('sheet').style.display = 'block'; };
          document.getElementById('go').onclick = () => {
            document.getElementById('out').innerHTML = '<a href="#"><img src="/img/old1@1k.svg"></a><a href="#"><img src="/img/new1@1k.svg"></a><a href="#"><img src="/img/new2@1k.svg"></a>';
          };
        </script>`);
    });
    await new Promise<void>((r) => picSite.listen(0, "127.0.0.1", r));
    const url = `http://127.0.0.1:${(picSite.address() as AddressInfo).port}`;
    try {
      const page = await driver.open({
        url,
        site: { inputSelector: "#q", sendSelector: "#send", responseSelector: "#out", confirmButton: "^Generate( \d[0-9.]*)?$", imagesInLinks: true, historyUrl: `${url}/library` },
      });
      await page.fillPrompt("a logo");
      await page.submit();
      await page.waitForImages!({ timeoutMs: 20_000 });
      const pics = await page.readImages!();
      expect(pics).toHaveLength(2); // the two new ones; the picture the history page already showed is left out
      expect(pics.every((p) => p.base64.length > 100)).toBe(true);
      await page.close();
    } finally {
      await new Promise<void>((r) => picSite.close(() => r()));
    }
  }, 90_000);

  it("a second prompt in the same chat returns the new answer, not the old one", async () => {
    const page = await driver.open({ url: siteUrl, site: profileFor });
    await page.fillPrompt("first");
    await page.submit();
    expect(await page.waitForResponse({ timeoutMs: 20_000 })).toBe("ECHO: first");
    await page.fillPrompt("second");
    await page.submit();
    expect(await page.waitForResponse({ timeoutMs: 20_000 })).toBe("ECHO: second");
    await page.close();
  }, 60_000);

  it("stops at a login page, a bot check and a redesigned page instead of trying to get past them", async () => {
    await expect(driver.open({ url: `${siteUrl}/login`, site: profileFor })).rejects.toBeInstanceOf(WebAiBlockedError);
    await expect(driver.open({ url: `${siteUrl}/captcha`, site: profileFor })).rejects.toMatchObject({ reason: "captcha" });
    await expect(driver.open({ url: `${siteUrl}/changed`, site: profileFor })).rejects.toBeInstanceOf(WebAiUiError);
  }, 60_000);

  it("WebAiExecutor runs Level 3 for real, and a changed page degrades the run to Level 1", async () => {
    store.upsertAiService({ id: "mock", name: "Mock AI", url: siteUrl });
    store.patchAiService("mock", { automationLevel: 3 });
    setWebAiSettings(store, { sites: { mock: profileFor } });
    const hub = new WebHandoffHub(store);
    const exec = new WebAiExecutor(store, hub, { driver, autoTimeoutMs: 30_000 });

    const t1 = makeTask({ selectedAi: "mock", expectedOutputs: ["research/out.md"] });
    const ok = await exec.execute(t1, ctxFor(t1));
    expect(ok).toMatchObject({ ok: true, automationLevel: 3 });
    const saved = readFileSync(path.join(root, pid, "research", "out.md"), "utf8");
    expect(saved).toContain("ECHO: ");
    expect(saved).toContain("依頼目標");

    setWebAiSettings(store, { sites: { mock: { ...profileFor, inputSelector: "#nothing-like-this" } } });
    const t2 = makeTask({ selectedAi: "mock" });
    const run = exec.execute(t2, ctxFor(t2));
    const h = await pendingHandoff(hub);
    expect(h.level).toBe(1); // L3 broke, L2 could not fill either
    hub.submit(h.id, "手で貼った回答");
    expect(await run).toMatchObject({ ok: true, automationLevel: 1 });
  }, 90_000);
});
