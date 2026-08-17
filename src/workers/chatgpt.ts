/**
 * ChatGPTWorker - runs a task through chatgpt.com in the user's own
 * browser session (spec section 2, 13: no official CLI/API for ChatGPT,
 * and the spec explicitly forbids unauthorized scraping / ToS-violating
 * automation). This drives the same Chrome instance + accessibility-tree
 * snapshot the daemon's browser_navigate/click/type tools already use
 * (src/actions/browser/session.ts) - ordinary UI automation, the same
 * actions a sighted user performs by hand, against a profile the user
 * logs into themselves. JARVIS never sees or handles the login
 * credentials.
 */

import type { Worker, WorkerDefinition, WorkerRunRequest, WorkerRunResult } from './types.ts';

export type PageElement = { id: number; tag: string; text: string; attrs: Record<string, string> };
export type PageSnapshot = { title: string; url: string; text: string; elements: PageElement[] };

/** The subset of BrowserController this Worker needs - kept minimal and injectable for tests. */
export interface BrowserDriver {
  navigate(url: string): Promise<PageSnapshot>;
  snapshot(): Promise<PageSnapshot>;
  type(elementId: number, text: string, submit?: boolean, append?: boolean): Promise<string>;
}

export type ChatGPTWorkerOptions = {
  workspace: string;
  driver?: BrowserDriver;
  timeout_ms?: number;
  retry?: number;
  enabled?: boolean;
  /** How often to re-snapshot while waiting for a response to finish. Default 1500ms. */
  pollIntervalMs?: number;
};

const CHATGPT_URL = 'https://chatgpt.com/';

function findComposer(snap: PageSnapshot): PageElement | undefined {
  return (
    snap.elements.find((e) => e.attrs.id === 'prompt-textarea') ??
    snap.elements.find((e) => e.attrs.contenteditable === 'true') ??
    snap.elements.find((e) => e.attrs.role === 'textbox')
  );
}

/** Best-effort: the reply is whatever appeared after the user's own prompt text on the page. */
function extractReply(pageText: string, prompt: string): string {
  const idx = pageText.lastIndexOf(prompt);
  if (idx === -1) return pageText.trim();
  return pageText.slice(idx + prompt.length).trim();
}

export class ChatGPTWorker implements Worker {
  readonly definition: WorkerDefinition;
  private readonly driver: BrowserDriver;
  private readonly pollIntervalMs: number;

  constructor(opts: ChatGPTWorkerOptions) {
    this.pollIntervalMs = opts.pollIntervalMs ?? 1500;
    this.driver = opts.driver ?? createDefaultDriver();
    this.definition = {
      name: 'chatgpt',
      type: 'chatgpt',
      status: 'ready',
      capabilities: ['research', 'write', 'general'],
      input_method: 'browser',
      output_method: 'browser',
      workspace: opts.workspace,
      timeout_ms: opts.timeout_ms ?? 5 * 60 * 1000,
      retry: opts.retry ?? 0,
      enabled: opts.enabled ?? true,
    };
  }

  async run(request: WorkerRunRequest): Promise<WorkerRunResult> {
    if (!this.definition.enabled) {
      return { status: 'failed', summary: 'worker disabled', output: '', files: [], error: 'disabled' };
    }

    try {
      const opened = await this.driver.navigate(CHATGPT_URL);
      let composer = findComposer(opened);
      if (!composer) {
        // First load can lag behind the snapshot (client-side render) - one retry.
        await sleep(this.pollIntervalMs);
        composer = findComposer(await this.driver.snapshot());
      }
      if (!composer) {
        return {
          status: 'failed',
          summary: 'Could not find the ChatGPT message box',
          output: '',
          files: [],
          error: 'No composer element found - is the browser logged into chatgpt.com?',
        };
      }

      await this.driver.type(composer.id, request.prompt, true, false);

      const reply = await this.waitForReply(request.prompt);
      if (reply === null) {
        return {
          status: 'completed',
          summary: 'Sent, but the reply had not finished streaming when this Worker stopped waiting',
          output: '',
          files: [],
        };
      }

      return {
        status: 'completed',
        summary: reply.split('\n').find((l) => l.trim().length > 0)?.slice(0, 200) ?? 'done',
        output: reply,
        files: [],
      };
    } catch (err) {
      return {
        status: 'failed',
        summary: 'chatgpt worker threw',
        output: '',
        files: [],
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /** Poll the page until its text stops changing (reply finished streaming) or the timeout elapses. */
  private async waitForReply(prompt: string): Promise<string | null> {
    const deadline = Date.now() + this.definition.timeout_ms;
    let lastText: string | null = null;
    let stableStreak = 0;

    while (Date.now() < deadline) {
      await sleep(this.pollIntervalMs);
      const snap = await this.driver.snapshot();
      if (snap.text === lastText) {
        stableStreak++;
        if (stableStreak >= 2) return extractReply(snap.text, prompt);
      } else {
        stableStreak = 0;
      }
      lastText = snap.text;
    }
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createDefaultDriver(): BrowserDriver {
  // Lazily constructed so importing this module never pulls in Chrome
  // launch machinery unless a ChatGPTWorker is actually enabled and run.
  let controller: BrowserDriver | null = null;
  return {
    async navigate(url) {
      if (!controller) {
        const { BrowserController } = await import('../actions/browser/session.ts');
        controller = new BrowserController();
      }
      return controller.navigate(url);
    },
    async snapshot() {
      if (!controller) throw new Error('navigate() must be called before snapshot()');
      return controller.snapshot();
    },
    async type(elementId, text, submit, append) {
      if (!controller) throw new Error('navigate() must be called before type()');
      return controller.type(elementId, text, submit, append);
    },
  };
}
