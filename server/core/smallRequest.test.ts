import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isSmallRequest, singleTaskDraft } from "./smallRequest.ts";
import { planDraftSchema, validatePlan } from "./taskGraph.ts";

const bench = (name: string) => readFileSync(new URL(`../../benchmark/${name}/REQUIREMENTS.md`, import.meta.url), "utf8");

describe("isSmallRequest", () => {
  it("takes a change to a few named files", () => {
    expect(isSmallRequest(bench("shop-change"))).toBe(true);
    expect(isSmallRequest("src/money.mjs の toCents の丸めを直して、test/money.test.mjs にテストを足して")).toBe(true);
  });
  it("leaves everything else to the planner", () => {
    expect(isSmallRequest("商品管理ができるシンプルなWebアプリを作って")).toBe(false); // no file named
    expect(isSmallRequest("index.html の見た目のデザインを良くして")).toBe(false); // another AI draws better
    expect(isSmallRequest("README.md を書くために競合を調査して")).toBe(false);
    expect(isSmallRequest("src/a.js を直してデプロイして")).toBe(false);
    expect(isSmallRequest(`src/a.js を直して${"あ".repeat(4000)}`)).toBe(false);
    expect(isSmallRequest(Array.from({ length: 11 }, (_, i) => `f${i}.js`).join(" "))).toBe(false);
    expect(isSmallRequest("src/a.js を直して", ["画像も作る"])).toBe(false);
  });
  it("makes a valid one-task plan, also for the longest goal", () => {
    const draft = singleTaskDraft("a".repeat(4000));
    expect(planDraftSchema.safeParse(draft).success).toBe(true);
    expect(validatePlan(draft)).toEqual([]);
    expect(draft.tasks).toHaveLength(1);
  });
});
