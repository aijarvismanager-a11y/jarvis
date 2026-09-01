import { describe, expect, it } from "vitest";
import { exportTemplate, parseWorkflowTemplate, stepsFromTemplate } from "./workflowTemplate";
import type { Project } from "../types/workflow";

const PROJECT: Project = {
  id: "demo-project",
  name: "デモプロジェクト",
  steps: [
    {
      id: "step_1",
      index: 1,
      ai_name: "ChatGPT (Web)",
      role: "Ideator",
      status: "done",
      input_files: [],
      output_files: ["workspace/demo-project/docs/ideas.md"],
      prompt_template: "アイデアを出して",
      command_template: null,
    },
    {
      id: "step_2",
      index: 2,
      ai_name: "Claude Code (CLI)",
      role: "Lead Developer",
      status: "pending",
      input_files: ["workspace/demo-project/docs/ideas.md"],
      output_files: ["workspace/demo-project/src/*"],
      prompt_template: "実装して",
      command_template: "claude -p --permission-mode acceptEdits \"実装して\"",
    },
  ],
};

describe("exportTemplate", () => {
  it("strips projectId prefixes and drops ids/status", () => {
    const template = exportTemplate(PROJECT);
    expect(template.name).toBe("デモプロジェクト");
    expect(template.steps).toHaveLength(2);
    expect(template.steps[0].output_files).toEqual(["docs/ideas.md"]);
    expect(template.steps[1].input_files).toEqual(["docs/ideas.md"]);
    expect(template.steps[1].command_template).toBe(
      'claude -p --permission-mode acceptEdits "実装して"',
    );
  });
});

describe("stepsFromTemplate", () => {
  it("re-anchors file paths under the new project and resets status/ids", () => {
    const template = exportTemplate(PROJECT);
    const steps = stepsFromTemplate(template, "new-project");
    expect(steps).toHaveLength(2);
    expect(steps[0].status).toBe("pending");
    expect(steps[0].output_files).toEqual(["workspace/new-project/docs/ideas.md"]);
    expect(steps[1].input_files).toEqual(["workspace/new-project/docs/ideas.md"]);
    expect(new Set(steps.map((s) => s.id)).size).toBe(2);
  });
});

describe("parseWorkflowTemplate", () => {
  it("round-trips a real exported template", () => {
    const template = exportTemplate(PROJECT);
    const parsed = parseWorkflowTemplate(JSON.stringify(template));
    expect(parsed).toEqual(template);
  });

  it("rejects invalid JSON", () => {
    expect(() => parseWorkflowTemplate("not json")).toThrow();
  });

  it("rejects JSON that isn't a workflow template", () => {
    expect(() => parseWorkflowTemplate(JSON.stringify({ hello: "world" }))).toThrow();
  });
});
