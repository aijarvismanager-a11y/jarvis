import { describe, expect, it } from "vitest";
import { HTML_TO_MARKDOWN_JS } from "./pageMarkdown.ts";

// The converter runs inside a chat page, so only what can be checked without a browser is checked here:
// that it is a valid function expression (it is a string, so a typo would only show up in the page).
describe("page Markdown converter", () => {
  it("is a valid function expression that takes the answer element", () => {
    const fn = new Function(`return (${HTML_TO_MARKDOWN_JS});`)() as (root: unknown) => string;
    expect(typeof fn).toBe("function");
    expect(fn.length).toBe(1);
  });
  it("contains no stray template characters that would break it when sent to a page", () => {
    expect(HTML_TO_MARKDOWN_JS).not.toContain("${");
    expect(HTML_TO_MARKDOWN_JS.startsWith("(root) =>")).toBe(true);
  });
});
