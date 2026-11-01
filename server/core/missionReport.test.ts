import { describe, expect, it } from "vitest";
import { openDatabase } from "./db.ts";
import { Store } from "./store.ts";
import { MissionEngine } from "./missionEngine.ts";
import { buildMissionReport, statedStatus } from "./missionReport.ts";

const task = (key: string, role: string, dependsOn: string[] = []) => ({ key, role, objective: `${key}を行う`, inputs: [], expectedOutputs: [], constraints: [], dependsOn });

async function runMission(level: number | null, docRole = "documentation") {
  const db = openDatabase(":memory:");
  const store = new Store(db, "unused");
  store.createProject({ id: "p", name: "p" });
  const engine = new MissionEngine(store, {
    planner: { name: "x", plan: async () => ({ summary: "", tasks: [] }) },
    executor: { name: "e", execute: async () => ({ ok: true, artifacts: ["a.js"] }) },
    validator: { validate: async () => ({ passed: true, level: level ?? 1 }) },
  });
  const m = engine.startFixedMission({ projectId: "p", goal: "アプリ", draft: { summary: "", tasks: [task("doc", docRole), task("impl", "coding", ["doc"])] } });
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
  it("says so when a research deliverable admits it could not check what it was asked", async () => {
    const { store, db, m } = await runMission(4, "review");
    const admits = "結論: 未確認。実ファイルが読めなかった。行番号は確認できていない。";
    const reviewTask = store.listTasks("p").find((t) => t.role === "review")!;
    store.createArtifact({ projectId: "p", taskId: reviewTask.id, path: "review/x.md", createdBy: "test" });
    const r = buildMissionReport(store, "p", m.id, () => admits);
    expect(r.tasks.find((t) => !t.isCode)?.inconclusive).toBe(true);
    expect(r.notChecked.join()).toContain("答えが出ていません");
    expect(buildMissionReport(store, "p", m.id, () => "問題なし").tasks.some((t) => t.inconclusive)).toBe(false);
    db.close();
  });
  it("takes the deliverable's own statement of how far it got over counting phrases", async () => {
    const { store, db, m } = await runMission(4, "review");
    const reviewTask = store.listTasks("p").find((t) => t.role === "review")!;
    store.createArtifact({ projectId: "p", taskId: reviewTask.id, path: "review/y.md", createdBy: "test" });
    const noisy = "対象外の3ファイルは未確認。読めなかった資料もある。確認できていない箇所は無関係。\n確認状況: 確定";
    expect(buildMissionReport(store, "p", m.id, () => noisy).tasks.some((t) => t.inconclusive)).toBe(false);
    // "partly confirmed" answers the question and names what is still open: not the same as "no answer"
    const partly = buildMissionReport(store, "p", m.id, () => "結論です。\n確認状況：一部未確認");
    expect(partly.tasks.some((t) => t.inconclusive)).toBe(false);
    expect(partly.tasks.some((t) => t.partly)).toBe(true);
    expect(partly.notChecked.join()).toContain("確認できていない点が残っている");
    expect(partly.nextSteps.join("\n")).toContain("失敗ではありません");
    const none = buildMissionReport(store, "p", m.id, () => "分かりません。\n確認状況：確認できず");
    expect(none.tasks.some((t) => t.inconclusive)).toBe(true);
    const unanswered = none.todos.find((x) => x.id.startsWith("unanswered"));
    expect(unanswered).toMatchObject({ required: true });
    expect(unanswered!.actions.map((a) => a.kind)).toEqual(expect.arrayContaining(["artifact", "new_request"]));
    expect(unanswered!.steps.length).toBeGreaterThan(2);
    // the markdown copy also says what to do
    expect(none.markdown).toContain("あなたがやること");
    expect(statedStatus("確認状況: 確認できず")).toBe("none");
    expect(statedStatus("何も書いていない")).toBeNull();
    db.close();
  });
  it("tells the person that nothing is needed when only optional checks remain, and explains a command the AI was not allowed to run", async () => {
    const { store, db, m } = await runMission(2, "test");
    const t = store.listTasks("p").find((x) => x.role === "test")!;
    store.createArtifact({ projectId: "p", taskId: t.id, path: "review/build.md", createdBy: "test" });
    const denied = "dotnet build は承認が必要(DESTRUCTIVE)なため実行できなかった。\n確認状況: 確認できず";
    const r = buildMissionReport(store, "p", m.id, () => denied);
    expect(r.todos.some((x) => x.required)).toBe(false);
    const cannot = r.todos.find((x) => x.id.startsWith("cannot-run"))!;
    expect(cannot.actions).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "sync" })]));
    expect(r.markdown).toContain("いまは、あなたがやることはありません");
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

  it("a task whose job is to list the unconfirmed points is not 'inconclusive' for saying 未確認 many times", () => {
    const store = new Store(openDatabase(":memory:"), "unused");
    store.createProject({ id: "p", name: "p" });
    const m = store.createMission({ projectId: "p", goal: "g", status: "completed" });
    const t = store.createTask({ projectId: "p", missionId: m.id, role: "review", objective: "最終の未確認事項一覧を作成する", expectedOutputs: ["review/list.md"] } as never);
    store.setTaskStatus("p", t.id, "completed");
    store.createArtifact({ projectId: "p", taskId: t.id, path: "review/list.md", createdBy: "x" });
    const text = "未確認: A\n未確認: B\n未確認: C\n未確認: D";
    expect(buildMissionReport(store, "p", m.id, () => text).tasks[0]!.inconclusive).toBe(false);
  });
});

describe("deliver to-do for projects made in the app", () => {
  it("asks the person to put the result into the delivery folder", async () => {
    const { store, db, m } = await runMission(4);
    store.setSetting("source:p", { sourcePath: "D:/Desktop/p", importedAt: "", baseline: {}, exclude: [], createdByApp: true });
    const r = buildMissionReport(store, "p", m.id);
    const t = r.todos?.find((x) => x.id === "deliver");
    expect(t?.required).toBe(true);
    expect(t?.actions[0]?.kind).toBe("sync");
    db.close();
  });
  it("does not ask for imported projects", async () => {
    const { store, db, m } = await runMission(4);
    store.setSetting("source:p", { sourcePath: "D:/x", importedAt: "", baseline: {}, exclude: [] });
    expect(buildMissionReport(store, "p", m.id).todos?.some((x) => x.id === "deliver")).toBe(false);
    db.close();
  });
});

describe("statedStatus", () => {
  it("reads the verdict even with words before it", async () => {
    const { statedStatus } = await import("./missionReport.ts");
    expect(statedStatus("未確認 未確認 未確認\n確認状況: 設計確定(コード変更なし)")).toBe("settled");
    expect(statedStatus("確認状況: 一部未確認")).toBe("partly");
    expect(statedStatus("確認状況: 確認できず")).toBe("none");
  });
});

describe("review findings left after the allowed revision", () => {
  it("shows an optional to-do with the review file, and only for a review still saying 要修正 after a revision", async () => {
    const { store, db, m } = await runMission(4, "review");
    const t = store.listTasks("p")[0]!;
    store.appendEvent({ projectId: "p", taskId: t.id, type: "AI_REVIEW_DONE", payload: { reviewer: "x", verdict: "revise", revisions: 0 } });
    expect(buildMissionReport(store, "p", m.id).todos?.some((x) => x.id === "review-open")).toBe(false);
    store.appendEvent({ projectId: "p", taskId: t.id, type: "AI_REVIEW_DONE", payload: { reviewer: "x", verdict: "revise", revisions: 1 } });
    const todo = buildMissionReport(store, "p", m.id).todos?.find((x) => x.id === "review-open");
    expect(todo?.required).toBe(false);
    expect(todo?.actions[0]).toMatchObject({ kind: "artifact", path: `_ai-records/reviews/${t.id}.md` });
    store.appendEvent({ projectId: "p", taskId: t.id, type: "AI_REVIEW_DONE", payload: { reviewer: "x", verdict: "approve", revisions: 1 } });
    expect(buildMissionReport(store, "p", m.id).todos?.some((x) => x.id === "review-open")).toBe(false);
    db.close();
  });
});
