import type { AiServiceList } from "../types/aiService";
import type { WorkflowFile } from "../types/workflow";

// Renaming a configured AI service used to silently break every step and
// attempt that referenced it by name — the "開く" link and Ollama detection
// both match on the literal ai_name string, so a rename left old references
// pointing at nothing with no error anywhere. This computes old->new name
// pairs from a services edit and propagates them through every project's
// steps and attempts, so a rename actually renames everywhere it's used.
export function computeRenameMap(previous: AiServiceList, next: AiServiceList): Map<string, string> {
  const map = new Map<string, string>();
  for (const before of previous) {
    const after = next.find((s) => s.id === before.id);
    if (after && after.name !== before.name && before.name.trim() && after.name.trim()) {
      map.set(before.name, after.name);
    }
  }
  return map;
}

export function applyRenameMap(workflowFile: WorkflowFile, renameMap: Map<string, string>): WorkflowFile {
  if (renameMap.size === 0) return workflowFile;
  return {
    ...workflowFile,
    projects: workflowFile.projects.map((project) => ({
      ...project,
      steps: project.steps.map((step) => ({
        ...step,
        ai_name: renameMap.get(step.ai_name) ?? step.ai_name,
        attempts: step.attempts?.map((a) => ({
          ...a,
          ai_name: renameMap.get(a.ai_name) ?? a.ai_name,
        })),
      })),
    })),
  };
}
