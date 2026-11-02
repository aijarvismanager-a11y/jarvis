import { looksLikeUsageLimit } from "./usageLimit.ts";
import type { Store } from "./store.ts";

// Web AI site profiles and settings (spec §10, Phase 6). A profile says where a
// chat page's prompt box, send button and answer live. The bundled selectors
// were 【仮定】 (written from memory). On 2026-10-25 chatgpt, gemini, claude-web, deepseek, poe, mistral and genspark
// were checked against the live sites (free accounts, logged in); the others are still unchecked or known not to work
// (see the notes per site). The sites change often: re-check when a Level 3 run fails. They only matter at
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
  /**
   * Things to do on the page before typing, by the exact visible text of a button:
   * - selectText: a mode button to switch on when it is shown as "not pressed" (aria-pressed="false"), e.g. a free "Search"
   *   mode where the page starts in a paid one
   * - dismissText: a button that closes a promotional pop-up ("Not now"); only ever a decline, never an accept
   * - escape: press Escape once to close a pop-up that has no button text to click
   */
  prepare?: { selectText?: string[]; dismissText?: string[]; escape?: boolean };
};

export const BUNDLED_SITE_PROFILES: Record<string, SiteProfile> = {
  // chatgpt: checked against the live site on 2026-10-25 (free plan, logged in): the prompt box is now a ProseMirror
  // editor and the answer carries data-dil-source-message-id instead of data-message-author-role.
  chatgpt: {
    inputSelector: '#prompt-textarea, div.ProseMirror[contenteditable="true"]',
    sendSelector: 'button[data-testid="send-button"], button[aria-label*="送信"], button[aria-label*="Send"]',
    responseSelector: '[data-message-author-role="assistant"], [data-dil-source-message-id]',
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
    // checked live on 2026-10-25: answers are wrapped in an element with data-perf-reply-text
    responseSelector: "[data-perf-reply-text], .font-claude-response, .font-claude-message",
    stopSelector: 'button[aria-label*="Stop"], button[aria-label*="停止"]',
  },
  // poe / mistral / genspark: checked live on 2026-10-25 (free accounts, logged in); the answer is read after the Enter key.
  poe: {
    inputSelector: "textarea",
    responseSelector: '[class*="Markdown_markdownContainer"]',
  },
  mistral: {
    inputSelector: 'div[contenteditable="true"], textarea',
    responseSelector: '[data-testid="text-message-part"][data-message-part-type="answer"]',
  },
  genspark: {
    inputSelector: "textarea",
    responseSelector: ".answer-markdown",
  },
  // qwen: checked live on 2026-10-26 (free account, logged in; a logged-out guest page asks for a birth year, which is the
  // person's to answer, so the page is then reported as a login problem). Answers are .response-message-content.phase-answer.
  qwen: {
    inputSelector: "textarea.message-input-textarea, textarea",
    sendSelector: 'button[aria-label="Send"]',
    responseSelector: ".response-message-content.phase-answer",
  },
  // pi: checked live on 2026-10-25 (free account, logged in). A "Group chats" pop-up covers the page: "Not now" closes it.
  // Pi's own messages are the [data-chat-message] boxes with a flex-col layout (the user's carry justify-end); the narrower
  // content column leaves out the "Copy / Read aloud" buttons.
  pi: {
    prepare: { dismissText: ["Not now"] },
    inputSelector: "textarea",
    sendSelector: 'button[data-testid="chat-composer-submit"], button[aria-label="Submit text"]',
    responseSelector: "[data-chat-message].flex-col .min-w-0.flex-1",
  },
  // perplexity: checked live on 2026-10-25 (free account, logged in). It starts in the paid "コンピューター" mode, whose answer to a
  // prompt is an upgrade pop-up, so the free "検索" mode is switched on first; answers carry data-renderer="lm".
  perplexity: {
    // the page starts in the paid "コンピューター" mode, which answers a prompt with an upgrade pop-up: switch to the free "検索" mode
    prepare: { selectText: ["検索", "Search"] },
    inputSelector: "#ask-input, div[role=\"textbox\"][contenteditable=\"true\"], textarea",
    sendSelector: 'button[aria-label="Submit"], button[aria-label="送信"], button[aria-label*="Send"]',
    responseSelector: 'div[data-renderer="lm"], div[id^="markdown-content"]',
  },
  // 以下は画面に入れず(ログインが必要)、各サイトの画面構成の記憶から書いた未確認の仮定。
  copilot: {
    // input, send button and answer checked live on 2026-10-27 (logged in, after the person passed the
    // "I am not a robot" check themselves; the check is never bypassed by the app)
    inputSelector: '#m365-chat-editor-target-element, [aria-label*="Copilot にメッセージ"], textarea#userInput, textarea[placeholder*="Copilot"]',
    sendSelector: 'button[aria-label="送信"], button[data-testid="submit-button"], button[aria-label*="Submit"]',
    responseSelector: '[data-testid="markdown-reply"], [data-testid="copilot-message-div"]',
  },
  deepseek: {
    inputSelector: "textarea#chat-input, textarea",
    responseSelector: ".ds-markdown",
    stopSelector: 'div[role="button"][aria-label*="Stop"]',
  },
  grok: {
    // checked live on 2026-10-27 (free account, logged in): the prompt box is a contenteditable div, not a textarea
    inputSelector: 'div[aria-label*="Grok"][contenteditable="true"], div.tiptap[contenteditable="true"], div[contenteditable="true"], textarea[aria-label*="Grok"]',
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
  /** Services the user says they are already signed in to (self-reported: the app cannot see inside the browser). */
  loggedIn: Record<string, boolean>;
};

const SETTINGS_KEY = "web_ai";
const DEFAULT_SETTINGS: WebAiSettings = { enabled: false, sites: {}, loggedIn: {} };

export function getWebAiSettings(store: Store): WebAiSettings {
  const raw = store.getSetting<Partial<WebAiSettings>>(SETTINGS_KEY, {});
  return { enabled: raw.enabled === true, sites: raw.sites && typeof raw.sites === "object" ? raw.sites : DEFAULT_SETTINGS.sites, loggedIn: raw.loggedIn && typeof raw.loggedIn === "object" ? raw.loggedIn : DEFAULT_SETTINGS.loggedIn };
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
const CAPTCHA_TEXT = /captcha|verify (that )?you are (a )?human|are you (a )?(robot|human)|unusual traffic|human verification|ロボットではありません|人間であることを確認|セキュリティ ?チェック|security check|確認が必要です.*人間/i;
const LOGIN_TEXT = /\b(log ?in|sign ?in|sign up)\b|ログイン|サインイン|ログインして/i;
const LOGIN_PATH = /\/(log-?in|sign-?in|auth|accounts?\/login)(\/|$|\?)/i;

export type BlockReason = "captcha" | "login" | "limit";

/** Looks at what a page shows when its prompt box could not be found. Never tries to get past either condition. */
export function classifyBlocker(page: { url: string; text: string; hasChallengeFrame: boolean; dialogText?: string }): BlockReason | null {
  if (page.hasChallengeFrame || CAPTCHA_TEXT.test(page.text)) return "captcha";
  // a notice on screen (a dialog) that says the site's allowance is used up: an answer will not come, so nothing is waited for
  if (page.dialogText && looksLikeUsageLimit(page.dialogText)) return "limit";
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
  limit: "このAIの利用上限に達したと表示されています。時間がたつまで、ほかのAIに回します",
  login: "ログインが必要です。開いたブラウザで、ご自身で通常どおりログインしてください(パスワードは扱いません)",
};
