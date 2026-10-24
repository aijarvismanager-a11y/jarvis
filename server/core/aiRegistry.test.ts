import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_AI_PROFILES, applyGoogleLoginRegistry, seedRegistryProfiles } from "./aiRegistry.ts";
import { openDatabase } from "./db.ts";
import { Store } from "./store.ts";
import { BUNDLED_SITE_PROFILES } from "./webAiSites.ts";
import { findBrowserExecutable, importEverydaySignIn } from "./browserDriver.ts";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
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
    expect(Object.keys(BUNDLED_SITE_PROFILES).length).toBeGreaterThanOrEqual(8);
  });
});

describe("Google-login registry update", () => {
  it("removes the services without Google sign-in, adds those with it, once", () => {
    const store = new Store(openDatabase(":memory:"), "unused");
    store.upsertAiService({ id: "meta-ai", name: "Meta AI", url: "https://www.meta.ai" });
    store.upsertAiService({ id: "gemini", name: "Gemini", url: "https://gemini.google.com" });
    const r = applyGoogleLoginRegistry(store);
    expect(r.removed).toEqual(["meta-ai"]);
    expect(r.added).toContain("google-ai-studio");
    expect(store.getAiService("meta-ai")).toBeNull();
    expect(store.getAiService("gemini")).not.toBeNull();
    seedRegistryProfiles(store);
    expect(Object.keys(store.getAiService("jules")!.capabilityScores).length).toBeGreaterThan(0);
    // second run changes nothing, even if the user adds a removed one back
    store.upsertAiService({ id: "meta-ai", name: "Meta AI", url: "https://www.meta.ai" });
    expect(applyGoogleLoginRegistry(store)).toEqual({ removed: [], added: [] });
    expect(store.getAiService("meta-ai")).not.toBeNull();
  });
});

describe("importEverydaySignIn", () => {
  const setup = () => {
    const local = mkdtempSync(path.join(os.tmpdir(), "signin-"));
    const root = path.join(local, "BraveSoftware", "Brave-Browser", "User Data");
    mkdirSync(path.join(root, "Default", "Network"), { recursive: true });
    mkdirSync(path.join(root, "Default", "Local Storage"), { recursive: true });
    writeFileSync(path.join(root, "Local State"), JSON.stringify({ profile: { last_used: "Default" } }));
    writeFileSync(path.join(root, "Default", "Network", "Cookies"), "cookie");
    writeFileSync(path.join(root, "Default", "Login Data"), "secret-passwords");
    writeFileSync(path.join(root, "Default", "Local Storage", "a"), "ls");
    return { env: { LOCALAPPDATA: local }, dest: path.join(local, "dest") };
  };
  it("copies sign-in state but never saved passwords, and refuses while the browser runs", () => {
    const { env, dest } = setup();
    const exe = "C:/x/brave.exe";
    expect(() => importEverydaySignIn(exe, dest, env, () => true)).toThrow(/起動中/);
    const r = importEverydaySignIn(exe, dest, env, () => false);
    expect(r.copied).toEqual(["Network/Cookies", "Local Storage"]);
    expect(existsSync(path.join(dest, "Default", "Network", "Cookies"))).toBe(true);
    expect(existsSync(path.join(dest, "Local State"))).toBe(true);
    expect(existsSync(path.join(dest, "Default", "Login Data"))).toBe(false);
  });
});
