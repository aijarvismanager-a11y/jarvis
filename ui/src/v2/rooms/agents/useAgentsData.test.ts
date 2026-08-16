import { describe, expect, test } from "bun:test";
import { formatAgentActivityText } from "./useAgentsData";

describe("formatAgentActivityText", () => {
  test("tool_call -> 'called <name>'", () => {
    expect(formatAgentActivityText({ eventType: "tool_call", data: { name: "web_search" } })).toBe(
      "called web_search",
    );
  });

  test("tool_call with no name -> 'called unknown'", () => {
    expect(formatAgentActivityText({ eventType: "tool_call", data: {} })).toBe("called unknown");
  });

  test("done -> 'completed task'", () => {
    expect(formatAgentActivityText({ eventType: "done", data: null })).toBe("completed task");
  });

  test("text under 50 chars -> shown verbatim", () => {
    expect(formatAgentActivityText({ eventType: "text", data: { text: "short update" } })).toBe(
      "short update",
    );
  });

  test("text over 50 chars -> truncated with ellipsis", () => {
    const long = "a".repeat(60);
    const result = formatAgentActivityText({ eventType: "text", data: { text: long } });
    expect(result).toBe("a".repeat(50) + "…");
  });
});
