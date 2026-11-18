import { describe, expect, it } from "vitest";
import { sameCheck, repeatedUnverified, decideFollowUp, autoFollowUp, followUpDepth, followUpOfKey, AUTO_FOLLOW_UP_SETTING, MAX_FOLLOW_UP_DEPTH } from "./autoFollowUp.ts";
import { acceptanceKey, type Acceptance } from "./acceptance.ts";
import { nextIdeasKey } from "./nextIdeas.ts";
import { openDatabase } from "./db.ts";
import { Store } from "./store.ts";

const acc = (statuses: ("met" | "partial" | "unmet" | "unknown")[], score: number | null = 50): Acceptance => ({
  missionId: "m",
  at: "t",
  summary: "",
  score,
  items: statuses.map((status, i) => ({ requirement: `r${i}`, status, evidence: "" })),
});
const idea = { title: "仕上げ", request: "舞台切替のプレイヤーを作ってください。終わりの目安は撮影で確認。" };
const base = { enabled: true, acceptance: acc(["met", "partial"]), recommended: idea, alreadyDone: false, depth: 0, openMissions: 0 };

describe("decideFollowUp", () => {
  it("makes a follow-up when something is partly or not met", () => {
    expect(decideFollowUp(base)).toMatchObject({ create: true, request: idea.request, depth: 1 });
    expect(decideFollowUp({ ...base, acceptance: acc(["unmet"], 0) })).toMatchObject({ create: true });
  });
  it("makes none when everything is met and the score is high", () => {
    expect(decideFollowUp({ ...base, acceptance: acc(["met", "met"], 100) })).toMatchObject({ create: false });
  });
  it("makes one for a low score even if nothing is marked", () => {
    expect(decideFollowUp({ ...base, acceptance: acc(["met", "unknown"], 50) })).toMatchObject({ create: true });
  });
  it("does nothing when switched off, already done, no check, no idea, too deep, or another request is open", () => {
    expect(decideFollowUp({ ...base, enabled: false })).toMatchObject({ create: false });
    expect(decideFollowUp({ ...base, alreadyDone: true })).toMatchObject({ create: false });
    expect(decideFollowUp({ ...base, acceptance: null })).toMatchObject({ create: false });
    expect(decideFollowUp({ ...base, recommended: null })).toMatchObject({ create: false });
    expect(decideFollowUp({ ...base, depth: MAX_FOLLOW_UP_DEPTH })).toMatchObject({ create: false });
    expect(decideFollowUp({ ...base, openMissions: 1 })).toMatchObject({ create: false });
  });
});

function setup() {
  const store = new Store(openDatabase(":memory:"), "unused");
  const project = store.createProject({ name: "p" });
  const m = store.createMission({ projectId: project.id, goal: "g", status: "completed" });
  store.setSetting(acceptanceKey(m.id), acc(["partial", "unmet"], 38));
  store.setSetting(nextIdeasKey(m.id), { missionId: m.id, at: "t", ideas: [{ title: "仕上げ", why: "w", request: idea.request, effort: "medium", recommended: true }] });
  return { store, projectId: project.id, missionId: m.id };
}

describe("autoFollowUp", () => {
  it("creates one follow-up request, links it, and does not make a second one", async () => {
    const { store, projectId, missionId } = setup();
    const made: string[] = [];
    const create = async (i: { projectId: string; goal: string }) => {
      made.push(i.goal);
      return { mission: store.createMission({ projectId: i.projectId, goal: i.goal, status: "planning" }) };
    };
    const first = await autoFollowUp(store, create, projectId, missionId);
    expect(first.create).toBe(true);
    expect(made).toEqual([idea.request]);
    const child = store.listMissions(projectId).find((m) => m.id !== missionId)!;
    expect(store.getSetting(followUpOfKey(child.id), null)).toMatchObject({ from: missionId, depth: 1 });
    expect(followUpDepth(store, child.id)).toBe(1);
    expect(store.listEvents({ projectId, type: "AUTO_FOLLOW_UP_CREATED" })).toHaveLength(1);
    // a second completion signal (or a restart) must not make another
    const second = await autoFollowUp(store, create, projectId, missionId);
    expect(second.create).toBe(false);
    expect(made).toHaveLength(1);
  });

  it("is switched off by the setting", async () => {
    const { store, projectId, missionId } = setup();
    store.setSetting(AUTO_FOLLOW_UP_SETTING, false);
    let called = 0;
    const r = await autoFollowUp(store, async () => { called++; return { mission: { id: "x" } }; }, projectId, missionId);
    expect(r.create).toBe(false);
    expect(called).toBe(0);
  });

  it("never throws when the planner fails, and records nothing as created", async () => {
    const { store, projectId, missionId } = setup();
    const r = await autoFollowUp(store, async () => { throw new Error("planner down"); }, projectId, missionId);
    expect(r.create).toBe(false);
    expect(store.listEvents({ projectId, type: "AUTO_FOLLOW_UP_FAILED" })).toHaveLength(1);
    expect(store.listEvents({ projectId, type: "AUTO_FOLLOW_UP_CREATED" })).toHaveLength(0);
    // a failure leaves no "already done" mark, so it can be tried again
    const again = await autoFollowUp(store, async (i) => ({ mission: store.createMission({ projectId: i.projectId, goal: i.goal, status: "planning" }) }), projectId, missionId);
    expect(again.create).toBe(true);
  });
});

describe("stopping a follow-up that repeats a check which cannot be done", () => {
  const a = "パソコンの動画モードに戻して tests/manual-assets/sample.mp4 を開いて再生する。動画が映り音が出ること";
  const b = "live_site が完了している場合のみ実行する。動画モードに切り替えて tests/manual-assets/sample.mp4 を開き、再生する";
  it("sees the same check worded differently, but not an unrelated one", () => {
    expect(sameCheck(a, b)).toBe(true);
    expect(sameCheck(a, "dotnet build HyperPlayer.App.csproj を1回実行して警告の数を記録する")).toBe(false);
  });
  it("stops when a check stayed unverified in this request and in the one it followed", () => {
    const store = new Store(openDatabase(":memory:"), "unused");
    store.createProject({ id: "p", name: "p" });
    const note = (mid: string, o: string) => store.appendEvent({ projectId: "p", type: "CHECKS_NOT_DONE", payload: { missionId: mid, tasks: [{ id: "t", objective: o }] } });
    store.setSetting(followUpOfKey("m2"), { from: "m1", depth: 1 });
    note("m1", a);
    expect(repeatedUnverified(store, "m2")).toBeNull(); // m2 had no unverified check
    note("m2", b);
    expect(repeatedUnverified(store, "m2")).toBe(b);
    expect(decideFollowUp({ ...base, repeatedUnverified: b })).toMatchObject({ create: false });
    expect((decideFollowUp({ ...base, repeatedUnverified: b }) as { reason: string }).reason).toContain("未確認");
    expect(repeatedUnverified(store, "m1")).toBeNull(); // m1 followed nothing
  });
});

describe("an idea that makes the AI edit its own permissions", () => {
  it("is not followed up automatically", () => {
    const risky = { title: "許可を直す", request: "拒否される操作を直す。.claude/settings.local.json に許可リストへの追加を行う。" };
    const d = decideFollowUp({ ...base, recommended: risky });
    expect(d).toMatchObject({ create: false });
    expect((d as { reason: string }).reason).toContain("許可設定");
  });
});

describe("stopping follow-ups that go round the same file or need a person", () => {
  const prev = ["HyperPlayer の _ai-records/stage-approve-fix/cmd-spec.md だけを直してください。"];
  it("does not follow up on a file the request (or its chain) already worked on", () => {
    const same = { title: "cmd-spec.md の最終点検", request: "HyperPlayer で _ai-records/stage-approve-fix/cmd-spec.md を全文読み直して確認してください。" };
    const d = decideFollowUp({ ...base, recommended: same, previousGoals: prev });
    expect(d).toMatchObject({ create: false });
    expect((d as { reason: string }).reason).toContain("cmd-spec.md");
    // a new file, or no file at all, still goes on
    expect(decideFollowUp({ ...base, recommended: { title: "別", request: "docs/other.md を作ってください" }, previousGoals: prev })).toMatchObject({ create: true });
    expect(decideFollowUp({ ...base, previousGoals: prev })).toMatchObject({ create: true });
    // one new file next to an old one is new work
    expect(decideFollowUp({ ...base, recommended: { title: "x", request: "cmd-spec.md と new-file.md を直す" }, previousGoals: prev })).toMatchObject({ create: true });
  });

  it("does not follow up on work only a person can do", () => {
    for (const request of ["人が cmd-spec-verify.md を手で削除するか削除を承認した後に ls で確認してください。", "人が通常のPowerShellで run.ps1 を1回実行してください。", "SHA256を人が1回取得してください。"]) {
      const d = decideFollowUp({ ...base, recommended: { title: "t", request } });
      expect(d, request).toMatchObject({ create: false });
      expect((d as { reason: string }).reason).toContain("人が手で行う");
    }
  });

  it("stops after 3 automatic follow-ups in 2 hours, even when a person started the later requests", () => {
    expect(decideFollowUp({ ...base, recentFollowUps: 2 })).toMatchObject({ create: true });
    const d = decideFollowUp({ ...base, recentFollowUps: 3 });
    expect(d).toMatchObject({ create: false });
    expect((d as { reason: string }).reason).toContain("2時間");
  });
});
