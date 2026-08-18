/**
 * MCP Worker persistence - user-added MCPWorker configs, stored the same
 * way as custom-registry.ts's CommandWorker configs but in their own file
 * since the config shape differs (command/args/tool vs binary/args).
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { MCPWorkerConfig } from './mcp.ts';
import { loadCustomWorkers, withWorkerRegistrationLock } from './custom-registry.ts';

const BUILTIN_NAMES = new Set(['claude_code', 'gemini', 'chatgpt']);

export function mcpWorkersPath(dataDir: string): string {
  return join(dataDir, 'mcp-workers.json');
}

export function loadMcpWorkers(dataDir: string): MCPWorkerConfig[] {
  const path = mcpWorkersPath(dataDir);
  if (!existsSync(path)) return [];
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveMcpWorkers(dataDir: string, list: MCPWorkerConfig[]): void {
  const path = mcpWorkersPath(dataDir);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(list, null, 2), 'utf-8');
}

export type AddMcpWorkerResult = { ok: true; config: MCPWorkerConfig } | { ok: false; error: string };

/** Validates and appends a new MCP Worker config, rejecting name collisions with built-ins or any existing custom/MCP Worker. */
export function addMcpWorker(dataDir: string, config: MCPWorkerConfig): Promise<AddMcpWorkerResult> {
  return withWorkerRegistrationLock(() => {
    if (!/^[a-z0-9_-]+$/i.test(config.name)) {
      return { ok: false, error: 'name must be alphanumeric (with _ or -), no spaces' };
    }
    if (BUILTIN_NAMES.has(config.name.toLowerCase())) {
      return { ok: false, error: `"${config.name}" is a built-in Worker name` };
    }
    if (!config.command.trim()) {
      return { ok: false, error: 'command is required' };
    }
    if (!config.tool.trim()) {
      return { ok: false, error: 'tool is required' };
    }
    if (config.capabilities.length === 0) {
      return { ok: false, error: 'at least one capability is required' };
    }

    const existing = loadMcpWorkers(dataDir);
    const takenNames = new Set([...existing.map((w) => w.name), ...loadCustomWorkers(dataDir).map((w) => w.name)]);
    if (takenNames.has(config.name)) {
      return { ok: false, error: `a Worker named "${config.name}" already exists` };
    }

    const next = [...existing, config];
    saveMcpWorkers(dataDir, next);
    return { ok: true, config };
  });
}

export function removeMcpWorker(dataDir: string, name: string): Promise<boolean> {
  return withWorkerRegistrationLock(() => {
    const existing = loadMcpWorkers(dataDir);
    const next = existing.filter((w) => w.name !== name);
    if (next.length === existing.length) return false;
    saveMcpWorkers(dataDir, next);
    return true;
  });
}
