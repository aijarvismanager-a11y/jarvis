import { getDb, generateId } from './schema.ts';

/**
 * Phase 13-D: a record of one image_generate call's output (prompt + saved
 * file paths), so the dashboard can list past generations. Separate from
 * llm_usage's subsystem='image' cost-accounting rows - see schema.ts's
 * comment on image_generations for why.
 */
export type ImageGeneration = {
  id: string;
  prompt: string;
  revised_prompt: string | null;
  provider: string;
  model: string;
  file_paths: string[];
  created_at: number;
};

type ImageGenerationRow = {
  id: string;
  prompt: string;
  revised_prompt: string | null;
  provider: string;
  model: string;
  file_paths: string;
  created_at: number;
};

function parseRow(row: ImageGenerationRow): ImageGeneration {
  return { ...row, file_paths: JSON.parse(row.file_paths) };
}

export function createImageGeneration(
  prompt: string,
  provider: string,
  model: string,
  file_paths: string[],
  opts?: { revised_prompt?: string | null },
): ImageGeneration {
  const db = getDb();
  const id = generateId();
  const now = Date.now();
  const revised_prompt = opts?.revised_prompt ?? null;

  db.prepare(
    `INSERT INTO image_generations (id, prompt, revised_prompt, provider, model, file_paths, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, prompt, revised_prompt, provider, model, JSON.stringify(file_paths), now);

  return { id, prompt, revised_prompt, provider, model, file_paths, created_at: now };
}

export function listImageGenerations(limit: number = 50, offset: number = 0): ImageGeneration[] {
  const db = getDb();
  const rows = db
    .prepare('SELECT * FROM image_generations ORDER BY created_at DESC LIMIT ? OFFSET ?')
    .all(limit, offset) as ImageGenerationRow[];
  return rows.map(parseRow);
}
