import { describe, expect, test } from "bun:test";
import { formatHandoffAgentLabel } from "./HandoffPacket";

describe("formatHandoffAgentLabel", () => {
  test("'manager' -> 'マネージャー'", () => {
    expect(formatHandoffAgentLabel("manager")).toBe("マネージャー");
  });

  test("'task_research' -> 'リサーチ'", () => {
    expect(formatHandoffAgentLabel("task_research")).toBe("リサーチ");
  });

  test("'task_general' -> '全般'", () => {
    expect(formatHandoffAgentLabel("task_general")).toBe("全般");
  });

  test("unrecognized id passed through verbatim", () => {
    expect(formatHandoffAgentLabel("software-engineer")).toBe("software-engineer");
  });
});
