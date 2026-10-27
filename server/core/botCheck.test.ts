import { describe, expect, it } from "vitest";
import { chooseAi } from "./aiBroker.ts";
import { BOT_CHECK_ALWAYS_AFTER, BOT_CHECK_REST_MS, botCheckExclusions, botCheckState, clearBotCheck, recordBotCheck } from "./botCheck.ts";
import { openDatabase } from "./db.ts";
import { Store, type AiService } from "./store.ts";
import { classifyBlocker } from "./webAiSites.ts";

const svc = (id: string, caps: Record<string, number>): AiService =>
  ({ id, name: id, url: "https://x.test", provider: null, languages: [], accessMode: "web", automationLevel: 3, freeStatus: "free_tier", freeLimit: null, requiresLogin: false, requiresApiKey: false, apiCost: null, qualityScore: 5, reliabilityScore: 4, lastVerifiedAt: null, adapterType: "manual", limitations: null, status: "active", capabilities: Object.keys(caps), capabilityScores: caps }) as unknown as AiService;

describe("bot check handling (never bypassed: rest, then drop out, then give back to the person)", () => {
  const store = () => new Store(openDatabase(":memory:"), "unused");

  it("rests an AI for 30 minutes after one check, then lets it back", () => {
    const s = store();
    const t0 = Date.parse("2026-10-28T00:00:00Z");
    recordBotCheck(s, "copilot", t0);
    expect(botCheckState(s, "copilot", t0 + 1000)?.kind).toBe("rest");
    expect(botCheckState(s, "copilot", t0 + BOT_CHECK_REST_MS + 1)).toBeNull();
  });

  it("drops an AI that is checked every time until the check is cleared", () => {
    const s = store();
    const t0 = Date.parse("2026-10-28T00:00:00Z");
    for (let i = 0; i < BOT_CHECK_ALWAYS_AFTER; i++) recordBotCheck(s, "copilot", t0);
    expect(botCheckState(s, "copilot", t0 + 10 * BOT_CHECK_REST_MS)).toEqual({ kind: "always" });
    clearBotCheck(s, "copilot");
    expect(botCheckState(s, "copilot", t0 + 1000)).toBeNull();
  });

  it("keeps a resting AI out of the automatic choice and says why", () => {
    const s = store();
    recordBotCheck(s, "copilot");
    const list = [svc("copilot", { research: 5 }), svc("other", { research: 3 })];
    const d = chooseAi(list, "research", { restingAis: botCheckExclusions(s, ["copilot", "other"]) });
    expect(d.selected?.aiId).toBe("other");
    expect(d.excluded.find((e) => e.aiId === "copilot")?.reason).toContain("ボット確認");
  });

  it("sees a security-check dialog and a challenge frame as a bot check", () => {
    expect(classifyBlocker({ url: "https://copilot.com/chat", text: "セキュリティ チェックが必要です 確認が必要", hasChallengeFrame: false })).toBe("captcha");
    expect(classifyBlocker({ url: "https://copilot.com/chat", text: "", hasChallengeFrame: true })).toBe("captcha");
  });
});
