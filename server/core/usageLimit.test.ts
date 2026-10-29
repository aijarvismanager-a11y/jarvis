import { describe, expect, it } from "vitest";
import { chooseAi } from "./aiBroker.ts";
import { claudeLimitExclusions, claudeLimitUntil, noteClaudeLimitHit, saveClaudeLimitPolicy, saveClaudeQuota } from "./claudeQuota.ts";
import { openDatabase } from "./db.ts";
import { Store } from "./store.ts";
import { classifyBlocker } from "./webAiSites.ts";
import { USAGE_LIMIT_REST_MS, looksLikeUsageLimit, recordUsageLimit, restFromText, usageLimitExclusions, usageLimitUntil } from "./usageLimit.ts";

const store = () => new Store(openDatabase(":memory:"), "unused");

describe("web AI usage limit", () => {
  it("recognises a short 'limit reached' answer, not a long deliverable", () => {
    expect(looksLikeUsageLimit("無料枠の利用上限に達しました。明日またお試しください。")).toBe(true);
    expect(looksLikeUsageLimit("You've reached your daily message limit. Try again tomorrow.")).toBe(true);
    expect(looksLikeUsageLimit("Too many requests")).toBe(true);
    expect(looksLikeUsageLimit("# 設計書\nレート制限の設計方針を述べる。")).toBe(false);
    expect(looksLikeUsageLimit("上限に達しました。" + "あ".repeat(800))).toBe(false);
    expect(looksLikeUsageLimit("")).toBe(false);
  });

  it("recognises a Perplexity-style 'queries used up' notice", () => {
    for (const t of ["You have 0 Pro searches left today.", "You've used all of your free queries. Upgrade or try again in 3 hours.", "無料クエリの上限に達しました", "1日の検索回数の上限に達しました。", "No queries remaining"]) expect(looksLikeUsageLimit(t), t).toBe(true);
    expect(looksLikeUsageLimit("検索エンジンの設計方針をまとめる")).toBe(false);
  });

  it("a limit notice in a dialog is a 'limit' blocker (nothing to wait for); on the page body it is not", () => {
    const base = { url: "https://www.perplexity.ai/", text: "", hasChallengeFrame: false };
    expect(classifyBlocker({ ...base, dialogText: "You have 0 Pro searches left today." })).toBe("limit");
    expect(classifyBlocker({ ...base, text: "無料クエリの上限に達しました" })).toBeNull();
    expect(classifyBlocker({ ...base, dialogText: "I am not a robot captcha", text: "I am not a robot captcha" })).toBe("captcha");
  });

  it("reads the wait from the text, else three hours", () => {
    expect(restFromText("上限です")).toBe(USAGE_LIMIT_REST_MS);
    expect(restFromText("5時間後に再開")).toBe(5 * 3_600_000);
    expect(restFromText("try again in 2 hours")).toBe(2 * 3_600_000);
    expect(restFromText("1分後")).toBe(30 * 60_000);
  });

  it("rests the AI until the time passes and keeps it out of the choice", () => {
    const s = store();
    const t0 = Date.parse("2026-10-29T00:00:00Z");
    recordUsageLimit(s, "chatgpt", "", t0);
    expect(usageLimitUntil(s, "chatgpt", t0 + 1000)).not.toBeNull();
    expect(usageLimitUntil(s, "chatgpt", t0 + USAGE_LIMIT_REST_MS + 1)).toBeNull();
    const svc = (id: string, score: number) => ({ id, name: id, url: "https://x.test", provider: null, languages: [], accessMode: "web", automationLevel: 3, freeStatus: "free_tier", freeLimit: null, requiresLogin: false, requiresApiKey: false, apiCost: null, qualityScore: 5, reliabilityScore: 4, lastVerifiedAt: null, adapterType: "manual", limitations: null, status: "active", capabilities: ["research"], capabilityScores: { research: score } }) as never;
    const d = chooseAi([svc("chatgpt", 5), svc("other", 3)], "research", { restingAis: usageLimitExclusions(s, ["chatgpt", "other"], t0 + 1000) });
    expect(d.selected?.aiId).toBe("other");
    expect(d.excluded.find((e) => e.aiId === "chatgpt")?.reason).toContain("利用上限");
  });
});

describe("Claude plan limit", () => {
  const rejected = (resetsAt: string) => ({ fiveHour: { utilization: 1, resetsAt }, sevenDay: null, status: "rejected", checkedAt: "2026-10-29T00:00:00Z" });

  it("is active only while rejected and the reset is ahead", () => {
    const s = store();
    const now = Date.parse("2026-10-29T00:00:00Z");
    expect(claudeLimitUntil(s, now)).toBeNull();
    saveClaudeQuota(s, rejected("2026-10-29T03:00:00Z"));
    expect(claudeLimitUntil(s, now)).toBe("2026-10-29T03:00:00Z");
    expect(claudeLimitUntil(s, Date.parse("2026-10-29T03:00:01Z"))).toBeNull();
  });

  it("assumes an hour when the failure gave no window", () => {
    const s = store();
    const now = Date.parse("2026-10-29T00:00:00Z");
    noteClaudeLimitHit(s, now);
    expect(claudeLimitUntil(s, now)).toBe("2026-10-29T01:00:00.000Z");
  });

  it("rests the Claude AIs only when the person chose to hand the work on", () => {
    const s = store();
    const now = Date.parse("2026-10-29T00:00:00Z");
    saveClaudeQuota(s, rejected("2026-10-29T03:00:00Z"));
    const ids = ["claude-code", "claude-web", "chatgpt"];
    expect(claudeLimitExclusions(s, ids, now)).toEqual({});
    saveClaudeLimitPolicy(s, "wait");
    expect(claudeLimitExclusions(s, ids, now)).toEqual({});
    saveClaudeLimitPolicy(s, "reroute");
    expect(Object.keys(claudeLimitExclusions(s, ids, now))).toEqual(["claude-code", "claude-web"]);
  });
});
