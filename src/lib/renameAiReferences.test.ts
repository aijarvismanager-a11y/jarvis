import { describe, expect, it } from "vitest";
import { applyRenameMap, computeRenameMap } from "./renameAiReferences";
import type { WorkflowFile } from "../types/workflow";

const WORKFLOW: WorkflowFile = {
  current_project_id: "p1",
  projects: [
    {
      id: "p1",
      name: "Demo",
      steps: [
        {
          id: "s1",
          index: 1,
          ai_name: "ChatGPT (Web)",
          role: "Ideator",
          status: "pending",
          input_files: [],
          output_files: ["workspace/p1/docs/ideas.md"],
          prompt_template: "hi",
          command_template: null,
          attempts: [{ ai_name: "Claude (Web)", output_file: "workspace/p1/docs/ideas__claude.md" }],
        },
      ],
    },
  ],
};

describe("computeRenameMap", () => {
  it("finds a rename by matching id, name changed", () => {
    const before = [{ id: "svc1", name: "ChatGPT (Web)", url: "https://chatgpt.com" }];
    const after = [{ id: "svc1", name: "ChatGPT Plus (Web)", url: "https://chatgpt.com" }];
    const map = computeRenameMap(before, after);
    expect(map.get("ChatGPT (Web)")).toBe("ChatGPT Plus (Web)");
  });

  it("ignores unchanged names", () => {
    const before = [{ id: "svc1", name: "Claude (Web)", url: null }];
    const after = [{ id: "svc1", name: "Claude (Web)", url: "https://claude.ai" }];
    expect(computeRenameMap(before, after).size).toBe(0);
  });
});

describe("applyRenameMap", () => {
  it("updates both step.ai_name and attempt.ai_name", () => {
    const map = new Map([
      ["ChatGPT (Web)", "ChatGPT Plus (Web)"],
      ["Claude (Web)", "Claude 3 (Web)"],
    ]);
    const next = applyRenameMap(WORKFLOW, map);
    expect(next.projects[0].steps[0].ai_name).toBe("ChatGPT Plus (Web)");
    expect(next.projects[0].steps[0].attempts?.[0].ai_name).toBe("Claude 3 (Web)");
  });

  it("is a no-op for an empty map", () => {
    expect(applyRenameMap(WORKFLOW, new Map())).toBe(WORKFLOW);
  });
});
