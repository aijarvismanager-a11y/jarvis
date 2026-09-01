import { z } from "zod";

export const StepStatus = z.enum(["pending", "active", "done"]);
export type StepStatus = z.infer<typeof StepStatus>;

// A second (or third) AI tried against the exact same prompt as the step
// itself, kept as extra reference material for comparison — not a separate
// step, so trying more AIs never changes the shape of the workflow list.
export const StepAttempt = z.object({
  ai_name: z.string(),
  output_file: z.string(),
});
export type StepAttempt = z.infer<typeof StepAttempt>;

export const WorkflowStep = z.object({
  id: z.string(),
  index: z.number().int().positive(),
  ai_name: z.string(),
  role: z.string(),
  status: StepStatus,
  input_files: z.array(z.string()),
  output_files: z.array(z.string()),
  prompt_template: z.string(),
  command_template: z.string().nullable().optional(),
  attempts: z.array(StepAttempt).nullable().optional(),
});
export type WorkflowStep = z.infer<typeof WorkflowStep>;

// A Project is its own workflow (steps) plus its own workspace/<id>/ folder
// for artifacts, so unrelated projects never share files or clutter each
// other's step list.
export const Project = z.object({
  id: z.string(),
  name: z.string(),
  steps: z.array(WorkflowStep),
});
export type Project = z.infer<typeof Project>;

export const WorkflowFile = z.object({
  current_project_id: z.string(),
  projects: z.array(Project),
});
export type WorkflowFile = z.infer<typeof WorkflowFile>;
