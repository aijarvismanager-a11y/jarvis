/**
 * Prompt Builder (spec section 18) - assembles the copyable task package
 * a user pastes into whichever AI the Router recommends, for Manual
 * Handoff (spec section 17) when no Worker can run the task itself.
 */

export function buildHandoffPrompt(opts: {
  task: string;
  objective: string;
  context?: string;
  expectedOutput?: string[];
  targetAI: string;
}): string {
  const lines = ['TASK', opts.task, '', 'OBJECTIVE', opts.objective];
  if (opts.context) lines.push('', 'CONTEXT', opts.context);
  if (opts.expectedOutput?.length) {
    lines.push('', 'EXPECTED OUTPUT', ...opts.expectedOutput.map((item, i) => `${i + 1}. ${item}`));
  }
  lines.push('', 'TARGET AI', opts.targetAI);
  return lines.join('\n');
}
