import { describe, expect, it } from "vitest";
import { buildClaudeCommand } from "./claudeCommand";
import type { WorkflowStep } from "../types/workflow";

const PROJECT_ID = "demo-project";

function step(overrides: Partial<WorkflowStep>): WorkflowStep {
  return {
    id: "step_1",
    index: 1,
    ai_name: "Claude Code (CLI)",
    role: "Lead Developer",
    status: "pending",
    input_files: [],
    output_files: [],
    prompt_template: "implement it",
    command_template: null,
    ...overrides,
  };
}

describe("buildClaudeCommand", () => {
  it("returns null for non-Claude-Code steps with no explicit command", () => {
    expect(buildClaudeCommand(step({ ai_name: "ChatGPT / Gemini (Web)" }), PROJECT_ID)).toBeNull();
  });

  it("prefers an explicit command_template over auto-generation", () => {
    const s = step({ command_template: "claude -p \"custom\"" });
    expect(buildClaudeCommand(s, PROJECT_ID)).toBe('claude -p "custom"');
  });

  it("auto-generates a non-interactive command including all input files, stripping the project prefix", () => {
    const s = step({
      input_files: [`workspace/${PROJECT_ID}/docs/requirements.md`, `workspace/${PROJECT_ID}/docs/architecture.md`],
      output_files: [`workspace/${PROJECT_ID}/src/*`],
    });
    const cmd = buildClaudeCommand(s, PROJECT_ID);
    expect(cmd).toContain("-p --permission-mode acceptEdits");
    expect(cmd).toContain("docs/requirements.md と docs/architecture.md");
    expect(cmd).toContain("src/ に実装して");
    expect(cmd).not.toContain(PROJECT_ID);
  });

  it("handles a step with no input files", () => {
    const s = step({ output_files: [`workspace/${PROJECT_ID}/logs/out.log`] });
    const cmd = buildClaudeCommand(s, PROJECT_ID);
    expect(cmd).toContain("logs/out.log を実装して");
  });
});
