/**
 * File-based Handoff (spec section 16) - external Workers (Gemini CLI,
 * ChatGPT, ...) can't write to JARVIS's sqlite vault, so the AI-to-AI
 * handoff record is also written as workspace/handoff/task_XXXX.json.
 * This is deliberately a plain-data mirror of src/agents/handoff.ts's
 * `Handoff` (DB-backed, JARVIS-internal accounting) - not a replacement.
 */

import { writeFileSync, readFileSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

export type FileHandoff = {
  task_id: string;
  from: string;
  to: string;
  status: 'ready' | 'in_progress' | 'completed' | 'failed' | 'needs_input';
  summary: string;
  instructions: string;
  files: string[];
  research: string[];
  next_action: string;
};

/** task_id becomes a filename (`${taskId}.json`) - this is the full set of characters that's safe there on every OS. Exported so callers (routes.ts) can reject a bad task_id up front, before a Worker runs, instead of only failing once handoffFilePath() throws after the fact. */
export const TASK_ID_RE = /^[A-Za-z0-9_-]+$/;

export function handoffFilePath(handoffDir: string, taskId: string): string {
  if (!TASK_ID_RE.test(taskId)) {
    throw new Error(`invalid task_id: ${taskId}`);
  }
  return join(handoffDir, `${taskId}.json`);
}

export function writeHandoffFile(handoffDir: string, handoff: FileHandoff): string {
  const path = handoffFilePath(handoffDir, handoff.task_id);
  writeFileSync(path, JSON.stringify(handoff, null, 2), 'utf-8');
  return path;
}

export function readHandoffFile(handoffDir: string, taskId: string): FileHandoff {
  const raw = readFileSync(handoffFilePath(handoffDir, taskId), 'utf-8');
  return JSON.parse(raw) as FileHandoff;
}

/** All filed handoffs, most recently written first. Skips unreadable/corrupt files rather than throwing. */
export async function listHandoffFiles(handoffDir: string, limit = 50): Promise<FileHandoff[]> {
  let names: string[];
  try {
    names = (await readdir(handoffDir)).filter((n) => n.endsWith('.json'));
  } catch {
    return [];
  }

  const withMtime = (
    await Promise.all(
      names.map(async (name) => {
        try {
          return { name, mtime: (await stat(join(handoffDir, name))).mtimeMs };
        } catch {
          return null;
        }
      })
    )
  )
    .filter((x): x is { name: string; mtime: number } => x !== null)
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, limit);

  const parsed = await Promise.all(
    withMtime.map(async ({ name }) => {
      try {
        return JSON.parse(await readFile(join(handoffDir, name), 'utf-8')) as FileHandoff;
      } catch {
        // corrupt/partial write - skip rather than fail the whole list
        return null;
      }
    })
  );
  return parsed.filter((h): h is FileHandoff => h !== null);
}
