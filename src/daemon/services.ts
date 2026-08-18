/**
 * Service Registry
 *
 * Manages lifecycle of all daemon services (observers, agents, WebSocket server, etc.)
 * Services are started in registration order and stopped in reverse order.
 */

export type ServiceStatus = 'stopped' | 'starting' | 'running' | 'stopping' | 'error';

export interface Service {
  name: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  status(): ServiceStatus;
}

interface RegisteredService {
  service: Service;
  status: ServiceStatus;
  error?: string;
}

export class ServiceRegistry {
  private services = new Map<string, RegisteredService>();

  /**
   * Register a service
   */
  register(service: Service): void {
    if (this.services.has(service.name)) {
      throw new Error(`Service '${service.name}' is already registered`);
    }
    this.services.set(service.name, {
      service,
      status: 'stopped',
    });
    console.log(`[ServiceRegistry] Registered service: ${service.name}`);
  }

  /**
   * Start all registered services in order. A single service failing (which
   * startService() already logs and records via getStatus()/getServiceInfo())
   * does not abort the batch - every other service still gets a chance to
   * start, matching the "individual failures don't crash the whole thing"
   * pattern used elsewhere (e.g. ObserverManager.startAll()). The prior
   * abort-on-first-failure behavior meant one failed service (e.g. a missing
   * LLM key) silently skipped starting every service registered after it,
   * including the WebSocket/HTTP server - and since callers historically
   * awaited this with no try/catch, that failure surfaced as an unhandled
   * crash that bypassed graceful shutdown entirely.
   */
  async startAll(): Promise<void> {
    console.log('[ServiceRegistry] Starting all services...');
    for (const [name] of this.services) {
      try {
        await this.startService(name);
      } catch {
        // Already logged and recorded as 'error' status by startService();
        // continue so later services still get to start.
      }
    }
    console.log('[ServiceRegistry] All services started');
  }

  /**
   * Stop all services in reverse order. Same reasoning as startAll(): one
   * service's stop() throwing must not abort the rest, or shutdown cleanup
   * that depends on every service actually being stopped (DB close,
   * lockfile release) never runs.
   */
  async stopAll(): Promise<void> {
    console.log('[ServiceRegistry] Stopping all services...');
    const serviceNames = Array.from(this.services.keys()).reverse();
    for (const name of serviceNames) {
      try {
        await this.stopService(name);
      } catch {
        // Already logged and recorded as 'error' status by stopService();
        // continue so later services still get a chance to stop.
      }
    }
    console.log('[ServiceRegistry] All services stopped');
  }

  /**
   * Start a specific service
   */
  async startService(name: string): Promise<void> {
    const registered = this.services.get(name);
    if (!registered) {
      throw new Error(`Service '${name}' not found`);
    }

    if (registered.status === 'running') {
      console.log(`[ServiceRegistry] Service '${name}' is already running`);
      return;
    }
    if (registered.status === 'starting') {
      console.log(`[ServiceRegistry] Service '${name}' is already starting - ignoring concurrent call`);
      return;
    }

    try {
      registered.status = 'starting';
      this.services.set(name, registered);

      console.log(`[ServiceRegistry] Starting ${name}...`);
      await registered.service.start();

      registered.status = 'running';
      registered.error = undefined;
      this.services.set(name, registered);

      console.log(`[ServiceRegistry] ✓ ${name} started`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      registered.status = 'error';
      registered.error = message;
      this.services.set(name, registered);

      console.error(`[ServiceRegistry] ✗ Failed to start ${name}: ${message}`);
      throw error;
    }
  }

  /**
   * Stop a specific service
   */
  async stopService(name: string): Promise<void> {
    const registered = this.services.get(name);
    if (!registered) {
      throw new Error(`Service '${name}' not found`);
    }

    if (registered.status === 'stopped') {
      console.log(`[ServiceRegistry] Service '${name}' is already stopped`);
      return;
    }
    if (registered.status === 'stopping') {
      console.log(`[ServiceRegistry] Service '${name}' is already stopping - ignoring concurrent call`);
      return;
    }

    try {
      registered.status = 'stopping';
      this.services.set(name, registered);

      console.log(`[ServiceRegistry] Stopping ${name}...`);
      await registered.service.stop();

      registered.status = 'stopped';
      registered.error = undefined;
      this.services.set(name, registered);

      console.log(`[ServiceRegistry] ✓ ${name} stopped`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      registered.status = 'error';
      registered.error = message;
      this.services.set(name, registered);

      console.error(`[ServiceRegistry] ✗ Failed to stop ${name}: ${message}`);
      throw error;
    }
  }

  /**
   * Get status of all services
   */
  getStatus(): Record<string, ServiceStatus> {
    const status: Record<string, ServiceStatus> = {};
    for (const [name, registered] of this.services) {
      status[name] = registered.status;
    }
    return status;
  }

  /**
   * Get a specific service
   */
  get(name: string): Service | undefined {
    return this.services.get(name)?.service;
  }

  /**
   * Get all registered service names
   */
  list(): string[] {
    return Array.from(this.services.keys());
  }

  /**
   * Check if a service is registered
   */
  has(name: string): boolean {
    return this.services.has(name);
  }

  /**
   * Get detailed service info including errors
   */
  getServiceInfo(name: string): RegisteredService | undefined {
    return this.services.get(name);
  }
}
