/**
 * Worker enablement persistence - the registry itself is rebuilt fresh on
 * every daemon start (createDefaultWorkerRegistry), so which Workers the
 * user turned on from the dashboard would otherwise be forgotten on
 * restart. Stored as a small standalone JSON file rather than a vault
 * table: it's daemon-lifecycle config, not task/agent data, and needs to
 * be readable before the DB is necessarily initialized.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { WorkerRegistry } from './registry.ts';

export type WorkerSettings = {
  /** Worker name -> whether the user enabled it. Absent = use the Worker's built-in default. */
  enabled: Record<string, boolean>;
};

const EMPTY: WorkerSettings = { enabled: {} };

export function workerSettingsPath(dataDir: string): string {
  return join(dataDir, 'workers.json');
}

export function loadWorkerSettings(dataDir: string): WorkerSettings {
  const path = workerSettingsPath(dataDir);
  if (!existsSync(path)) return EMPTY;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8'));
    if (parsed && typeof parsed === 'object' && parsed.enabled && typeof parsed.enabled === 'object') {
      return { enabled: parsed.enabled };
    }
    return EMPTY;
  } catch {
    // Corrupt file - fall back to defaults rather than crashing startup.
    return EMPTY;
  }
}

export function saveWorkerSettings(dataDir: string, settings: WorkerSettings): void {
  const path = workerSettingsPath(dataDir);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(settings, null, 2), 'utf-8');
}

/** Apply persisted enablement onto a freshly-built registry, skipping names the registry doesn't have. */
export function applyWorkerSettings(registry: WorkerRegistry, settings: WorkerSettings): void {
  for (const [name, enabled] of Object.entries(settings.enabled)) {
    const worker = registry.get(name);
    if (worker) worker.definition.enabled = enabled;
  }
}

/** Record one Worker's enabled flag and persist the merged settings. */
export function setWorkerEnabledPersisted(dataDir: string, name: string, enabled: boolean): WorkerSettings {
  const current = loadWorkerSettings(dataDir);
  const next: WorkerSettings = { enabled: { ...current.enabled, [name]: enabled } };
  saveWorkerSettings(dataDir, next);
  return next;
}
