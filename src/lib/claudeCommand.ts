import type { WorkflowStep } from "../types/workflow";

function stripWorkspacePrefix(p: string) {
  return p.replace(/^workspace\//, "");
}

function outputTarget(outputFiles: string[]): string {
  if (outputFiles.length === 0) return ".";
  const first = stripWorkspacePrefix(outputFiles[0]);
  // "src/*" -> "src/", "logs/test-result.log" -> "logs/test-result.log"
  return first.endsWith("/*") ? first.slice(0, -1) : first;
}

/**
 * A user-authored command_template always wins (explicit customization).
 * Otherwise, for Claude Code steps we compose a command from the step's
 * actual input/output files so it stays correct as those lists change,
 * instead of relying on a string someone typed once and forgot to update.
 */
export function buildClaudeCommand(step: WorkflowStep): string | null {
  if (step.command_template) return step.command_template;
  if (!step.ai_name.toLowerCase().includes("claude code")) return null;

  const inputs = step.input_files.map(stripWorkspacePrefix);
  const target = outputTarget(step.output_files);

  if (inputs.length === 0) {
    return `claude "${target} を実装して"`;
  }
  const inputList = inputs.join(" と ");
  return `claude "${inputList} を読んで ${target} に実装して"`;
}
