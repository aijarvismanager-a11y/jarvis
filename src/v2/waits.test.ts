import { describe, expect, it } from "vitest";
import type { Ctx } from "./context";
import { nextStep } from "./nextStep";
import { summaryLine } from "./screens/summaryLine";
import type { Task, TaskStatus, TaskWait } from "./types";

const tasks = (...s: TaskStatus[]) => s.map((status, i) => ({ id: `t${i}`, role: "testing", status, selectedAi: null }) as Task);
const ctx = (taskWaits: Record<string, TaskWait> = {}) =>
  ({ project: { id: "p" }, mission: { status: "running" }, approvals: [], handoffs: [], services: [], overview: { taskWaits } }) as unknown as Ctx;

describe("a quiet task", () => {
  it("waiting for Claude's limit is not the person's turn", () => {
    const c = ctx({ t0: "limit" });
    expect(summaryLine(tasks("waiting"), c)).toContain("利用枠が回復するのを待っています");
    expect(summaryLine(tasks("waiting"), c)).not.toContain("あなたの操作");
    expect(nextStep(c, tasks("waiting"), () => {}).title).toBe("利用枠の回復待ち");
  });
  it("waiting for a resting AI is not called work in progress", () => {
    expect(summaryLine(tasks("running"), ctx({ t0: "resting" }))).toContain("使えるAIが戻るのを待っています");
  });
  it("asks the person to close a sign-in window", () => {
    expect(nextStep(ctx({ t0: "login" }), tasks("waiting"), () => {}).title).toBe("ログイン用の窓を閉じてください");
  });
  it("says another task is being worked on when one is", () => {
    expect(summaryLine(tasks("running", "waiting"), ctx({ t1: "limit" }))).toContain("進めています");
    expect(nextStep(ctx({ t1: "limit" }), tasks("running", "waiting"), () => {}).title).toBe("AI が作業しています");
  });
});
