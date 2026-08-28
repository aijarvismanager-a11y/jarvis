import { describe, expect, it } from "vitest";
import { WorkflowFile } from "./workflow";

const validStep = {
  id: "step_1",
  index: 1,
  ai_name: "Claude (Web)",
  role: "Reviewer",
  status: "active",
  input_files: ["workspace/demo/docs/requirements.md"],
  output_files: ["workspace/demo/docs/review.md"],
  prompt_template: "review it",
  command_template: null,
};

const validFile = {
  current_project_id: "demo",
  projects: [{ id: "demo", name: "Demo Project", steps: [validStep] }],
};

describe("WorkflowFile schema", () => {
  it("accepts a well-formed workflow file", () => {
    expect(() => WorkflowFile.parse(validFile)).not.toThrow();
  });

  it("rejects an invalid status value", () => {
    const bad = {
      ...validFile,
      projects: [{ ...validFile.projects[0], steps: [{ ...validStep, status: "not-a-status" }] }],
    };
    expect(() => WorkflowFile.parse(bad)).toThrow();
  });

  it("rejects a step missing required fields", () => {
    const bad = {
      ...validFile,
      projects: [{ ...validFile.projects[0], steps: [{ id: "step_1" }] }],
    };
    expect(() => WorkflowFile.parse(bad)).toThrow();
  });

  it("allows command_template to be omitted or null", () => {
    const { command_template: _ignored, ...rest } = validStep;
    const withoutField = { ...validFile, projects: [{ ...validFile.projects[0], steps: [rest] }] };
    expect(() => WorkflowFile.parse(withoutField)).not.toThrow();
  });

  it("rejects a workflow file with no projects array", () => {
    expect(() => WorkflowFile.parse({ current_project_id: "demo" })).toThrow();
  });
});
