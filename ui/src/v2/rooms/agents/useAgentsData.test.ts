import { describe, expect, test } from "bun:test";
import { formatAgentActivityText } from "./useAgentsData";

describe("formatAgentActivityText", () => {
  test("tool_call -> '<name> を呼び出し'", () => {
    expect(formatAgentActivityText({ eventType: "tool_call", data: { name: "web_search" } })).toBe(
      "web_search を呼び出し",
    );
  });

  test("tool_call with no name -> '不明 を呼び出し'", () => {
    expect(formatAgentActivityText({ eventType: "tool_call", data: {} })).toBe("不明 を呼び出し");
  });

  test("done -> 'タスク完了'", () => {
    expect(formatAgentActivityText({ eventType: "done", data: null })).toBe("タスク完了");
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
