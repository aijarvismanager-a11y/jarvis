/**
 * ResearchQueue — Background Research Engine
 *
 * Manages a queue of topics for JARVIS to research during idle time.
 * Topics come from conversations, explicit requests, or the agent itself.
 * The heartbeat picks up the next topic when nothing urgent is happening.
 */

export type ResearchPriority = 'high' | 'normal' | 'low';
export type ResearchStatus = 'queued' | 'in_progress' | 'completed' | 'failed';

export type ResearchTopic = {
  id: string;
  topic: string;
  reason: string;
  source: string;       // 'user' | 'agent' | 'conversation'
  priority: ResearchPriority;
  status: ResearchStatus;
  result?: string;
  failReason?: string;
  created_at: number;
  completed_at?: number;
};

const MAX_QUEUE_SIZE = 50;

export class ResearchQueue {
  private topics: Map<string, ResearchTopic> = new Map();

  /**
   * Add a topic to the research queue.
   */
  addTopic(
    topic: string,
    reason: string,
    source: string = 'user',
    priority: ResearchPriority = 'normal'
  ): ResearchTopic {
    // Enforce max queue size (drop oldest low-priority)
    if (this.topics.size >= MAX_QUEUE_SIZE) {
      this.evictOldest();
    }

    const entry: ResearchTopic = {
      id: crypto.randomUUID(),
      topic,
      reason,
      source,
      priority,
      status: 'queued',
      created_at: Date.now(),
    };

    this.topics.set(entry.id, entry);
    console.log(`[ResearchQueue] Added: "${topic}" (${priority}, from ${source})`);
    return entry;
  }

  /**
   * Get the next highest-priority queued topic.
   */
  getNext(): ResearchTopic | null {
    const queued = Array.from(this.topics.values())
      .filter((t) => t.status === 'queued')
      .sort((a, b) => {
        // Priority order: high > normal > low
        const pOrder: Record<ResearchPriority, number> = { high: 0, normal: 1, low: 2 };
        const pDiff = pOrder[a.priority] - pOrder[b.priority];
        if (pDiff !== 0) return pDiff;
        // Older topics first within same priority
        return a.created_at - b.created_at;
      });

    return queued[0] ?? null;
  }

  /**
   * Mark a topic as in-progress.
   */
  startResearch(id: string): boolean {
    const topic = this.topics.get(id);
    if (!topic || topic.status !== 'queued') return false;
    topic.status = 'in_progress';
    return true;
  }

  /**
   * Mark a topic as completed with a result.
   */
  complete(id: string, result: string): boolean {
    const topic = this.topics.get(id);
    if (!topic) {
      console.warn(`[ResearchQueue] complete() called for unknown/removed topic ${id} - result discarded`);
      return false;
    }
    if (topic.status !== 'in_progress') {
      console.warn(`[ResearchQueue] complete() called for topic ${id} in status '${topic.status}', not 'in_progress' - ignoring`);
      return false;
    }
    topic.status = 'completed';
    topic.result = result;
    topic.completed_at = Date.now();
    console.log(`[ResearchQueue] Completed: "${topic.topic}"`);
    return true;
  }

  /**
   * Mark a topic as failed.
   */
  fail(id: string, reason: string): boolean {
    const topic = this.topics.get(id);
    if (!topic) {
      console.warn(`[ResearchQueue] fail() called for unknown/removed topic ${id} - result discarded`);
      return false;
    }
    if (topic.status !== 'in_progress') {
      console.warn(`[ResearchQueue] fail() called for topic ${id} in status '${topic.status}', not 'in_progress' - ignoring`);
      return false;
    }
    topic.status = 'failed';
    topic.failReason = reason;
    topic.completed_at = Date.now();
    console.log(`[ResearchQueue] Failed: "${topic.topic}" — ${reason}`);
    return true;
  }

  /**
   * Remove a topic from the queue.
   */
  remove(id: string): boolean {
    return this.topics.delete(id);
  }

  /**
   * List all topics, optionally filtered by status.
   */
  list(status?: ResearchStatus): ResearchTopic[] {
    const all = Array.from(this.topics.values());
    if (status) return all.filter((t) => t.status === status);
    return all;
  }

  /**
   * Get count of queued topics.
   */
  queuedCount(): number {
    return Array.from(this.topics.values()).filter((t) => t.status === 'queued').length;
  }

  /**
   * Evict one topic to make room under MAX_QUEUE_SIZE. Tries, in order:
   * oldest completed/failed, then oldest queued by ascending priority
   * (low, then normal, then high - only as a last resort, since evicting a
   * high-priority request is worse than evicting a low one, but still
   * better than growing past the cap forever). Never evicts an
   * `in_progress` topic - it has a worker holding its id and will call
   * complete()/fail() on it; removing it here would silently discard that
   * result (see complete()/fail()'s "unknown/removed topic" warning).
   * A queue where every single slot is in_progress is the one case this
   * can't free - logged, since addTopic() still inserts past the cap then.
   */
  private evictOldest(): void {
    const completed = Array.from(this.topics.values())
      .filter((t) => t.status === 'completed' || t.status === 'failed')
      .sort((a, b) => a.created_at - b.created_at);

    if (completed.length > 0) {
      this.topics.delete(completed[0]!.id);
      return;
    }

    for (const priority of ['low', 'normal', 'high'] as const) {
      const candidates = Array.from(this.topics.values())
        .filter((t) => t.priority === priority && t.status === 'queued')
        .sort((a, b) => a.created_at - b.created_at);
      if (candidates.length > 0) {
        this.topics.delete(candidates[0]!.id);
        return;
      }
    }

    console.warn('[ResearchQueue] Could not evict any topic to enforce MAX_QUEUE_SIZE - every slot is in_progress');
  }
}
