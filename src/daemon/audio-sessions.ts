/**
 * Audio session buffer for the ambient pebble.
 *
 * Sidecar streams PCM s16 mono 16 kHz audio to the daemon via two events:
 *   - `audio.session_start` — opens a session keyed by session_id
 *   - `audio.session_end` — carries the full PCM as inline base64 binary
 *
 * Once T22 is in place, T23 plugs STT into onSessionEnd to turn the buffer
 * into a transcript and feed it as the real user message to the LLM.
 */

import type { SidecarEvent } from '../sidecar/protocol.ts';

export interface AudioSession {
  sidecarId: string;
  sessionId: string;
  startedAt: number;
  sampleRate: number;
  channels: number;
  format: string; // "pcm_s16le"
}

export interface CompletedAudioSession extends AudioSession {
  endedAt: number;
  durationMs: number;
  pcm: Buffer;
}

/** Sessions older than this are swept on the next session_start - a sidecar that drops mid-session (crash/network loss) never sends session_end, so nothing else ever clears its entry. */
const STALE_SESSION_MAX_AGE_MS = 10 * 60_000;
/** How long a completed session's key is remembered, to detect a duplicate/retried session_end for the same session and avoid firing listeners (and downstream STT) twice for one utterance. */
const RECENTLY_ENDED_TTL_MS = 30_000;

export class AudioSessionRegistry {
  private active = new Map<string, AudioSession>();
  private recentlyEnded = new Map<string, number>(); // key -> endedAt
  private onCompleteListeners = new Set<(session: CompletedAudioSession) => void>();

  /**
   * Hook the registry into the sidecar manager's event stream.
   * `sidecarManager.onEvent` itself has no unsubscribe mechanism, so this
   * can't return a disposer either - there is currently no way to detach.
   */
  attach(onEvent: (cb: (sidecarId: string, event: SidecarEvent) => void) => void): void {
    onEvent((sidecarId, event) => {
      if (event.event_type === 'audio.session_start') {
        const sessionId = String((event.payload as Record<string, unknown>)?.session_id ?? '');
        if (!sessionId) return;
        const rawSampleRate = Number((event.payload as Record<string, unknown>)?.sample_rate ?? 16000);
        const rawChannels = Number((event.payload as Record<string, unknown>)?.channels ?? 1);
        const sampleRate = Number.isFinite(rawSampleRate) ? rawSampleRate : 16000;
        const channels = Number.isFinite(rawChannels) ? rawChannels : 1;
        const format = String((event.payload as Record<string, unknown>)?.format ?? 'pcm_s16le');
        const key = this.key(sidecarId, sessionId);
        if (this.active.has(key)) {
          console.warn(`[audio-sessions] session_start for an already-active session (${key}) - overwriting`);
        }
        this.active.set(key, {
          sidecarId,
          sessionId,
          startedAt: Date.now(),
          sampleRate,
          channels,
          format,
        });
        this.sweepStale();
        return;
      }

      if (event.event_type === 'audio.session_end') {
        const payload = event.payload as Record<string, unknown> | undefined;
        const sessionId = String(payload?.session_id ?? '');
        if (!sessionId) return;
        const key = this.key(sidecarId, sessionId);

        // A duplicate/retried session_end for a key already completed within
        // the TTL must not fire the completion listeners a second time - the
        // downstream STT/LLM pipeline would otherwise process the same
        // utterance twice.
        const priorEnd = this.recentlyEnded.get(key);
        if (priorEnd !== undefined && Date.now() - priorEnd < RECENTLY_ENDED_TTL_MS) {
          console.warn(`[audio-sessions] duplicate session_end for ${key} - ignoring`);
          return;
        }

        const session = this.active.get(key);
        this.active.delete(key);
        this.recentlyEnded.set(key, Date.now());
        this.sweepRecentlyEnded();

        const binary = event.binary as { type?: string; data?: string; mime_type?: string } | undefined;
        let pcm = Buffer.alloc(0);
        if (binary && binary.type === 'inline' && typeof binary.data === 'string') {
          // Buffer.from(..., 'base64') does not throw on malformed input -
          // it silently produces a truncated/garbage buffer instead - so
          // validate the format first rather than relying on a try/catch
          // that would rarely actually trigger.
          if (/^[A-Za-z0-9+/]*={0,2}$/.test(binary.data) && binary.data.length % 4 === 0) {
            pcm = Buffer.from(binary.data, 'base64');
          } else {
            console.warn('[audio-sessions] inline PCM is not valid base64 - discarding');
          }
        } else {
          // No inline PCM. Large captures are normalized to inline upstream
          // (sidecar connection layer), so reaching here means an empty /
          // zero-length capture — fall through so the completion path still
          // resets state.
          console.warn('[audio-sessions] session_end without inline PCM (empty capture)');
        }

        const durationMs = Number(payload?.duration_ms ?? 0);
        const fallbackSampleRate = Number(payload?.sample_rate ?? 16000);
        const fallbackChannels = Number(payload?.channels ?? 1);
        const completed: CompletedAudioSession = {
          sidecarId,
          sessionId,
          startedAt: session?.startedAt ?? Date.now() - durationMs,
          endedAt: Date.now(),
          durationMs: Number.isFinite(durationMs) ? durationMs : 0,
          sampleRate: session?.sampleRate ?? (Number.isFinite(fallbackSampleRate) ? fallbackSampleRate : 16000),
          channels: session?.channels ?? (Number.isFinite(fallbackChannels) ? fallbackChannels : 1),
          format: session?.format ?? String(payload?.format ?? 'pcm_s16le'),
          pcm,
        };

        for (const listener of this.onCompleteListeners) {
          try {
            listener(completed);
          } catch (err) {
            console.warn('[audio-sessions] listener error:', err);
          }
        }
      }
    });
  }

  /** Register a listener for completed sessions (PCM ready for STT). */
  onComplete(listener: (session: CompletedAudioSession) => void): () => void {
    this.onCompleteListeners.add(listener);
    return () => this.onCompleteListeners.delete(listener);
  }

  private key(sidecarId: string, sessionId: string): string {
    return `${sidecarId}::${sessionId}`;
  }

  /** Evict sessions that opened but never got a matching session_end (sidecar disconnect mid-session). Called on every new session_start rather than on a timer, to avoid an extra always-on interval for a low-frequency event. */
  private sweepStale(): void {
    const cutoff = Date.now() - STALE_SESSION_MAX_AGE_MS;
    for (const [key, session] of this.active) {
      if (session.startedAt < cutoff) this.active.delete(key);
    }
  }

  private sweepRecentlyEnded(): void {
    const cutoff = Date.now() - RECENTLY_ENDED_TTL_MS;
    for (const [key, endedAt] of this.recentlyEnded) {
      if (endedAt < cutoff) this.recentlyEnded.delete(key);
    }
  }
}
