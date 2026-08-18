/**
 * Event Reactor — Immediate Response Engine
 *
 * Handles critical/high priority events by sending them to the agent
 * as synthetic messages with full tool access. Includes cooldown and
 * deduplication to prevent reaction storms.
 */

import type { ClassifiedEvent } from './event-classifier.ts';
import type { IAgentService } from './agent-service-interface.ts';

export type ReactorConfig = {
  /** Max reactions per event type within the cooldown window */
  maxPerType: number;
  /** Cooldown window per event type in ms (default: 10s) */
  typeCooldownMs: number;
  /** Global max reactions within the global window */
  globalMax: number;
  /** Global cooldown window in ms (default: 10 min) */
  globalWindowMs: number;
};

const DEFAULT_CONFIG: ReactorConfig = {
  maxPerType: 5,
  typeCooldownMs: 10_000,
  globalMax: 15,
  globalWindowMs: 10 * 60_000,
};

type ReactionRecord = {
  eventHash: string;
  eventType: string;
  timestamp: number;
};

export type ReactionCallback = (text: string, priority: 'urgent' | 'normal') => void;

export class EventReactor {
  private agentService: IAgentService | null = null;
  private config: ReactorConfig;
  private reactionLog: ReactionRecord[] = [];
  private seenHashes = new Set<string>();
  private onReaction: ReactionCallback | null = null;
  private queue: ClassifiedEvent[] = [];
  private processing = false;

  constructor(config?: Partial<ReactorConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Wire the reactor to the agent service (called during daemon startup).
   */
  setAgentService(agent: IAgentService): void {
    this.agentService = agent;
  }

  /**
   * Set callback for when a reaction is produced (e.g., broadcast via WebSocket).
   */
  setReactionCallback(cb: ReactionCallback): void {
    this.onReaction = cb;
  }

  /**
   * Attempt to react to a classified event.
   * Returns true if reaction was triggered, false if throttled/deduped.
   */
  async react(classified: ClassifiedEvent): Promise<boolean> {
    if (!this.agentService) {
      console.warn('[EventReactor] No agent service configured, skipping reaction');
      return false;
    }

    const hash = this.hashEvent(classified);

    // Deduplication: don't react to the exact same event twice
    if (this.seenHashes.has(hash)) {
      return false;
    }

    // Cooldown: check per-type rate limit
    if (!this.canReactForType(classified.event.type)) {
      console.log(`[EventReactor] Cooldown active for type: ${classified.event.type}`);
      return false;
    }

    // Cooldown: check global rate limit
    if (!this.canReactGlobally()) {
      console.log('[EventReactor] Global reaction limit reached');
      return false;
    }

    // If already processing, queue for later
    if (this.processing) {
      console.log(`[EventReactor] Queuing event (${this.queue.length + 1} in queue): ${classified.reason}`);
      this.queue.push(classified);
      return true; // Will be processed later
    }

    await this.processEvent(classified, hash);
    return true;
  }

  // --- Private helpers ---

  private async processEvent(classified: ClassifiedEvent, hash: string): Promise<void> {
    this.processing = true;

    try {
      const prompt = this.buildReactionPrompt(classified);
      console.log(`[EventReactor] Reacting to ${classified.priority} event: ${classified.reason}`);

      const response = await this.agentService!.handleMessage(prompt, 'system');

      // Record the reaction
      this.recordReaction(hash, classified.event.type);

      // Broadcast via callback. 'high' events (e.g. commitment due soon,
      // urgent email, screen error) must surface as 'urgent' too - only
      // matching on 'critical' silently downgraded them to the same
      // 'normal' bucket as routine file-modified noise.
      const priority = classified.priority === 'critical' || classified.priority === 'high' ? 'urgent' : 'normal';
      if (this.onReaction) {
        if (response) {
          this.onReaction(response, priority);
        } else {
          // Reaction was still recorded (counts against maxPerType/globalMax
          // above) but produced no text - log it so an empty agent response
          // isn't indistinguishable from the event never having reacted.
          console.warn(`[EventReactor] Reaction for ${classified.event.type} produced an empty response - not broadcast`);
        }
      }
    } catch (err) {
      console.error('[EventReactor] Reaction failed:', err);
    } finally {
      this.processing = false;

      // Drain the queue
      await this.processQueue();
    }
  }

  private async processQueue(): Promise<void> {
    while (this.queue.length > 0 && !this.processing) {
      const next = this.queue.shift()!;
      const hash = this.hashEvent(next);

      // Re-check dedup and cooldowns before processing queued event. Log
      // each drop - react() already returned `true` to the original caller
      // for these ("will be processed later"), so without a log line here
      // a queued-then-dropped event leaves no trace anywhere that it never
      // actually reacted.
      if (this.seenHashes.has(hash)) {
        console.log(`[EventReactor] Dropping queued event (already seen): ${next.reason}`);
        continue;
      }
      if (!this.canReactForType(next.event.type)) {
        console.log(`[EventReactor] Dropping queued event (cooldown active for type ${next.event.type}): ${next.reason}`);
        continue;
      }
      if (!this.canReactGlobally()) {
        console.log(`[EventReactor] Dropping remaining queue (global reaction limit reached), ${this.queue.length + 1} event(s) discarded`);
        break;
      }

      await this.processEvent(next, hash);
    }
  }

  private buildReactionPrompt(classified: ClassifiedEvent): string {
    const { event, priority, reason } = classified;
    const dataStr = JSON.stringify(event.data, null, 2);

    return [
      `[PROACTIVE — ${priority.toUpperCase()}]`,
      '',
      reason,
      '',
      `Event type: ${event.type}`,
      `Event data: ${dataStr}`,
      '',
      'Take appropriate action. You have full access to your tools (browser, terminal, files).',
      'If this requires user attention, explain clearly what happened and what you did or recommend.',
      'If you can handle it autonomously, do so and report what you did.',
    ].join('\n');
  }

  private hashEvent(classified: ClassifiedEvent): string {
    // type + stringified data (first 500 chars to avoid huge hashes).
    // Two independent 32-bit accumulators (djb2-style, seeded differently)
    // combined into one ~64-bit key - a single 32-bit fold collides too
    // easily for a dedup set that entries can sit in for up to an hour
    // (see recordReaction), silently dropping a later, genuinely different
    // event that happened to hash the same.
    const key = `${classified.event.type}:${JSON.stringify(classified.event.data).slice(0, 500)}`;
    let hashA = 0;
    let hashB = 5381;
    for (let i = 0; i < key.length; i++) {
      const char = key.charCodeAt(i);
      hashA = ((hashA << 5) - hashA) + char;
      hashA |= 0;
      hashB = ((hashB << 5) + hashB) ^ char;
      hashB |= 0;
    }
    return `${hashA.toString(36)}${hashB.toString(36)}`;
  }

  private canReactForType(eventType: string): boolean {
    const now = Date.now();
    const cutoff = now - this.config.typeCooldownMs;

    const recentForType = this.reactionLog.filter(
      r => r.eventType === eventType && r.timestamp > cutoff
    );

    return recentForType.length < this.config.maxPerType;
  }

  private canReactGlobally(): boolean {
    const now = Date.now();
    const cutoff = now - this.config.globalWindowMs;

    const recentGlobal = this.reactionLog.filter(r => r.timestamp > cutoff);

    return recentGlobal.length < this.config.globalMax;
  }

  private recordReaction(hash: string, eventType: string): void {
    const now = Date.now();

    this.reactionLog.push({ eventHash: hash, eventType, timestamp: now });
    this.seenHashes.add(hash);

    // Prune old records (keep last hour)
    const oneHourAgo = now - 60 * 60_000;
    this.reactionLog = this.reactionLog.filter(r => r.timestamp > oneHourAgo);

    // Prune seen hashes (keep max 1000)
    if (this.seenHashes.size > 1000) {
      const arr = Array.from(this.seenHashes);
      this.seenHashes = new Set(arr.slice(arr.length - 500));
    }
  }
}
