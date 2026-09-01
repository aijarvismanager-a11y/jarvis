import { z } from "zod";
import type { Project, WorkflowStep } from "../types/workflow";
import { stripProjectPrefix } from "./paths";

// A template captures the *shape* of a workflow (roles, AI assignments,
// prompts, file layout) — never the actual content in workspace/, and
// never a projectId or step id, so it can be re-imported into any project
// on any machine without colliding with what's already there. This is the
// "share/export a workflow" roadmap item, done as a plain downloadable
// JSON file rather than a server-side feature, since the whole app stays
// local/API-free.
export const WorkflowTemplateStep = z.object({
  role: z.string(),
  ai_name: z.string(),
  prompt_template: z.string(),
  command_template: z.string().nullable().optional(),
  input_files: z.array(z.string()),
  output_files: z.array(z.string()),
});
export type WorkflowTemplateStep = z.infer<typeof WorkflowTemplateStep>;

export const WORKFLOW_TEMPLATE_FORMAT = "ai-orchestrator-workflow-template";

export const WorkflowTemplate = z.object({
  format: z.literal(WORKFLOW_TEMPLATE_FORMAT),
  version: z.literal(1),
  name: z.string(),
  steps: z.array(WorkflowTemplateStep),
});
export type WorkflowTemplate = z.infer<typeof WorkflowTemplate>;

export function exportTemplate(project: Project): WorkflowTemplate {
  return {
    format: WORKFLOW_TEMPLATE_FORMAT,
    version: 1,
    name: project.name,
    steps: project.steps
      .slice()
      .sort((a, b) => a.index - b.index)
      .map((s) => ({
        role: s.role,
        ai_name: s.ai_name,
        prompt_template: s.prompt_template,
        command_template: s.command_template ?? null,
        input_files: s.input_files.map((f) => stripProjectPrefix(f, project.id)),
        output_files: s.output_files.map((f) => stripProjectPrefix(f, project.id)),
      })),
  };
}

// Rebuilds real steps for a specific project from a template — fresh ids,
// sequential index, and file paths re-anchored under that project's own
// workspace/<projectId>/ folder.
export function stepsFromTemplate(template: WorkflowTemplate, projectId: string): WorkflowStep[] {
  return template.steps.map((s, i) => ({
    id: `step_${Date.now()}_${i}`,
    index: i + 1,
    ai_name: s.ai_name,
    role: s.role,
    status: "pending",
    input_files: s.input_files.map((f) => `workspace/${projectId}/${f}`),
    output_files: s.output_files.map((f) => `workspace/${projectId}/${f}`),
    prompt_template: s.prompt_template,
    command_template: s.command_template ?? null,
    attempts: null,
  }));
}

export function parseWorkflowTemplate(text: string): WorkflowTemplate {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("JSONとして読み込めませんでした。テンプレートファイルが壊れていないか確認してください。");
  }
  const result = WorkflowTemplate.safeParse(json);
  if (!result.success) {
    throw new Error("このアプリのワークフローテンプレート形式ではないようです。");
  }
  return result.data;
}
