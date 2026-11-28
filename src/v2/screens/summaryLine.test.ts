import { describe, expect, it } from "vitest";
import type { Ctx } from "../context";
import { progressOf } from "../labels";
import type { Approval, MissionStatus, Task, TaskStatus } from "../types";
import { summaryLine } from "./summaryLine";

const tasks = (...s: TaskStatus[]) => s.map((status, i) => ({ id: `t${i}`, role: "testing", status, selectedAi: null }) as Task);
const ctx = (status: MissionStatus, asked: string[] = []) => ({ mission: { status }, approvals: asked.map((taskId) => ({ taskId }) as Approval), services: [] }) as unknown as Ctx;

describe("summaryLine", () => {
  it("says where the permission buttons are", () => {
    expect(summaryLine(tasks("running"), ctx("running", ["t0"]))).toContain("ホームの「許可が必要」のカード");
  });
  it("says a paused request is paused", () => {
    expect(summaryLine(tasks("completed", "paused"), ctx("paused"))).toContain("一時停止中です");
    expect(summaryLine(tasks("completed", "pending"), ctx("paused"))).toContain("「再開」");
  });
  it("does not say all work finished when every task was cancelled", () => {
    expect(summaryLine(tasks("cancelled", "cancelled"), ctx("cancelled"))).toContain("どの作業も終わっていません");
  });
});

describe("progressOf", () => {
  it("counts the work never done in a stopped request, not the replaced work of one that goes on", () => {
    expect(progressOf(tasks("completed", "cancelled", "cancelled"), true)).toEqual({ done: 1, total: 3, percent: 33 });
    expect(progressOf(tasks("completed", "cancelled"))).toEqual({ done: 1, total: 1, percent: 100 });
  });
});
