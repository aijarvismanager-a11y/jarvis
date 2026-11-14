import { describe, expect, it } from "vitest";
import { diffNotices, restingNotice, snapshotOf, staleApprovalNotices } from "./notify";
import type { Approval, Handoff, Mission } from "./types";

const mission = (id: string, status: string) => ({ id, status, goal: "商品管理アプリ" }) as unknown as Mission;
const approval = { id: "a1", reason: "デプロイ" } as unknown as Approval;
const handoff = { id: "h1", aiName: "ChatGPT" } as unknown as Handoff;

describe("diffNotices", () => {
  it("announces nothing on the first load", () => {
    expect(diffNotices(null, [approval], [handoff], [mission("m1", "completed")])).toEqual([]);
  });
  it("announces only what is new", () => {
    const prev = snapshotOf([], [], [mission("m1", "running")]);
    const n = diffNotices(prev, [approval], [handoff], [mission("m1", "completed")]);
    expect(n.map((x) => x.title)).toEqual(["承認が必要です", "ChatGPT の回答待ちです", "依頼が完了しました"]);
    const again = diffNotices(snapshotOf([approval], [handoff], [mission("m1", "completed")]), [approval], [handoff], [mission("m1", "completed")]);
    expect(again).toEqual([]);
  });
  it("reports failure and a new plan to approve", () => {
    const prev = snapshotOf([], [], [mission("m1", "running")]);
    expect(diffNotices(prev, [], [], [mission("m1", "failed")])[0]?.title).toBe("依頼が止まりました");
    expect(diffNotices(prev, [], [], [mission("m1", "running"), mission("m2", "planning")])[0]?.title).toBe("計画ができました");
  });
});

describe("restingNotice", () => {
  it("announces entering and leaving the wait, never the first load or an unchanged state", () => {
    expect(restingNotice(undefined, true)).toBeNull();
    expect(restingNotice(true, true)).toBeNull();
    expect(restingNotice(false, true)?.title).toContain("使えるAIがありません");
    expect(restingNotice(true, false)?.title).toContain("使えるようになりました");
  });
});

describe("staleApprovalNotices", () => {
  const now = Date.parse("2026-11-14T12:00:00Z");
  const appr = (id: string, minAgo: number) => ({ id, reason: "撮影を始める", createdAt: new Date(now - minAgo * 60_000).toISOString() }) as unknown as Approval;
  it("stays quiet before 10 minutes, reminds once, and again only after 30 more minutes", () => {
    const reminded = new Map<string, number>();
    expect(staleApprovalNotices([appr("a", 5)], now, reminded)).toEqual([]);
    expect(staleApprovalNotices([appr("a", 12)], now, reminded)).toHaveLength(1);
    expect(staleApprovalNotices([appr("a", 20)], now + 8 * 60_000, reminded)).toEqual([]);
    expect(staleApprovalNotices([appr("a", 45)], now + 33 * 60_000, reminded)).toHaveLength(1);
  });
  it("forgets an approval that was answered", () => {
    const reminded = new Map<string, number>();
    staleApprovalNotices([appr("a", 12)], now, reminded);
    staleApprovalNotices([], now + 1000, reminded);
    expect(reminded.size).toBe(0);
  });
});
