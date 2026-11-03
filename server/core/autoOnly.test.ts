import { describe, expect, it } from "vitest";
import { capabilityForTaskRole, chooseAi, isMediaCapability } from "./aiBroker.ts";
import type { AiService } from "./store.ts";

const svc = (id: string, level: 1 | 2 | 3, caps: Record<string, number>): AiService =>
  ({ id, name: id, url: "https://x.test", provider: null, languages: [], accessMode: "web", automationLevel: level, freeStatus: "free_tier", freeLimit: null, requiresLogin: false, requiresApiKey: false, apiCost: null, qualityScore: 5, reliabilityScore: 4, lastVerifiedAt: null, adapterType: "manual", limitations: null, status: "active", capabilities: Object.keys(caps), capabilityScores: caps }) as unknown as AiService;

describe("planner roles for picture, video, music and voice work", () => {
  it("reach the media capabilities, in English and Japanese", () => {
    const got = ["illustration", "video", "music", "voice", "動画制作", "BGM作成", "ナレーション収録", "ロゴ作成"].map(capabilityForTaskRole);
    expect(got).toEqual(["image_generation", "video_generation", "music_generation", "voice_generation", "video_generation", "music_generation", "voice_generation", "image_generation"]);
  });
});

describe("text work goes only to AIs the app can operate by itself", () => {
  const list = [svc("manual-star", 1, { research: 5, image_generation: 5 }), svc("auto-ok", 3, { research: 3, image_generation: 3 })];

  it("never picks a manual AI for text, however good its score", () => {
    const d = chooseAi(list, "research");
    expect(d.selected?.aiId).toBe("auto-ok");
    expect(d.excluded.find((e) => e.aiId === "manual-star")?.reason).toContain("手動");
  });

  it("leaves a task with no AI (the engine then uses Claude Code) when only manual AIs fit", () => {
    expect(chooseAi([list[0]!], "research").selected).toBeNull();
  });

  it("never picks a manual AI for picture, video, music or voice work either (it would need a person at an English site)", () => {
    expect(isMediaCapability("image_generation")).toBe(true);
    expect(chooseAi([list[0]!], "image_generation").selected).toBeNull();
    expect(chooseAi([svc("manual-star", 1, { video_generation: 5 })], "video_generation").selected).toBeNull();
  });

  it("picks the automatic AI for pictures, however far behind the manual one it is", () => {
    expect(chooseAi(list, "image_generation").selected?.aiId).toBe("auto-ok");
    const far = [svc("manual-star", 1, { image_generation: 5 }), svc("auto-weak", 3, { image_generation: 1 })];
    expect(chooseAi(far, "image_generation").selected?.aiId).toBe("auto-weak");
  });

  it("can be switched back by the hidden setting", () => {
    expect(chooseAi(list, "research", { allowManualText: true }).selected?.aiId).toBe("manual-star");
  });
});

describe("Claude Code on a fresh install", () => {
  it("is registered once with its profile", async () => {
    const { openDatabase } = await import("./db.ts");
    const { Store } = await import("./store.ts");
    const { ensureClaudeCode, seedRegistryProfiles } = await import("./aiRegistry.ts");
    const db = openDatabase(":memory:");
    const store = new Store(db, "unused");
    expect(ensureClaudeCode(store)).toBe(true);
    expect(ensureClaudeCode(store)).toBe(false);
    seedRegistryProfiles(store);
    expect(store.getAiService("claude-code")).toMatchObject({ adapterType: "claude-code", automationLevel: 3 });
    expect(store.getAiService("claude-code")!.capabilityScores.coding).toBe(5);
    db.close();
  });
});
