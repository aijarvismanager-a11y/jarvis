import { describe, expect, it } from "vitest";
import { applyDelegations, delegationState, parseHumanTodoFile, parseLegacyHumanTodo } from "./humanTodos.ts";

describe("handing a to-do to the AI", () => {
  const todos = () => parseHumanTodoFile("## やること: A\n1. x\n2. y\n\n## やること: B\n1. z\n");
  const idA = todos()[0].id;
  const rec = (steps: number[] | null, missionId = "m1", at = "2026-11-25T00:00:00Z") => ({ todoId: idA, missionId, steps, at });
  it("maps a request's status to active / completed / failed (a vanished request counts as failed)", () => {
    expect(["draft", "planning", "running", "paused"].map(delegationState)).toEqual(["active", "active", "active", "active"]);
    expect(delegationState("completed")).toBe("completed");
    expect(["failed", "cancelled", null].map(delegationState)).toEqual(["failed", "failed", "failed"]);
  });
  it("hides a to-do handed over whole while the AI works and when it finished, but brings it back when the request failed", () => {
    expect(applyDelegations(todos(), [rec(null)], () => "running").map((t) => t.title)).toEqual(["B"]);
    expect(applyDelegations(todos(), [rec(null)], () => "completed").map((t) => t.title)).toEqual(["B"]);
    const back = applyDelegations(todos(), [rec(null)], () => "failed");
    expect(back.map((t) => t.title)).toEqual(["A", "B"]);
    expect(back[0].delegation).toMatchObject({ state: "failed", missionId: "m1", steps: null });
    expect(applyDelegations(todos(), [rec(null)], () => null).map((t) => t.title)).toEqual(["A", "B"]);
  });
  it("keeps a to-do handed over in part, with the state and the steps; the newest hand-over wins", () => {
    const t = applyDelegations(todos(), [rec([0], "m1", "2026-11-25T00:00:00Z"), rec([1], "m2", "2026-11-25T01:00:00Z")], (id) => (id === "m2" ? "running" : "failed"));
    expect(t[0].delegation).toEqual({ missionId: "m2", steps: [1], state: "active" });
    expect(t[1].delegation).toBeNull();
  });
});

describe("human todos", () => {
  it("reads the fixed shape: title, reason, numbered steps with commands; finished ones are skipped", () => {
    const t = parseHumanTodoFile("# メモ\n\n## やること: インストーラーを作る\n理由: 人の目でしか確認できない\n1. フォルダで `powershell -File a.ps1` を実行する\n2. 「OK」と出れば成功\n\n## 済: 古いこと\n1. 何か\n");
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ title: "インストーラーを作る", why: "人の目でしか確認できない", source: "file" });
    expect(t[0].steps.map((s) => s.command)).toEqual(["powershell -File a.ps1", null]);
    expect(t[0].id).toBe(parseHumanTodoFile("## やること: インストーラーを作る\n1. x")[0].id);
  });
  it("takes the newest old-style line from a project record", () => {
    const text = "  - **人が1回行うこと（古い・ここで止める）**: `old.ps1` を実行する。\n  - **人が1回行うこと（インストーラー作成・ここで止める）**: プロジェクトのフォルダで `powershell -File installer\b.ps1` を実行する。最後に OK と出れば成功。結果を表に書く。";
    const t = parseLegacyHumanTodo(text)!;
    expect(t.source).toBe("legacy");
    expect(t.steps.length).toBe(3);
    expect(t.steps[0].command).toBe("powershell -File installer\b.ps1");
    expect(parseLegacyHumanTodo("**人が1回行うこと**: `a.ps1` を実行する。`OK: x.exe` と出れば成功。結果を `docs/m.md` に書く")!.steps.map((x) => x.command)).toEqual(["a.ps1", null, null]);
    expect(parseLegacyHumanTodo("人が何かする")).toBeNull();
  });
});
