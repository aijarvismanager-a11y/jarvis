import { z } from "zod";

export const StepStatus = z.enum(["pending", "active", "done"]);
export type StepStatus = z.infer<typeof StepStatus>;

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
});
export type WorkflowStep = z.infer<typeof WorkflowStep>;

export const Workflow = z.object({
  current_project: z.string(),
  steps: z.array(WorkflowStep),
});
export type Workflow = z.infer<typeof Workflow>;
