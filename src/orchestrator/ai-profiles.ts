/**
 * AI Profile (spec section 10) - each Worker's task-category "strengths"
 * and routing priority, kept in an external, user-editable JSON file
 * instead of hardcoded in Worker source, so tuning who's recommended for
 * what never requires a code change.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { WorkerCapability } from '../workers/types.ts';

export type AIProfile = {
  enabled: boolean;
  /** 0-5 per capability; absent capability scores 0. */
  strengths: Partial<Record<WorkerCapability, number>>;
  /** Lower priority is tried first when two candidates tie on strength. */
  priority: number;
};

export type AIProfiles = Record<string, AIProfile>;

/** Initial routing table (spec section 12) - a starting point, not a fixed ranking. */
export const DEFAULT_AI_PROFILES: AIProfiles = {
  claude_code: {
    enabled: true,
    strengths: { code: 5, plan: 5, research: 4, write: 4, general: 4 },
    priority: 1,
  },
  gemini: {
    enabled: true,
    strengths: { research: 5, code: 4, write: 3, plan: 3, general: 3, image: 4 },
    priority: 1,
  },
  chatgpt: {
    enabled: true,
    strengths: { write: 5, plan: 4, general: 5, code: 4, research: 3 },
    priority: 1,
  },
};

function profilesPath(dataDir: string): string {
  return join(dataDir, 'ai-profiles.json');
}

/** Falls back to the defaults, merged under any user overrides, if the file is missing or unreadable. */
export function loadAIProfiles(dataDir: string): AIProfiles {
  const path = profilesPath(dataDir);
  if (!existsSync(path)) return DEFAULT_AI_PROFILES;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as AIProfiles;
    return { ...DEFAULT_AI_PROFILES, ...parsed };
  } catch {
    return DEFAULT_AI_PROFILES;
  }
}

export function saveAIProfiles(dataDir: string, profiles: AIProfiles): void {
  const path = profilesPath(dataDir);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(profiles, null, 2), 'utf8');
}
