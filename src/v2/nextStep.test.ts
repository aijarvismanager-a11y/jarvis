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
