import * as fs from 'fs';
import { AI_SERVICES_FILE } from './config';
import { AiService, LoadResult } from './types';

function isAiServiceShape(value: unknown): value is AiService {
  if (typeof value !== 'object' || value === null) return false;
  const s = value as Record<string, unknown>;
  return typeof s.name === 'string' && typeof s.url === 'string';
}

/**
 * Loads config/ai_services.json (the list of AI services steps can reference
 * by name). Missing file or invalid content falls back to an empty list.
 */
export function loadAiServices(): LoadResult<AiService[]> {
  let raw: string;
  try {
    raw = fs.readFileSync(AI_SERVICES_FILE, 'utf-8');
  } catch {
    return {
      data: [],
      ok: false,
      error: `ai_services.json not found at ${AI_SERVICES_FILE}`,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return {
      data: [],
      ok: false,
      error: `ai_services.json is not valid JSON: ${(err as Error).message}`,
    };
  }

  if (!Array.isArray(parsed) || !parsed.every(isAiServiceShape)) {
    return {
      data: [],
      ok: false,
      error: 'ai_services.json does not match the expected schema (array of {name, url})',
    };
  }

  return { data: parsed, ok: true };
}
