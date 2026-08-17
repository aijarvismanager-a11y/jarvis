/**
 * WorkerRegistry - tracks the external AI Workers JARVIS knows about
 * (spec section 10: `workers/claude/`, `workers/gemini/`, ...). Purely
 * in-memory bookkeeping; the daemon owns wiring it up at startup.
 */

import type { Worker, WorkerCapability, WorkerStatus } from './types.ts';

export class WorkerRegistry {
  private readonly workers = new Map<string, Worker>();

  register(worker: Worker): void {
    this.workers.set(worker.definition.name, worker);
  }

  unregister(name: string): void {
    this.workers.delete(name);
  }

  get(name: string): Worker | undefined {
    return this.workers.get(name);
  }

  list(): Worker[] {
    return [...this.workers.values()];
  }

  /** Enabled workers that declare a given capability, in registration order. */
  findByCapability(capability: WorkerCapability): Worker[] {
    return this.list().filter(
      (w) => w.definition.enabled && w.definition.capabilities.includes(capability)
    );
  }

  setStatus(name: string, status: WorkerStatus): void {
    const worker = this.workers.get(name);
    if (worker) worker.definition.status = status;
  }
}
