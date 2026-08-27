import * as fs from 'fs';
import { WORKFLOW_FILE } from './config';
import { LoadResult, StepStatus, WorkflowFile, WorkflowStep } from './types';

const VALID_STATUSES: StepStatus[] = ['not_started', 'in_progress', 'done'];
const EMPTY_WORKFLOW: WorkflowFile = { version: 1, steps: [] };

function isStepShape(value: unknown): value is WorkflowStep {
  if (typeof value !== 'object' || value === null) return false;
  const s = value as Record<string, unknown>;
  return (
    typeof s.id === 'string' &&
    typeof s.index === 'number' &&
    typeof s.ai_name === 'string' &&
    typeof s.role === 'string' &&
    typeof s.status === 'string' &&
    VALID_STATUSES.includes(s.status as StepStatus) &&
    Array.isArray(s.input_files) &&
    s.input_files.every((f) => typeof f === 'string') &&
    Array.isArray(s.output_files) &&
    s.output_files.every((f) => typeof f === 'string') &&
    typeof s.prompt_template === 'string'
  );
}

function isWorkflowShape(value: unknown): value is WorkflowFile {
  if (typeof value !== 'object' || value === null) return false;
  const w = value as Record<string, unknown>;
  return typeof w.version === 'number' && Array.isArray(w.steps) && w.steps.every(isStepShape);
}

/**
 * Loads config/workflow.json. Missing file or invalid content never throws;
 * callers get an empty workflow plus an error message so the UI can show a banner.
 */
export function loadWorkflow(): LoadResult<WorkflowFile> {
  let raw: string;
  try {
    raw = fs.readFileSync(WORKFLOW_FILE, 'utf-8');
  } catch (err) {
    return {
      data: EMPTY_WORKFLOW,
      ok: false,
      error: `workflow.json not found at ${WORKFLOW_FILE}`,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return {
      data: EMPTY_WORKFLOW,
      ok: false,
      error: `workflow.json is not valid JSON: ${(err as Error).message}`,
    };
  }

  if (!isWorkflowShape(parsed)) {
    return {
      data: EMPTY_WORKFLOW,
      ok: false,
      error: 'workflow.json does not match the expected schema (version/steps)',
    };
  }

  return { data: parsed, ok: true };
}

export function saveWorkflow(workflow: WorkflowFile): void {
  fs.writeFileSync(WORKFLOW_FILE, JSON.stringify(workflow, null, 2), 'utf-8');
}

export function getStep(workflow: WorkflowFile, stepId: string): WorkflowStep | undefined {
  return workflow.steps.find((s) => s.id === stepId);
}

export class StepNotFoundError extends Error {}
export class InvalidStatusError extends Error {}

export function updateStepStatus(stepId: string, status: string): WorkflowStep {
  if (!VALID_STATUSES.includes(status as StepStatus)) {
    throw new InvalidStatusError(`Invalid status: ${status}`);
  }
  const { data: workflow } = loadWorkflow();
  const step = getStep(workflow, stepId);
  if (!step) {
    throw new StepNotFoundError(`Step not found: ${stepId}`);
  }
  step.status = status as StepStatus;
  saveWorkflow(workflow);
  return step;
}
