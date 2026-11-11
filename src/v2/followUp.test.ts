import { describe, expect, it } from "vitest";
import { condenseAnswers, shortGoal } from "./labels";

describe("shortGoal for a follow-up request", () => {
  const goal = "これまでの回答について、次の確認への答えを反映して、やり直し・修正してください:\n質問: 確認の優先順位は?\n答え: レイアウト順が先で良い\n質問: 直す?\n答え: 直して\n\n【これまでの回答(要点)】\n【作業1:技術調査】\n本文";
  it("shows what was decided instead of the same fixed sentence every time", () => {
    const s = shortGoal(goal);
    expect(s.head).toBe("前回の回答への続き: レイアウト順が先で良い");
    expect(s.long).toBe(true);
  });
  it("leaves an ordinary request alone", () => {
    expect(shortGoal("電卓を作って")).toEqual({ head: "電卓を作って", long: false });
  });
});

describe("condenseAnswers", () => {
  const part = (n: number, len: number) => `【作業${n}:調査】\n${"あいうえお。".repeat(Math.ceil(len / 6))}`;
  it("keeps short answers whole", () => {
    expect(condenseAnswers("【作業1:調査】\n短い", 2200)).toBe("【作業1:調査】\n短い");
  });
  it("gives every task a share, so a long first answer does not push the later ones out", () => {
    const out = condenseAnswers([part(1, 5000), part(2, 5000), part(3, 5000)].join("\n\n"), 2200);
    expect(out).toContain("【作業1:");
    expect(out).toContain("【作業2:");
    expect(out).toContain("【作業3:");
    expect(out.length).toBeLessThan(2400);
  });
  it("cuts at a sentence end, not in the middle of a word", () => {
    const out = condenseAnswers([part(1, 5000), part(2, 5000)].join("\n\n"), 1000);
    for (const p of out.split("\n\n")) expect(p.replace("…(以下略)", "").endsWith("。")).toBe(true);
  });
});
