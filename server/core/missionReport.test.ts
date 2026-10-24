import { describe, expect, it } from "vitest";
import { openDatabase } from "./db.ts";
import { Store } from "./store.ts";
import { MissionEngine } from "./missionEngine.ts";
import { buildMissionReport } from "./missionReport.ts";

const task = (key: string, role: string, dependsOn: string[] = []) => ({ key, role, objective: `${key}を行う`, inputs: [], expectedOutputs: [], constraints: [], dependsOn });

async function runMission(level: number | null) {
  const db = openDatabase(":memory:");
  const store = new Store(db, "unused");
  store.createProject({ id: "p", name: "p" });
  const engine = new MissionEngine(store, {
    planner: { name: "x", plan: async () => ({ summary: "", tasks: [] }) },
    executor: { name: "e", execute: async () => ({ ok: true, artifacts: ["a.js"] }) },
    validator: { validate: async () => ({ passed: true, level: level ?? 1 }) },
  });
  const m = engine.startFixedMission({ projectId: "p", goal: "アプリ", draft: { summary: "", tasks: [task("doc", "documentation"), task("impl", "coding", ["doc"])] } });
  await engine.run("p", m.id);
  return { store, db, m };
}

describe("buildMissionReport", () => {
  it("never claims verification beyond the levels that actually passed", async () => {
    const { store, db, m } = await runMission(2);
    const r = buildMissionReport(store, "p", m.id);
    expect(r.status).toBe("completed");
    expect(r.verdict).toBe("partial");
    expect(r.notChecked.join()).toContain("自動テスト");
    expect(r.notChecked.join()).toContain("起動して画面を開く");
    expect(r.tasks.find((t) => t.isCode)?.level).toBe(2);
    expect(r.markdown).toContain("確認していないこと");
    db.close();
  });
  it("is verified only when code tasks passed tests and the integration gate ran", async () => {
    const { store, db, m } = await runMission(4);
    expect(buildMissionReport(store, "p", m.id).verdict).toBe("verified");
    db.close();
  });
  it("is unfinished while the mission has not completed", () => {
    const db = openDatabase(":memory:");
    const store = new Store(db, "unused");
    store.createProject({ id: "p", name: "p" });
    const mission = store.createMission({ projectId: "p", goal: "g", status: "running" });
    expect(buildMissionReport(store, "p", mission.id).verdict).toBe("unfinished");
    db.close();
  });
});
