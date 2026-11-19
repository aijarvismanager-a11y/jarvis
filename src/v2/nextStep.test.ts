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

describe("nextStep when an approval has waited a long time", () => {
  const at = (minAgo: number, now: number) => new Date(now - minAgo * 60_000).toISOString();
  const withApproval = (createdAt: string) => ({ ...ctx("running"), project: { id: "p" }, approvals: [{ id: "a", projectId: "p", createdAt }] }) as unknown as Ctx;
  it("keeps the ordinary wording at first, then says how many minutes the work has been waiting", () => {
    const now = Date.now();
    expect(nextStep(withApproval(at(3, now)), [], () => {}, true, false, now).title).toBe("あなたの許可が必要です");
    const late = nextStep(withApproval(at(25, now)), [], () => {}, true, false, now);
    expect(late.tone).toBe("bad");
    expect(late.title).toContain("25 分待っています");
  });
});

describe("nextStep for a failed request gives ONE answer", () => {
  const acts = () => { const log: string[] = []; return { log, a: { replan: () => log.push("replan"), retry: (id: string) => log.push(`retry:${id}`) } }; };
  const failed = (id: string, retryCount: number) => ({ id, role: "coding", status: "failed", retryCount }) as never;
  it("no task at all (planning failed): replan", () => {
    const { log, a } = acts();
    const s = nextStep(ctx("failed"), [], () => {}, true, false, Date.now(), a);
    expect(s.action?.label).toBe("計画をやり直す");
    s.action!.run();
    expect(log).toEqual(["replan"]);
  });
  it("a task failed a few times: redo that task first", () => {
    const { log, a } = acts();
    const s = nextStep(ctx("failed"), [failed("t1", 1)], () => {}, true, false, Date.now(), a);
    expect(s.action?.label).toBe("この作業をやり直す");
    s.action!.run();
    expect(log).toEqual(["retry:t1"]);
  });
  it("a task the person refused to allow: says nothing went wrong, and redo only asks again", () => {
    const { log, a } = acts();
    const c = { ...ctx("failed"), overview: { taskNotes: { t1: "この操作には承認が必要です(DESTRUCTIVE)。承認されなかったため実行しませんでした" } } } as unknown as Ctx;
    const s = nextStep(c, [failed("t1", 1)], () => {}, true, false, Date.now(), a);
    expect(s.title).toContain("許可しなかった");
    expect(s.tone).toBe("wait");
    s.action!.run();
    expect(log).toEqual(["retry:t1"]);
  });
  it("the same task failed 3 times (the app stopped retrying): replan, not redo", () => {
    const { a } = acts();
    const s = nextStep(ctx("failed"), [failed("t1", 3), failed("t2", 0)], () => {}, true, false, Date.now(), a);
    expect(s.action?.label).toBe("計画をやり直す");
    expect(s.title).toContain("計画から立て直します");
  });
});
