import { describe, expect, it } from "vitest";
import { diffNotices, snapshotOf } from "./notify";
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
    expect(n.map((x) => x.title)).toEqual(["承認が必要です", "ChatGPT の回答待ちです", "ミッションが完了しました"]);
    const again = diffNotices(snapshotOf([approval], [handoff], [mission("m1", "completed")]), [approval], [handoff], [mission("m1", "completed")]);
    expect(again).toEqual([]);
  });
  it("reports failure and a new plan to approve", () => {
    const prev = snapshotOf([], [], [mission("m1", "running")]);
    expect(diffNotices(prev, [], [], [mission("m1", "failed")])[0]?.title).toBe("ミッションが止まりました");
    expect(diffNotices(prev, [], [], [mission("m1", "running"), mission("m2", "planning")])[0]?.title).toBe("計画ができました");
  });
});
