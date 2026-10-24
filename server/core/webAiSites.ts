import type { Store } from "./store.ts";

// Web AI site profiles and settings (spec §10, Phase 6). A profile says where a
// chat page's prompt box, send button and answer live. The bundled selectors
// are 【仮定】: they were written from memory of each site's DOM and have NOT
// been checked against the live sites, which change often. They only matter at
// Level 2/3 (Level 1 never touches a page), and the user can override any of
// them per service without a code change.

export type SiteProfile = {
  /** Prompt box (textarea or contenteditable). */
  inputSelector: string;
  /** Send button; when absent or not found, Enter is pressed instead. */
  sendSelector?: string;
  /** One element per assistant answer; the last one is read. */
  responseSelector: string;
  /** Present while the AI is still writing (a "stop" button). */
  stopSelector?: string;
};

export const BUNDLED_SITE_PROFILES: Record<string, SiteProfile> = {
  chatgpt: {
    inputSelector: "#prompt-textarea",
    sendSelector: 'button[data-testid="send-button"]',
    responseSelector: '[data-message-author-role="assistant"]',
    stopSelector: 'button[data-testid="stop-button"]',
  },
  gemini: {
    inputSelector: 'rich-textarea .ql-editor, div[contenteditable="true"]',
    sendSelector: 'button[aria-label*="送信"], button[aria-label*="Send"]',
    responseSelector: "message-content, .model-response-text",
    stopSelector: 'button[aria-label*="停止"], button[aria-label*="Stop"]',
  },
  "claude-web": {
    inputSelector: 'div[contenteditable="true"]',
    sendSelector: 'button[aria-label*="Send"], button[aria-label*="送信"]',
    responseSelector: ".font-claude-response, .font-claude-message",
    stopSelector: 'button[aria-label*="Stop"], button[aria-label*="停止"]',
  },
  perplexity: {
    inputSelector: "textarea",
    sendSelector: 'button[aria-label="Submit"]',
    responseSelector: 'div[id^="markdown-content"]',
  },
  // 入力欄・送信ボタンは2026-10-24にログアウト状態の実画面で確認済み。回答欄(responseSelector)は未確認の仮定。
  huggingchat: {
    inputSelector: 'textarea[placeholder="Ask anything"]',
    // 送信ボタンは文字を入力するまで画面に出ないため指定しない(Enterで送る)
    responseSelector: '[data-message-role="assistant"], .prose',
  },
  "meta-ai": {
    inputSelector: 'input[type="text"][aria-label*="Meta AI"]',
    sendSelector: 'button[aria-label="送信"], button[aria-label="Send"]',
    responseSelector: '[data-testid*="message"], .markdown',
  },
  // 以下は画面に入れず(ログインが必要)、各サイトの画面構成の記憶から書いた未確認の仮定。
  copilot: {
    inputSelector: 'textarea#userInput, textarea[placeholder*="Copilot"]',
    sendSelector: 'button[data-testid="submit-button"], button[aria-label*="送信"], button[aria-label*="Submit"]',
    responseSelector: '[data-content="ai-message"], [data-testid="ai-message"]',
  },
  deepseek: {
    inputSelector: "textarea#chat-input, textarea",
    responseSelector: ".ds-markdown",
    stopSelector: 'div[role="button"][aria-label*="Stop"]',
  },
  grok: {
    inputSelector: 'textarea[aria-label*="Grok"], textarea',
    sendSelector: 'button[aria-label="Submit"], button[type="submit"]',
    responseSelector: ".message-bubble, .response-content-markdown",
  },
};

export type WebAiSettings = {
  /**
   * Master switch. Off (default): missions run exactly as before, on Claude Code
   * only. On: the Broker may pick a web AI, and the task then waits for the user
   * (Level 1) or drives their browser (Level 2/3).
   */
  enabled: boolean;
  /** Per-service selector overrides, merged over the bundled profile. */
  sites: Record<string, Partial<SiteProfile>>;
};

const SETTINGS_KEY = "web_ai";
const DEFAULT_SETTINGS: WebAiSettings = { enabled: false, sites: {} };

export function getWebAiSettings(store: Store): WebAiSettings {
  const raw = store.getSetting<Partial<WebAiSettings>>(SETTINGS_KEY, {});
  return { enabled: raw.enabled === true, sites: raw.sites && typeof raw.sites === "object" ? raw.sites : DEFAULT_SETTINGS.sites };
}

export function setWebAiSettings(store: Store, patch: Partial<WebAiSettings>): WebAiSettings {
  const next = { ...getWebAiSettings(store), ...patch };
  store.setSetting(SETTINGS_KEY, next);
  return next;
}

/** Bundled profile + the user's overrides; null when no usable profile exists (Level 2/3 impossible). */
export function resolveSiteProfile(store: Store, aiId: string): SiteProfile | null {
  const merged = { ...BUNDLED_SITE_PROFILES[aiId], ...getWebAiSettings(store).sites[aiId] };
  return merged.inputSelector && merged.responseSelector ? (merged as SiteProfile) : null;
}

// ---- what the automation must never get past (spec §11) ---------------------
const CAPTCHA_TEXT = /captcha|verify (that )?you are (a )?human|are you (a )?(robot|human)|unusual traffic|human verification|ロボットではありません|人間であることを確認|確認が必要です.*人間/i;
const LOGIN_TEXT = /\b(log ?in|sign ?in|sign up)\b|ログイン|サインイン|ログインして/i;
const LOGIN_PATH = /\/(log-?in|sign-?in|auth|accounts?\/login)(\/|$|\?)/i;

export type BlockReason = "captcha" | "login";

/** Looks at what a page shows when its prompt box could not be found. Never tries to get past either condition. */
export function classifyBlocker(page: { url: string; text: string; hasChallengeFrame: boolean }): BlockReason | null {
  if (page.hasChallengeFrame || CAPTCHA_TEXT.test(page.text)) return "captcha";
  let path = "";
  try {
    path = new URL(page.url).pathname + new URL(page.url).search;
  } catch {
    /* not a URL */
  }
  if (LOGIN_PATH.test(path) || LOGIN_TEXT.test(page.text.slice(0, 1500))) return "login";
  return null;
}

export const BLOCK_MESSAGES: Record<BlockReason, string> = {
  captcha: "ボット確認(CAPTCHA等)が表示されています。自動では突破しません。開いたブラウザで、ご自身で操作してください",
  login: "ログインが必要です。開いたブラウザで、ご自身で通常どおりログインしてください(パスワードは扱いません)",
};
