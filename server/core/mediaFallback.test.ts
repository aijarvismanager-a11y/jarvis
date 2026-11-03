import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "./db.ts";
import { resolveInProject } from "./paths.ts";
import { Store } from "./store.ts";
import { WebAiExecutor } from "./webAiExecutor.ts";
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
