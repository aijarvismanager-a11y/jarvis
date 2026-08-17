export * from './types.ts';
export { WorkerRegistry } from './registry.ts';
export { ClaudeCodeWorker } from './claude-code.ts';
export { GeminiWorker } from './gemini.ts';
export { ChatGPTWorker } from './chatgpt.ts';

import { WorkerRegistry } from './registry.ts';
import { ClaudeCodeWorker } from './claude-code.ts';
import { GeminiWorker } from './gemini.ts';
import { ChatGPTWorker } from './chatgpt.ts';

/**
 * Registry pre-loaded with the built-in Workers, disabled by default so
 * enabling one is an explicit opt-in (spec section 31: no surprise
 * subprocess/CLI/browser-automation usage). Callers enable per Worker
 * from Settings.
 */
export function createDefaultWorkerRegistry(workspace: string): WorkerRegistry {
  const registry = new WorkerRegistry();
  registry.register(new ClaudeCodeWorker({ workspace, enabled: false }));
  registry.register(new GeminiWorker({ workspace, enabled: false }));
  registry.register(new ChatGPTWorker({ workspace, enabled: false }));
  return registry;
}
