/**
 * AI Profile (spec section 10) - each Worker's task-category "strengths"
 * and routing priority, kept in an external, user-editable JSON file
 * instead of hardcoded in Worker source, so tuning who's recommended for
 * what never requires a code change.
 */

import { join } from 'node:path';
import type { WorkerCapability } from '../workers/types.ts';
import { loadJsonConfig, saveJsonConfig } from '../util/json-config.ts';

export type AIProfile = {
  enabled: boolean;
  /** 0-5 per capability; absent capability scores 0. */
  strengths: Partial<Record<WorkerCapability, number>>;
  /** Lower priority is tried first when two candidates tie on strength. */
  priority: number;
};

export type AIProfiles = Record<string, AIProfile>;

/**
 * Initial routing table (spec section 12) - a starting point, not a fixed
 * ranking.
 *
 * Strengths are only listed for capabilities the matching Worker actually
 * declares (see each Worker's `capabilities` array) - `TaskTemplate` (the
 * only source of a routable capability today) has no `image` entry, so a
 * capability score with no reachable template/Worker pair would be dead
 * configuration that dresses up a recommendation the system can never
 * execute or offer for Manual Handoff.
 */
export const DEFAULT_AI_PROFILES: AIProfiles = {
  claude_code: {
    enabled: true,
    strengths: { code: 5, plan: 5, research: 4, write: 4, general: 4 },
    priority: 1,
  },
  gemini: {
    enabled: true,
    strengths: { research: 5, code: 4, write: 3, plan: 3, general: 3 },
    priority: 1,
  },
  chatgpt: {
    enabled: true,
    strengths: { write: 5, plan: 4, general: 5, code: 4, research: 3 },
    priority: 1,
  },
  // Local LLM (spec section 22/41) - free, no network required, but
  // generally weaker than the cloud AIs above: modest strengths, and a
  // higher (later-tried) priority so it's picked as a fallback rather than
  // a first choice when a cloud AI is also enabled and available.
  ollama: {
    enabled: true,
    strengths: { general: 3, write: 2, research: 2 },
    priority: 2,
  },
};

function profilesPath(dataDir: string): string {
  return join(dataDir, 'ai-profiles.json');
}

/** Falls back to the defaults, merged under any user overrides, if the file is missing or unreadable. */
export function loadAIProfiles(dataDir: string): AIProfiles {
  return loadJsonConfig(profilesPath(dataDir), DEFAULT_AI_PROFILES);
}

export function saveAIProfiles(dataDir: string, profiles: AIProfiles): void {
  saveJsonConfig(profilesPath(dataDir), profiles);
}
