import { describe, expect, it } from "vitest";
import { describeEvent, explainFailure, missionFailureReason } from "./labels";

describe("failure reasons", () => {
  const events = [
    { type: "MISSION_STATUS_CHANGED", payload: { missionId: "m1", from: "planning", to: "failed", reason: "planner error: Claude Codeが異常終了しました(code=1): " } },
  ];
  it("finds the reason of the failed mission only", () => {
    expect(missionFailureReason(events, "m1")).toContain("planner error");
    expect(missionFailureReason(events, "other")).toBeNull();
  });
  it("explains a crashed planner in plain words", () => {
    const { what, hint } = explainFailure(missionFailureReason(events, "m1"));
    expect(what).toContain("計画を立てる段階で失敗");
    expect(hint).toContain("ログイン");
  });
  it("spells out status changes in the history", () => {
    expect(describeEvent(events[0])).toBe("依頼: 計画の承認待ち → 失敗 — 計画を立てる段階で失敗しました(Claude Codeが異常終了しました(code=1))");
  });
});
