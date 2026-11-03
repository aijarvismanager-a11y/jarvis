import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "./db.ts";
import { resolveInProject } from "./paths.ts";
import { Store, type Task } from "./store.ts";
import { RoutingExecutor, WebAiExecutor } from "./webAiExecutor.ts";
import { WebHandoffHub } from "./webHandoff.ts";

let db: Db;
let store: Store;
let root: string;

beforeEach(() => {
  db = openDatabase(":memory:");
  root = mkdtempSync(path.join(os.tmpdir(), "media-fallback-"));
  store = new Store(db, root);
  store.createProject({ id: "p1", name: "p" });
  store.upsertAiService({ id: "ideogram", name: "Ideogram", url: "https://ideogram.test", accessMode: "web", adapterType: "manual", automationLevel: 1, freeStatus: "free_tier" });
});
afterEach(() => {
  db.close();
  rmSync(root, { recursive: true, force: true });
});

function setup(role: string, objective: string, expectedOutputs: string[]) {
  const mission = store.createMission({ projectId: "p1", goal: "カフェの素材", status: "running" });
  const task = store.createTask({ projectId: "p1", missionId: mission.id, role, objective, expectedOutputs, selectedAi: "ideogram", status: "running" });
  const web = new WebAiExecutor(store, new WebHandoffHub(store), {});
  return { mission, task, web };
}

describe("the router, when no automatic AI can take picture or music work", () => {
  const route = () => {
    store.upsertAiService({ id: "claude-code", name: "Claude Code", url: null, accessMode: "cli", adapterType: "claude-code", automationLevel: 3, freeStatus: "free_tier" });
    const calls: string[] = [];
    const code = { name: "code", adapterTypes: ["claude-code"] as const, execute: async (t: Task) => { calls.push(`${t.selectedAi}|${t.objective.includes("SVG")}`); return { ok: true }; } };
    const web = new WebAiExecutor(store, new WebHandoffHub(store), {});
    return { calls, router: new RoutingExecutor(store, code, web) };
  };
  const make = (role: string, expectedOutputs: string[]) => {
    const mission = store.createMission({ projectId: "p1", goal: "g", status: "running" });
    return { mission, task: store.createTask({ projectId: "p1", missionId: mission.id, role, objective: "素材を作る", expectedOutputs, status: "running" }) };
  };

  it("runs a picture as an SVG on Claude Code, and puts music on hold without running anything", async () => {
    const { calls, router } = route();
    const pic = make("illustration", ["assets/a.png"]);
    expect(await router.execute(pic.task, { mission: pic.mission, signal: new AbortController().signal })).toMatchObject({ ok: true });
    expect(calls).toEqual(["claude-code|true"]);
    const music = make("music", ["assets/a.mp3"]);
    const res = await router.execute(music.task, { mission: music.mission, signal: new AbortController().signal });
    expect(res.summary).toContain("保留");
    expect(calls).toHaveLength(1);
  });

  it("when the SVG did not work and no image AI is usable, puts the picture on hold instead of looping", async () => {
    const { calls, router } = route();
    const pic = make("illustration", ["assets/a.png"]);
    await router.execute(pic.task, { mission: pic.mission, signal: new AbortController().signal });
    db.prepare("UPDATE tasks SET retry_count = 1 WHERE id = ?").run(pic.task.id);
    const again = store.getTask("p1", pic.task.id)!;
    const res = await router.execute(again, { mission: pic.mission, signal: new AbortController().signal });
    expect(res.summary).toContain("保留");
    expect(calls).toHaveLength(1);
  });
});

describe("picture, music and video work never waits for a person at an English site", () => {
  it("hands a picture to Claude Code as an SVG, with the expected file renamed", async () => {
    const { mission, task, web } = setup("illustration", "店のロゴ画像を1枚作成する", ["assets/logo/logo.png"]);
    const res = await web.execute(task, { mission, signal: new AbortController().signal });
    expect(res).toMatchObject({ ok: false, fallback: true });
    const after = store.getTask("p1", task.id)!;
    expect(after.expectedOutputs).toEqual(["assets/logo/logo.svg"]);
    expect(after.objective).toContain("SVG");
    expect(after.objective).toContain("assets/logo/logo.svg");
  });

  it("puts music on hold with a note of what was meant to be made, and lets the mission go on", async () => {
    const { mission, task, web } = setup("music", "店内で流すBGMを1曲作成する", ["assets/bgm/bgm.mp3"]);
    const res = await web.execute(task, { mission, signal: new AbortController().signal });
    expect(res).toMatchObject({ ok: true });
    expect(res.summary).toContain("保留");
    const rel = store.getTask("p1", task.id)!.expectedOutputs[0]!;
    expect(rel).toContain("pending-media");
    const file = resolveInProject(store.projectsRoot, "p1", rel);
    expect(existsSync(file)).toBe(true);
    const text = readFileSync(file, "utf8");
    expect(text).toContain("まだ作られていません");
    expect(text).toContain("assets/bgm/bgm.mp3");
  });
});
