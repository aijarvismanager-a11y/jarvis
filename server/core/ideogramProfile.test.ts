import { describe, expect, it } from "vitest";
import { BUNDLED_SITE_PROFILES } from "./webAiSites.ts";

describe("ideogram site profile", () => {
  const p = BUNDLED_SITE_PROFILES.ideogram!;
  it("confirms the generation only on the sheet's own Generate button", () => {
    const re = new RegExp(p.confirmButton!);
    expect(re.test("Generate")).toBe(true);
    expect(re.test("Generate 12.00")).toBe(true);
    expect(re.test("Generate Image Generate an image from a text prompt.")).toBe(false);
    expect(re.test("Generate Vector")).toBe(false);
    expect(re.test("Search generation")).toBe(false);
  });
  it("reads pictures from links and knows the history page", () => {
    expect(p.imagesInLinks).toBe(true);
    expect(p.historyUrl).toMatch(/^https:\/\/ideogram\.ai\//);
  });
});
