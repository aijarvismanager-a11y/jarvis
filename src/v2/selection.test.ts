import { describe, expect, it } from "vitest";
import { explainSelection } from "./selection";
import type { AiService, StoredEvent } from "./types";

const services = [{ id: "gemini", name: "Gemini (Web)" }, { id: "perplexity", name: "Perplexity (Web)" }, { id: "claude-code", name: "Claude Code (CLI)" }] as unknown as AiService[];
const ev = (id: number, type: string, taskId: string, payload: unknown): StoredEvent => ({ id, type, taskId, payload, createdAt: "2026-10-26T00:00:00Z" });

const selected = {
  capability: "research",
  confidence: 0.72,
  confidenceLabel: "medium",
  needsReview: false,
  selected: "perplexity",
  excluded: [{ aiId: "bolt-new", name: "Bolt.new (Web)", reason: "この実行基盤では実行できない" }],
  chosen: { name: "Perplexity (Web)", score10: 9.4, fit: 5, quality: 4, automation: 5, safety: 4 },
  ranked: [{ aiId: "gemini", name: "Gemini (Web)", score10: 9.4 }, { aiId: "perplexity", name: "Perplexity (Web)", score10: 9.4 }],
  shared: [{ aiId: "gemini", name: "Gemini (Web)", mission: 1, recent: 3 }, { aiId: "perplexity", name: "Perplexity (Web)", mission: 0, recent: 0 }],
};

describe("why this AI", () => {
  it("says the work was shared among equally good AIs, with their use", () => {
    const why = explainSelection([ev(1, "AI_SELECTED", "t1", selected)], "t1", services)!;
    expect(why.headline).toContain("Perplexityが担当");
    expect(why.headline).toContain("同じくらい向いているAIが2つ");
    expect(why.headline).toContain("利用が少ない順");
    expect(why.lines.join("\n")).toContain("Geminiは、この依頼で1回・直近24時間で3回");
    expect(why.lines.join("\n")).toContain("候補の点数(10点満点): Gemini 9.4 ／ Perplexity 9.4");
    expect(why.lines.join("\n")).toContain("得意分野 5");
    expect(why.lines.join("\n")).toContain("使えなかったAI: Bolt.new(この実行基盤では実行できない)");
  });

  it("says plainly that it is the best fit when there was no real choice", () => {
    const why = explainSelection([ev(1, "AI_SELECTED", "t1", { ...selected, shared: [selected.shared[1]] })], "t1", services)!;
    expect(why.headline).toBe("Perplexityが担当: 「調査」に最も向いているAIです(点数 9.4/10)");
  });

  it("shows the newest selection of the task, its switches, and nothing of other tasks", () => {
    const events = [
      ev(1, "AI_SELECTED", "t1", { ...selected, selected: "gemini", chosen: { ...selected.chosen, name: "Gemini (Web)" }, shared: [] }),
      ev(2, "AI_SELECTED", "t2", selected),
      ev(3, "AI_FALLBACK", "t1", { from: "gemini", to: "perplexity" }),
      ev(4, "AI_SELECTED", "t1", { ...selected, shared: [] }),
    ];
    const why = explainSelection(events, "t1", services)!;
    expect(why.headline).toContain("Perplexityが担当");
    expect(why.lines.join("\n")).toContain("切り替え: Geminiが失敗したため、Perplexityに切り替えました");
  });

  it("flags low-confidence picks and cuts a long list of excluded AIs", () => {
    const many = Array.from({ length: 6 }, (_, i) => ({ aiId: `x${i}`, name: `X${i}`, reason: "r" }));
    const why = explainSelection([ev(1, "AI_SELECTED", "t1", { ...selected, confidenceLabel: "low", needsReview: true, excluded: many })], "t1", services)!;
    expect(why.lines.join("\n")).toContain("選んだ自信: 低(点数のデータが少ないため、参考程度です)");
    expect(why.lines.join("\n")).toContain("ほか3件");
  });

  it("has nothing to say when no selection was recorded", () => {
    expect(explainSelection([], "t1", services)).toBeNull();
    expect(explainSelection([ev(1, "AI_SELECTED", "other", selected)], "t1", services)).toBeNull();
  });
});
