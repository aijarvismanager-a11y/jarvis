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

describe("nextStep while an approval waits", () => {
  const withApprovals = (approvals: object[]) => ({ ...ctx("running"), approvals }) as unknown as Ctx;
  it("names a refused command, not a deletion, when the approval is for one command", () => {
    const step = nextStep(withApprovals([{ projectId: "p", command: "powershell -File a.ps1" }]), [], () => {});
    expect(step.title).toBe("あなたの許可が必要です");
    expect(step.detail).toContain("コマンド");
    expect(step.detail).not.toContain("削除");
  });
  it("keeps the deletion / publishing wording for the other approvals", () => {
    expect(nextStep(withApprovals([{ projectId: "p", level: "DEPLOY" }]), [], () => {}).detail).toContain("削除や公開");
  });
});
