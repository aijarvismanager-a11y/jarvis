/**
 * Health Monitor
 *
 * Monitors daemon health, service status, memory usage, and database connectivity.
 * Runs periodic health checks and logs warnings when issues are detected.
 */

import { existsSync, statSync } from "node:fs";
import { ServiceRegistry, type ServiceStatus } from "./services.ts";
import { getDb } from "../vault/schema.ts";

export type HealthStatus = {
  uptime: number;           // seconds
  services: Record<string, ServiceStatus>;
  memory: { heapUsed: number; heapTotal: number; rss: number };
  database: { connected: boolean; size: number };  // DB file size in bytes
  startedAt: number;        // epoch ms
  demoMode: boolean;        // spec §79-80 anti-dummy-data rule; see JarvisConfig.daemon.demo_mode
};

/** How long a service may sit in 'starting' before check() flags it as unhealthy too. */
const STARTING_STUCK_THRESHOLD_MS = 2 * 60_000;

export class HealthMonitor {
  private startTime: number;
  private registry: ServiceRegistry;
  private checkInterval: Timer | null = null;
  private dbPath: string;
  private demoMode: boolean;
  /** Last hour-milestone actually logged, so a tick that skips past an exact boundary doesn't lose the log line. */
  private lastMilestoneHour = 0;
  /** When each currently-'starting' service was first observed in that state. */
  private startingSince = new Map<string, number>();

  constructor(registry: ServiceRegistry, dbPath: string, demoMode: boolean = false) {
    this.startTime = Date.now();
    this.registry = registry;
    this.dbPath = dbPath;
    this.demoMode = demoMode;
  }

  /**
   * Start periodic health checks
   * @param intervalMs - Check interval in milliseconds (default: 30 seconds)
   */
  start(intervalMs: number = 30000): void {
    if (this.checkInterval) {
      console.log('[HealthMonitor] Already running');
      return;
    }

    console.log(`[HealthMonitor] Starting health checks (every ${intervalMs}ms)`);
    this.checkInterval = setInterval(() => {
      this.check();
    }, intervalMs);

    // Run initial check
    this.check();
  }

  /**
   * Stop periodic health checks
   */
  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
      console.log('[HealthMonitor] Stopped');
    }
  }

  /**
   * Get current health status
   */
  getHealth(): HealthStatus {
    const now = Date.now();
    // Date.now() isn't monotonic - a backward system clock step (NTP
    // correction, VM resume) after start() would otherwise go negative and
    // print nonsense like "-42s" in formatUptime().
    const uptime = Math.max(0, Math.floor((now - this.startTime) / 1000));
    const services = this.registry.getStatus();
    const memory = this.getMemoryStats();
    const database = this.getDatabaseStats();

    return {
      uptime,
      services,
      memory,
      database,
      startedAt: this.startTime,
      demoMode: this.demoMode,
    };
  }

  /**
   * Perform health check and log warnings
   */
  private check(): void {
    const health = this.getHealth();

    // Check service health. 'starting' isn't unhealthy by itself (every
    // service passes through it normally), but a service that never leaves
    // it - a hung network/DB call during init - is arguably the most
    // actionable failure mode and would otherwise be invisible forever.
    const now = Date.now();
    const startingNow = new Set<string>();
    for (const [name, status] of Object.entries(health.services)) {
      if (status !== 'starting') continue;
      startingNow.add(name);
      if (!this.startingSince.has(name)) this.startingSince.set(name, now);
    }
    for (const name of [...this.startingSince.keys()]) {
      if (!startingNow.has(name)) this.startingSince.delete(name);
    }
    const stuckStarting = new Set(
      [...this.startingSince.entries()]
        .filter(([, since]) => now - since > STARTING_STUCK_THRESHOLD_MS)
        .map(([name]) => name),
    );

    const unhealthyServices = Object.entries(health.services)
      .filter(([name, status]) => status === 'error' || status === 'stopping' || stuckStarting.has(name));

    if (unhealthyServices.length > 0) {
      console.warn('[HealthMonitor] ⚠ Unhealthy services detected:');
      for (const [name, status] of unhealthyServices) {
        const info = this.registry.getServiceInfo(name);
        const error = info?.error ? ` - ${info.error}` : '';
        const stuckNote = stuckStarting.has(name) ? ' (stuck starting)' : '';
        console.warn(`  - ${name}: ${status}${stuckNote}${error}`);
      }
    }

    // Check database connectivity
    if (!health.database.connected) {
      console.warn('[HealthMonitor] ⚠ Database not connected');
    }

    // Check memory usage (warn if > 500MB)
    const memoryMB = health.memory.rss / (1024 * 1024);
    if (memoryMB > 500) {
      console.warn(
        `[HealthMonitor] ⚠ High memory usage: ${memoryMB.toFixed(2)}MB RSS`
      );
    }

    // Log uptime milestone (every hour). Compares completed-hours-so-far
    // against the last one logged, rather than requiring an exact
    // uptime % 3600 === 0 hit - setInterval ticks rarely land on an exact
    // boundary (event-loop lag, GC pauses, a non-divisor intervalMs), and a
    // missed exact match used to permanently skip that hour's log line.
    const completedHours = Math.floor(health.uptime / 3600);
    if (completedHours > this.lastMilestoneHour) {
      this.lastMilestoneHour = completedHours;
      console.log(`[HealthMonitor] Uptime: ${completedHours} hour${completedHours > 1 ? 's' : ''}`);
    }
  }

  /**
   * Get memory statistics
   */
  private getMemoryStats(): { heapUsed: number; heapTotal: number; rss: number } {
    const usage = process.memoryUsage();
    return {
      heapUsed: usage.heapUsed,
      heapTotal: usage.heapTotal,
      rss: usage.rss,
    };
  }

  /**
   * Get database statistics
   */
  private getDatabaseStats(): { connected: boolean; size: number } {
    let connected = false;
    let size = 0;

    try {
      const db = getDb();
      // Simple query to check if DB is responsive
      db.query("SELECT 1").get();
      connected = true;

      // Get DB file size if it's not in-memory
      if (this.dbPath !== ':memory:' && existsSync(this.dbPath)) {
        const stats = statSync(this.dbPath);
        size = stats.size;
      }
    } catch (error) {
      // Log the real cause - a corrupt DB file, disk I/O failure, or
      // migration mismatch looked identical to "not initialized yet"
      // before this, since check() only ever printed the generic
      // "Database not connected" warning either way.
      console.error('[HealthMonitor] Database check failed:', error);
      connected = false;
    }

    return { connected, size };
  }

  /**
   * Format health status as human-readable string
   */
  formatHealth(): string {
    const health = this.getHealth();
    const lines: string[] = [];

    lines.push('=== JARVIS Health Status ===');
    lines.push(`Uptime: ${this.formatUptime(health.uptime)}`);
    lines.push(`Started: ${new Date(health.startedAt).toISOString()}`);
    lines.push('');

    lines.push('Services:');
    for (const [name, status] of Object.entries(health.services)) {
      const icon = status === 'running' ? '✓' : status === 'error' ? '✗' : '○';
      lines.push(`  ${icon} ${name}: ${status}`);
    }
    lines.push('');

    lines.push('Memory:');
    lines.push(`  Heap: ${this.formatBytes(health.memory.heapUsed)} / ${this.formatBytes(health.memory.heapTotal)}`);
    lines.push(`  RSS: ${this.formatBytes(health.memory.rss)}`);
    lines.push('');

    lines.push('Database:');
    lines.push(`  Connected: ${health.database.connected ? 'Yes' : 'No'}`);
    lines.push(`  Size: ${this.formatBytes(health.database.size)}`);

    return lines.join('\n');
  }

  /**
   * Format uptime in human-readable format
   */
  private formatUptime(seconds: number): string {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    const parts: string[] = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);

    return parts.join(' ');
  }

  /**
   * Format bytes in human-readable format
   */
  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';

    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
    const i = Math.min(sizes.length - 1, Math.floor(Math.log(bytes) / Math.log(k)));
    const size = bytes / Math.pow(k, i);

    return `${size.toFixed(2)} ${sizes[i]}`;
  }
}
