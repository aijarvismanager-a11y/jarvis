import { describe, expect, it } from "vitest";
import { bundleName, canReloadNow, isScreenOutdated } from "./screenUpdate";

const doc = (active: string | null, values: string[] = []) =>
  ({ activeElement: active ? { tagName: active } : null, querySelectorAll: () => values.map((value) => ({ value })) }) as never;

describe("screen update", () => {
  it("finds the entry script name in index.html", () => {
    expect(bundleName('<script type="module" crossorigin src="/assets/index-s5IUbJlY.js"></script>')).toBe("index-s5IUbJlY.js");
    expect(bundleName("<html>no script</html>")).toBeNull();
  });
  it("says outdated only when both names are known and differ", () => {
    expect(isScreenOutdated("index-a.js", "index-b.js")).toBe(true);
    expect(isScreenOutdated("index-a.js", "index-a.js")).toBe(false);
    expect(isScreenOutdated(null, "index-b.js")).toBe(false);
    expect(isScreenOutdated("index-a.js", null)).toBe(false);
  });
  it("does not reload by itself while something is being written", () => {
    expect(canReloadNow(doc(null))).toBe(true);
    expect(canReloadNow(doc("BUTTON"))).toBe(true);
    expect(canReloadNow(doc("TEXTAREA"))).toBe(false);
    expect(canReloadNow(doc(null, ["", "  "]))).toBe(true);
    expect(canReloadNow(doc(null, ["作りたいもの"]))).toBe(false);
  });
});
