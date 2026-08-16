import { describe, expect, test } from "bun:test";
import { formatHandoffAgentLabel } from "./HandoffPacket";

describe("formatHandoffAgentLabel", () => {
  test("'manager' -> 'Manager'", () => {
    expect(formatHandoffAgentLabel("manager")).toBe("Manager");
  });

  test("'task_research' -> 'Research'", () => {
    expect(formatHandoffAgentLabel("task_research")).toBe("Research");
  });

  test("'task_general' -> 'General'", () => {
    expect(formatHandoffAgentLabel("task_general")).toBe("General");
  });

  test("unrecognized id passed through verbatim", () => {
    expect(formatHandoffAgentLabel("software-engineer")).toBe("software-engineer");
  });
});
