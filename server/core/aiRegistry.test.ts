import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_AI_PROFILES } from "./aiRegistry.ts";
import { BUNDLED_SITE_PROFILES } from "./webAiSites.ts";
import { findBrowserExecutable } from "./browserDriver.ts";
import { capabilityForRole } from "./legacyImport.ts";

const BRAVE = "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe";

describe("default AI profiles", () => {
  it("cover every service in config/ai_services.json, so none is left unscored", () => {
    const ids = (JSON.parse(readFileSync("config/ai_services.json", "utf-8")) as { id: string }[]).map((s) => s.id);
    expect(ids.filter((id) => !DEFAULT_AI_PROFILES[id])).toEqual([]);
  });

  it("maps video, music and voice roles to their own capability", () => {
    expect(capabilityForRole("動画制作")).toBe("video_generation");
    expect(capabilityForRole("BGM作曲")).toBe("music_generation");
    expect(capabilityForRole("ナレーション")).toBe("voice_generation");
    expect(capabilityForRole("画像生成")).toBe("image_generation");
  });

  it.skipIf(!existsSync(BRAVE))("prefers Brave over Edge/Chrome when installed, but WEB_AI_BROWSER still wins", () => {
    expect(findBrowserExecutable({})).toMatch(/brave/i);
    const other = process.execPath; // any existing file stands in for a user-chosen browser
    expect(findBrowserExecutable({ WEB_AI_BROWSER: other })).toBe(other);
  });
});

describe("bundled web AI site profiles", () => {
  it("only list registered AIs and always give an input and an answer selector", () => {
    const ids = new Set((JSON.parse(readFileSync("config/ai_services.json", "utf-8")) as { id: string }[]).map((s) => s.id));
    for (const [id, p] of Object.entries(BUNDLED_SITE_PROFILES)) {
      expect(ids.has(id), id).toBe(true);
      expect(p.inputSelector && p.responseSelector, id).toBeTruthy();
    }
    expect(Object.keys(BUNDLED_SITE_PROFILES).length).toBeGreaterThanOrEqual(9);
  });
});
