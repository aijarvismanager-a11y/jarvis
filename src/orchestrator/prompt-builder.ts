/**
 * Prompt Builder (spec section 18, Phase 4's "AI別テンプレート") - assembles
 * the copyable task package a user pastes into whichever AI the Router
 * recommends, for Manual Handoff (spec section 17) when no Worker can run
 * the task itself.
 *
 * The wording/structure differs per target AI - a ticket-style block reads
 * well to Claude Code's CLI, but a ChatGPT user pasting into a chat window
 * expects a sentence, not a form. Lookup is by AI/profile name
 * (case-insensitive); anything unrecognized (a custom Worker's name, or no
 * recommendation at all) falls back to the generic template.
 */

export type PromptBuilderOptions = {
  task: string;
  /** A distinct "why" framing, when the caller actually has one. Omit rather than repeating `task` - a template with no real objective just skips that section instead of showing the same text twice. */
  objective?: string;
  context?: string;
  expectedOutput?: string[];
  targetAI: string;
};

type TemplateFn = (opts: PromptBuilderOptions) => string;

function genericTemplate(opts: PromptBuilderOptions): string {
  const lines = ['TASK', opts.task];
  if (opts.objective) lines.push('', 'OBJECTIVE', opts.objective);
  if (opts.context) lines.push('', 'CONTEXT', opts.context);
  if (opts.expectedOutput?.length) {
    lines.push('', 'EXPECTED OUTPUT', ...opts.expectedOutput.map((item, i) => `${i + 1}. ${item}`));
  }
  lines.push('', 'TARGET AI', opts.targetAI);
  return lines.join('\n');
}

/** Claude Code reads markdown structure well and is typically driven from a repo - lean into that. */
function claudeCodeTemplate(opts: PromptBuilderOptions): string {
  const lines = ['## Task', opts.task];
  if (opts.objective) lines.push('', '## Objective', opts.objective);
  if (opts.context) lines.push('', '## Context', opts.context);
  if (opts.expectedOutput?.length) {
    lines.push('', '## Expected output', ...opts.expectedOutput.map((item, i) => `${i + 1}. ${item}`));
  }
  return lines.join('\n');
}

/** Gemini's routed strength is research/summarization - lead with the question, not a form. */
function geminiTemplate(opts: PromptBuilderOptions): string {
  const lines = opts.objective ? [opts.objective, '', `依頼内容: ${opts.task}`] : [`依頼内容: ${opts.task}`];
  if (opts.context) lines.push('', `背景情報: ${opts.context}`);
  if (opts.expectedOutput?.length) {
    lines.push('', '期待する出力:', ...opts.expectedOutput.map((item, i) => `${i + 1}. ${item}`));
  }
  return lines.join('\n');
}

/** Pasted into a chat window - a natural instruction, not a ticket. */
function chatgptTemplate(opts: PromptBuilderOptions): string {
  const lines = [`次のタスクをお願いします: ${opts.task}`];
  if (opts.objective) lines.push('', `目的: ${opts.objective}`);
  if (opts.context) lines.push('', `参考情報: ${opts.context}`);
  if (opts.expectedOutput?.length) {
    lines.push('', 'アウトプットに含めてほしいもの:', ...opts.expectedOutput.map((item) => `- ${item}`));
  }
  return lines.join('\n');
}

/** Local models tend to have smaller context windows and do worse with heavy scaffolding - keep it short. */
function ollamaTemplate(opts: PromptBuilderOptions): string {
  const lines = [opts.task];
  if (opts.context) lines.push('', opts.context);
  if (opts.expectedOutput?.length) {
    lines.push('', '出力: ' + opts.expectedOutput.join(' / '));
  }
  return lines.join('\n');
}

const TEMPLATES: Record<string, TemplateFn> = {
  claude_code: claudeCodeTemplate,
  gemini: geminiTemplate,
  chatgpt: chatgptTemplate,
  ollama: ollamaTemplate,
};

export function buildHandoffPrompt(opts: PromptBuilderOptions): string {
  const template = TEMPLATES[opts.targetAI.toLowerCase()] ?? genericTemplate;
  const body = template(opts);
  // Every template still ends with an explicit target line - what to paste
  // where matters more than the exact wording above it.
  return template === genericTemplate ? body : `${body}\n\n[TARGET AI: ${opts.targetAI}]`;
}
