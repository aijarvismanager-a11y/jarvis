import * as fs from 'fs';
import { resolveWorkspacePath } from './config';
import { GeneratedPrompt, WorkflowStep } from './types';

/**
 * Builds the prompt for a step. Input files are read fresh on every call
 * (not cached at step-selection time) so the prompt always reflects the
 * latest file contents; a missing file is embedded as a visible placeholder
 * instead of failing the whole generation.
 */
export function generatePrompt(step: WorkflowStep): GeneratedPrompt {
  const missingFiles: string[] = [];

  const filesBlock = step.input_files
    .map((relativePath) => {
      let content: string;
      try {
        content = fs.readFileSync(resolveWorkspacePath(relativePath), 'utf-8');
      } catch {
        missingFiles.push(relativePath);
        content = `[missing file: ${relativePath}]`;
      }
      return `### ${relativePath}\n${content}`;
    })
    .join('\n\n');

  const prompt = step.prompt_template
    .split('{{ai_name}}').join(step.ai_name)
    .split('{{role}}').join(step.role)
    .split('{{input_files}}').join(filesBlock);

  return { prompt, missingFiles };
}
