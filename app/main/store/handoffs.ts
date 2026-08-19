import path from 'node:path';
import fs from 'node:fs';
import { getProject } from './projects';
import { appendLog } from './logs';

export interface HandoffInput {
  from: string;
  to: string;
  task: string;
  completed: string;
  findings: string;
  remaining: string;
  files: string;
  instructions: string;
}

export interface HandoffFile {
  filename: string;
  from: string;
  to: string;
  task: string;
  createdAt: string;
  content: string;
}

function handoffDir(projectDir: string): string {
  return path.join(projectDir, 'handoff');
}

function parseField(content: string, header: string): string {
  const re = new RegExp(`## ${header}\\n([\\s\\S]*?)(?=\\n## |$)`);
  const m = content.match(re);
  return m ? m[1].trim() : '';
}

export function listHandoffs(projectId: string): HandoffFile[] {
  const project = getProject(projectId);
  if (!project) return [];
  const dir = handoffDir(project.dir);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .reverse()
    .map((filename) => {
      const content = fs.readFileSync(path.join(dir, filename), 'utf-8');
      const stat = fs.statSync(path.join(dir, filename));
      return {
        filename,
        from: parseField(content, 'From'),
        to: parseField(content, 'To'),
        task: parseField(content, 'Task'),
        createdAt: stat.birthtime.toISOString(),
        content,
      };
    });
}

export function createHandoff(projectId: string, input: HandoffInput): HandoffFile | null {
  const project = getProject(projectId);
  if (!project) return null;
  const dir = handoffDir(project.dir);
  fs.mkdirSync(dir, { recursive: true });
  const existing = fs.readdirSync(dir).filter((f) => /^handoff_\d+\.md$/.test(f));
  const nextN = existing.length + 1;
  const filename = `handoff_${String(nextN).padStart(3, '0')}.md`;

  const content = `# AI Handoff

## From
${input.from}

## To
${input.to}

## Task
${input.task}

## Completed
${input.completed}

## Important Findings
${input.findings}

## Remaining Tasks
${input.remaining}

## Files
${input.files}

## Instructions for Next AI
${input.instructions}
`;

  fs.writeFileSync(path.join(dir, filename), content, 'utf-8');
  appendLog({ ai: input.from, message: `Handoff作成: ${input.from} → ${input.to}（${filename}）` });
  return {
    filename,
    from: input.from,
    to: input.to,
    task: input.task,
    createdAt: new Date().toISOString(),
    content,
  };
}
