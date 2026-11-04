import { describe, expect, it } from "vitest";
import { nextStep } from "./nextStep";
import type { Ctx } from "./context";

const ctx = (status: string) => ({ project: { id: "p" }, mission: { id: "m", status }, approvals: [], handoffs: [] }) as unknown as Ctx;

describe("nextStep while a plan is made", () => {
  it("tells the person to wait until the proposal exists, then to review it", () => {
    expect(nextStep(ctx("planning"), [], () => {}, false).tone).toBe("wait");
    expect(nextStep(ctx("planning"), [], () => {}, true).title).toContain("計画を確認");
  });
});

describe("nextStep while every AI is resting", () => {
  it("says the work waits and goes on by itself, instead of claiming an AI is working", () => {
    const task = { id: "t", role: "research", status: "running" } as never;
    expect(nextStep(ctx("running"), [task], () => {}, true, false).title).toBe("AI が作業しています");
    const step = nextStep(ctx("running"), [task], () => {}, true, true);
    expect(step.tone).toBe("wait");
    expect(step.title).toContain("使えるAIがありません");
  });
});
