export type StepStatus = 'not_started' | 'in_progress' | 'done';

export interface WorkflowStep {
  id: string;
  index: number;
  ai_name: string;
  role: string;
  status: StepStatus;
  input_files: string[];
  output_files: string[];
  prompt_template: string;
}

export interface WorkflowFile {
  version: number;
  steps: WorkflowStep[];
}

export interface AiService {
  name: string;
  url: string;
}

export interface LoadResult<T> {
  data: T;
  ok: boolean;
  error?: string;
}

export interface GeneratedPrompt {
  prompt: string;
  missingFiles: string[];
}

export type PreviewEventType = 'created' | 'changed' | 'deleted';

export interface PreviewEvent {
  file: string;
  type: PreviewEventType;
  mtimeMs?: number;
}
