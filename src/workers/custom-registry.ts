/**
 * Custom Worker persistence - user-added CommandWorker configs, stored
 * separately from settings.ts's enabled-flags-only WorkerSettings because
 * these carry full definitions (binary/args/capabilities) for Workers
 * that don't exist in code at all until the user adds them.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { CommandWorkerConfig } from './command-worker.ts';
import { loadMcpWorkers } from './mcp-registry.ts';

export const BUILTIN_NAMES = new Set(['claude_code', 'gemini', 'chatgpt', 'ollama']);

// Serializes custom/MCP Worker registration (see mcp-registry.ts's addMcpWorker,
// which shares this lock) so concurrent adds can't both pass the cross-store
// name-collision check before either write lands.
let registrationLock: Promise<unknown> = Promise.resolve();
export function withWorkerRegistrationLock<T>(fn: () => T): Promise<T> {
  const result = registrationLock.then(fn, fn);
  registrationLock = result.catch(() => {});
  return result;
}

export function customWorkersPath(dataDir: string): string {
  return join(dataDir, 'custom-workers.json');
}

export function loadCustomWorkers(dataDir: string): CommandWorkerConfig[] {
  const path = customWorkersPath(dataDir);
  if (!existsSync(path)) return [];
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveCustomWorkers(dataDir: string, list: CommandWorkerConfig[]): void {
  const path = customWorkersPath(dataDir);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(list, null, 2), 'utf-8');
}

export type AddCustomWorkerResult = { ok: true; config: CommandWorkerConfig } | { ok: false; error: string };

/** Validates and appends a new custom Worker config, rejecting name collisions with built-ins or existing custom Workers. */
export function addCustomWorker(dataDir: string, config: CommandWorkerConfig): Promise<AddCustomWorkerResult> {
  return withWorkerRegistrationLock(() => {
    if (!/^[a-z0-9_-]+$/i.test(config.name)) {
      return { ok: false, error: 'name must be alphanumeric (with _ or -), no spaces' };
    }
    if (BUILTIN_NAMES.has(config.name.toLowerCase())) {
      return { ok: false, error: `"${config.name}" is a built-in Worker name` };
    }
    if (!config.binary.trim()) {
      return { ok: false, error: 'binary is required' };
    }
    if (config.capabilities.length === 0) {
      return { ok: false, error: 'at least one capability is required' };
    }

    const existing = loadCustomWorkers(dataDir);
    const takenNames = new Set([...existing.map((w) => w.name), ...loadMcpWorkers(dataDir).map((w) => w.name)]);
    if (takenNames.has(config.name)) {
      return { ok: false, error: `a Worker named "${config.name}" already exists` };
    }

    const next = [...existing, config];
    saveCustomWorkers(dataDir, next);
    return { ok: true, config };
  });
}

export function removeCustomWorker(dataDir: string, name: string): Promise<boolean> {
  return withWorkerRegistrationLock(() => {
    const existing = loadCustomWorkers(dataDir);
    const next = existing.filter((w) => w.name !== name);
    if (next.length === existing.length) return false;
    saveCustomWorkers(dataDir, next);
    return true;
  });
}
