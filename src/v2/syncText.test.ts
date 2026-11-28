import { describe, expect, it } from "vitest";
import type { Ctx } from "./context";
import { replySummary } from "./dock";
import { nextStep } from "./nextStep";
import { applyNotice, restoreNotice } from "./syncText";
import type { Task } from "./types";

const ctx = (toReflect: number, createdByApp = false) => ({ project: { id: "p" }, mission: { status: "completed" }, approvals: [], handoffs: [], sync: { linked: true, push: toReflect, pull: 0, toReflect, createdByApp } }) as unknown as Ctx;
const done = [{ status: "completed" } as Task];

describe("a finished request with changes not yet in the folder", () => {
  it("offers the button that opens the reflect screen", () => {
    const step = nextStep(ctx(2), done, () => {});
    expect(step.action?.label).toBe("反映の画面を開く");
    expect(step.detail).toContain("元のフォルダ");
    expect(nextStep(ctx(2, true), done, () => {}).detail).toContain("保存先のフォルダ");
    expect(nextStep(ctx(0), done, () => {}).action?.label).toBe("新しい依頼を出す");
  });
  it("does not say there is nothing to do when the folder cannot be looked at", () => {
    const next = replySummary(done, "completed", 0, undefined, { count: 0, place: "保存先のフォルダ", problem: true }).next;
    expect(next).toContain("反映できません");
  });
  it("does not say there is nothing to do", () => {
    expect(replySummary(done, "completed", 0, undefined, { count: 2, place: "元のフォルダ" }).next).toContain("まだ元のフォルダに入っていません");
    expect(replySummary(done, "completed", 0, undefined, { count: 0, place: "元のフォルダ" }).next).toContain("やることはありません");
  });
});

describe("what a reflect and an undo report", () => {
  it("names the files that were left out", () => {
    const n = applyNotice("元のフォルダ", { applied: 1, skipped: [{ path: "app.js" }] });
    expect(n.tone).toBe("warn");
    expect(n.lines.join()).toContain("app.js");
    expect(applyNotice("元のフォルダ", { applied: 2, skipped: [] })).toEqual({ tone: "ok", lines: ["2件を元のフォルダに入れました。"] });
  });
  it("says which later work an undo left in place", () => {
    expect(restoreNotice("元のフォルダ", { restored: [], kept: ["new.js"], failed: [] }).lines.join()).toContain("そのまま残しました");
  });
});
