/**
 * Shared load/save for the small external, user-editable JSON config files
 * scattered across src/orchestrator (budget.json, pricing.json,
 * ai-profiles.json, ...) - existsSync -> readFileSync/JSON.parse with a
 * fallback to defaults on missing/corrupt input, and mkdirSync+writeFileSync
 * on the way out. Previously copy-pasted verbatim in each of them.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Loads `path` as JSON, falling back to `defaults` when the file is
 * missing or unparseable. By default the parsed content is shallow-merged
 * over `defaults`; pass `merge` for anything that needs deeper merging
 * (e.g. a nested `models` table that should itself be merged, not replaced).
 */
export function loadJsonConfig<T>(
  path: string,
  defaults: T,
  merge: (defaults: T, parsed: Partial<T>) => T = (d, p) => ({ ...d, ...p }),
): T {
  if (!existsSync(path)) return defaults;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<T>;
    return merge(defaults, parsed);
  } catch {
    return defaults;
  }
}

export function saveJsonConfig<T>(path: string, value: T): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2), 'utf8');
}
