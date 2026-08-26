import { describe, expect, it } from "vitest";
import { Workflow } from "./workflow";

const validWorkflow = {
  current_project: "demo",
  steps: [
    {
      id: "step_1",
      index: 1,
      ai_name: "Claude (Web)",
      role: "Reviewer",
      status: "active",
      input_files: ["workspace/docs/requirements.md"],
      output_files: ["workspace/docs/review.md"],
      prompt_template: "review it",
      command_template: null,
    },
  ],
};

describe("Workflow schema", () => {
  it("accepts a well-formed workflow", () => {
    expect(() => Workflow.parse(validWorkflow)).not.toThrow();
  });

  it("rejects an invalid status value", () => {
    const bad = { ...validWorkflow, steps: [{ ...validWorkflow.steps[0], status: "not-a-status" }] };
    expect(() => Workflow.parse(bad)).toThrow();
  });

  it("rejects a step missing required fields", () => {
    const bad = { ...validWorkflow, steps: [{ id: "step_1" }] };
    expect(() => Workflow.parse(bad)).toThrow();
  });

  it("allows command_template to be omitted or null", () => {
    const { command_template: _ignored, ...rest } = validWorkflow.steps[0];
    const withoutField = { ...validWorkflow, steps: [rest] };
    expect(() => Workflow.parse(withoutField)).not.toThrow();
  });
});
