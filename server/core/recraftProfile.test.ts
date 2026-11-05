import { describe, expect, it } from "vitest";
import { BUNDLED_SITE_PROFILES } from "./webAiSites.ts";

describe("recraft site profile", () => {
  const p = BUNDLED_SITE_PROFILES.recraft!;
  it("types into the prompt box and sends with the submit button", () => {
    expect(p.inputSelector).toBe("textarea");
    expect(p.sendSelector).toBe('button[type="submit"]');
  });
  it("closes the start-up promo dialog with Escape", () => {
    expect(p.prepare?.escape).toBe(true);
  });
});
