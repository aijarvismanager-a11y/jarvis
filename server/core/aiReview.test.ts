import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "./db.ts";
import { Store, type Task } from "./store.ts";
import { MissionEngine } from "./missionEngine.ts";
import { AIBroker } from "./aiBroker.ts";
import type { Planner } from "./planner.ts";
import { AI_REVIEW_LEVEL, aiFamily, getAiReviewSettings, importanceOf, parseVerdict, pickReviewer, reviewTask, setAiReviewSettings, type AiReviewer } from "./aiReview.ts";
import { setWebAiSettings } from "./webAiSites.ts";
import { projectDir } from "./paths.ts";

let db: Db;
let store: Store;
let root: string;
const pid = "p1";

const web = (id: string, name: string, score: number, level = 3) => {
  store.upsertAiService({ id, name, url: `https://${id}.test`, accessMode: "web", adapterType: "manual", automationLevel: level, freeStatus: "free_tier", capabilities: ["ux_review"] });
  store.patchAiService(id, { qualityScore: score }); // the broker ranks reviewers by it
};

beforeEach(() => {
  db = openDatabase(":memory:");
  root = mkdtempSync(path.join(os.tmpdir(), "aireview-"));
  store = new Store(db, root);
  store.createProject({ id: pid, name: "p" });
  store.upsertAiService({ id: "claude-code", name: "Claude Code (CLI)", accessMode: "cli", adapterType: "claude-code", automationLevel: 3, freeStatus: "free_tier", capabilities: ["architecture", "coding"] });
  web("claude-web", "Claude (Web)", 5);
  web("chatgpt", "ChatGPT (Web)", 4);
  web("gemini", "Gemini (Web)", 3);
  setWebAiSettings(store, { enabled: true, loggedIn: { "claude-web": true, chatgpt: true, gemini: true } });
});
afterEach(() => {
  db.close();
  rmSync(root, { recursive: true, force: true });
});

/** A finished task of the given role that produced `files` (written into the project folder and registered). */
function finishedTask(role: string, files: Record<string, string>, extra: { retryCount?: number; selectedAi?: string | null; objective?: string } = {}): { task: Task; missionId: string } {
  const mission = store.createMission({ projectId: pid, goal: "ログイン機能を作る", status: "running" });
  const task = store.createTask({ projectId: pid, missionId: mission.id, role, objective: extra.objective ?? "認証の設計", expectedOutputs: Object.keys(files), selectedAi: extra.selectedAi ?? "claude-code", status: "validation" });
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(projectDir(root, pid), rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, body);
    store.createArtifact({ projectId: pid, taskId: task.id, path: rel, createdBy: "claude-code" });
  }
  if (extra.retryCount) db.prepare("UPDATE tasks SET retry_count = ? WHERE id = ?").run(extra.retryCount, task.id);
  return { task: store.getTask(pid, task.id)!, missionId: mission.id };
}

const reviewer = (answers: string[] | ((n: number) => string), calls: { svc: string; prompt: string }[] = []): AiReviewer => ({
  ask: async ({ svc, prompt }) => {
    calls.push({ svc: svc.id, prompt });
    const text = typeof answers === "function" ? answers(calls.length) : answers[Math.min(calls.length - 1, answers.length - 1)];
    return text === "FAIL" ? { ok: false, error: "画面が変わりました" } : { ok: true, text };
  },
});
const run = (t: Task, missionId: string, r: AiReviewer) => reviewTask({ store, reviewer: r, mission: store.getMission(pid, missionId)!, task: t, result: { ok: true }, signal: new AbortController().signal });

describe("verdict and importance", () => {
  it("reads the verdict wherever it stands in the answer", () => {
    expect(parseVerdict("判定: 承認\n問題ありません").verdict).toBe("approve");
    expect(parseVerdict("📁 LUM\n\n**判定：要修正**\n- バグ").verdict).toBe("revise");
    expect(parseVerdict("要修正です。理由は…").verdict).toBe("revise");
    expect(parseVerdict("よさそうです").verdict).toBe("unknown");
  });
  it("only design/security/deploy, integration, retried or big code tasks are important", () => {
    const t = (role: string, objective = "x", retryCount = 0) => ({ role, objective, retryCount });
    expect(importanceOf(t("design"), 1)).not.toBeNull();
    expect(importanceOf(t("security"), 0)).not.toBeNull();
    expect(importanceOf(t("coding", "フロントエンドとバックエンドAPIを結合する"), 1)).not.toBeNull();
    expect(importanceOf(t("coding", "x", 1), 1)).not.toBeNull();
    expect(importanceOf(t("coding"), 5)).not.toBeNull();
    expect(importanceOf(t("coding"), 2)).toBeNull();
    for (const role of ["research", "document", "review", "ux_review", "test", "testing"]) expect(importanceOf(t(role, "x", 3), 9)).toBeNull();
  });
  it("knows who makes which AI", () => {
    expect([aiFamily("claude-code"), aiFamily("claude-web"), aiFamily("chatgpt"), aiFamily("gemini"), aiFamily("deepseek")]).toEqual(["claude", "claude", "openai", "google", "deepseek"]);
  });
});

describe("choosing the reviewer", () => {
  it("never picks the author's maker, and needs Level 3, a login and the web AIs switched on", () => {
    expect(pickReviewer(store, "claude-code", "design")?.svc.id).toBe("chatgpt"); // claude-web scores higher but is the same maker
    expect(pickReviewer(store, "chatgpt", "design")?.svc.id).toBe("claude-web");
    store.patchAiService("chatgpt", { automationLevel: 2 });
    expect(pickReviewer(store, "claude-code", "design")?.svc.id).toBe("gemini");
    setWebAiSettings(store, { loggedIn: { "claude-web": true, chatgpt: true } });
    expect(pickReviewer(store, "claude-code", "design")).toBeNull();
    setWebAiSettings(store, { enabled: false });
    expect(pickReviewer(store, "claude-code", "design")).toBeNull();
  });
});

describe("reviewing one task", () => {
  it("approves: records the review as a file, an AI run and events", async () => {
    const { task, missionId } = finishedTask("design", { "design/auth.md": "# 認証\nセッションはCookie" });
    const calls: { svc: string; prompt: string }[] = [];
    const r = await run(task, missionId, reviewer(["判定: 承認\n妥当です"], calls));
    expect(r).toMatchObject({ passed: true, level: AI_REVIEW_LEVEL });
    expect(calls).toHaveLength(1);
    expect(calls[0].svc).toBe("chatgpt");
    expect(calls[0].prompt).toContain("=== design/auth.md ===");
    expect(calls[0].prompt).toContain("セッションはCookie");
    const file = path.join(projectDir(root, pid), "reviews", `${task.id}.md`);
    expect(readFileSync(file, "utf8")).toContain("妥当です");
    expect(store.listArtifacts(pid).some((a) => a.path === `reviews/${task.id}.md`)).toBe(true);
    expect(store.listAiRuns(pid).some((x) => x.executor === "ai-review" && x.status === "succeeded")).toBe(true);
    expect(store.listEvents({ projectId: pid }).map((e) => e.type)).toEqual(expect.arrayContaining(["AI_REVIEW_REQUESTED", "AI_REVIEW_DONE"]));
  });

  it("sends a task back once with the findings, then lets it through", async () => {
    const { task, missionId } = finishedTask("design", { "design/auth.md": "x" });
    const first = await run(task, missionId, reviewer(["判定: 要修正\n- パスワードが平文"]));
    expect(first?.passed).toBe(false);
    expect(first?.detail).toContain("パスワードが平文");
    store.addValidation({ projectId: pid, taskId: task.id, level: AI_REVIEW_LEVEL, status: "failed", detail: first?.detail });
    const second = await run(task, missionId, reviewer(["判定: 要修正\n- まだ平文"]));
    expect(second?.passed).toBe(true);
    expect(second?.detail).toContain("そのまま進めました");
  });

  it("does nothing for unimportant tasks, when switched off, or when the task made no files", async () => {
    const calls: { svc: string; prompt: string }[] = [];
    const small = finishedTask("coding", { "a.js": "1" });
    expect(await run(small.task, small.missionId, reviewer(["判定: 承認"], calls))).toBeNull();
    const design = finishedTask("design", { "d.md": "x" });
    setAiReviewSettings(store, { enabled: false });
    expect(getAiReviewSettings(store).enabled).toBe(false);
    expect(await run(design.task, design.missionId, reviewer(["判定: 承認"], calls))).toBeNull();
    setAiReviewSettings(store, { enabled: true });
    const empty = finishedTask("design", {});
    expect(await run(empty.task, empty.missionId, reviewer(["判定: 承認"], calls))).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("skips (and says so) when the reviewing AI breaks or nobody is available", async () => {
    const { task, missionId } = finishedTask("design", { "d.md": "x" });
    expect(await run(task, missionId, reviewer(["FAIL"]))).toBeNull();
    expect(store.listEvents({ projectId: pid }).some((e) => e.type === "AI_REVIEW_SKIPPED")).toBe(true);
    expect(store.listAiRuns(pid).some((x) => x.executor === "ai-review" && x.status === "failed")).toBe(true);
    setWebAiSettings(store, { enabled: false });
    expect(await run(task, missionId, reviewer(["判定: 承認"]))).toBeNull();
  });
});

describe("inside the engine", () => {
  it("a 要修正 review makes the task run again, then the mission completes; a broken reviewer does not stop it", async () => {
    const planner: Planner = { name: "scripted", plan: async () => ({ summary: "", tasks: [{ key: "a", role: "design", objective: "認証の設計", inputs: [], expectedOutputs: ["design/auth.md"], constraints: [], dependsOn: [] }] }) };
    let executions = 0;
    const executor = {
      name: "fake",
      adapterTypes: ["claude-code"] as const,
      execute: async (task: Task) => {
        executions += 1;
        const abs = path.join(projectDir(root, pid), "design/auth.md");
        mkdirSync(path.dirname(abs), { recursive: true });
        writeFileSync(abs, `版${executions}`);
        store.createArtifact({ projectId: pid, taskId: task.id, path: "design/auth.md", createdBy: "claude-code" });
        return { ok: true, aiId: "claude-code" };
      },
    };
    const calls: { svc: string; prompt: string }[] = [];
    const engine = new MissionEngine(store, { planner, executor, broker: new AIBroker(store), aiReview: { reviewer: reviewer((n) => (n === 1 ? "判定: 要修正\n- 不足あり" : "判定: 承認"), calls) } });
    const { mission } = await engine.createMission({ projectId: pid, goal: "認証" });
    await engine.approvePlan(pid, mission.id);
    expect(await engine.run(pid, mission.id)).toBe("completed");
    expect(executions).toBe(2);
    expect(calls).toHaveLength(2);
    const levels = store.listValidations(pid).map((v) => `${v.level}:${v.status}`);
    expect(levels).toContain(`${AI_REVIEW_LEVEL}:failed`);
    expect(levels).toContain(`${AI_REVIEW_LEVEL}:passed`);
    expect(existsSync(path.join(projectDir(root, pid), "reviews"))).toBe(true);
  });

  it("a reviewer that always breaks never stops the mission", async () => {
    const planner: Planner = { name: "scripted", plan: async () => ({ summary: "", tasks: [{ key: "a", role: "design", objective: "設計", inputs: [], expectedOutputs: ["d.md"], constraints: [], dependsOn: [] }] }) };
    const executor = {
      name: "fake",
      adapterTypes: ["claude-code"] as const,
      execute: async (task: Task) => {
        const abs = path.join(projectDir(root, pid), "d.md");
        mkdirSync(path.dirname(abs), { recursive: true });
        writeFileSync(abs, "x");
        store.createArtifact({ projectId: pid, taskId: task.id, path: "d.md", createdBy: "claude-code" });
        return { ok: true, aiId: "claude-code" };
      },
    };
    const engine = new MissionEngine(store, { planner, executor, broker: new AIBroker(store), aiReview: { reviewer: reviewer(["FAIL"]) } });
    const { mission } = await engine.createMission({ projectId: pid, goal: "x" });
    await engine.approvePlan(pid, mission.id);
    expect(await engine.run(pid, mission.id)).toBe("completed");
  });
});
