import type { FreeStatus } from "./schema.ts";
import type { Store } from "./store.ts";

// AI Registry (spec §6, Phase 4). The `ai_services` / `ai_capabilities` tables
// are the registry; this module fills in what the legacy import could not know
// (capabilities and scores of the web AIs) from a bundled, editable profile
// table. Scores are 【仮定】: a starting point for the Broker, not measurements.
// Seeding only fills services that have no capability scores yet, so anything
// the user (or a later check) has tuned is never overwritten.

export type AiProfile = {
  /** capability -> 0-5 fit */
  capabilities: Record<string, number>;
  qualityScore: number;
  reliabilityScore: number;
  automationLevel: 1 | 2 | 3;
  freeStatus: FreeStatus;
  freeLimit?: string;
  limitations?: string;
};

/** Keyed by the legacy ai_services.json id. */
export const DEFAULT_AI_PROFILES: Record<string, AiProfile> = {
  "claude-code": {
    capabilities: { coding: 5, debugging: 5, testing: 5, architecture: 5, documentation: 4, research: 3 },
    qualityScore: 5,
    reliabilityScore: 4,
    automationLevel: 3,
    freeStatus: "free_tier",
    freeLimit: "ユーザー自身のClaudeサブスクリプションの利用枠内(APIキー・従量課金なし)",
    limitations: "ログインが切れると実行できない。利用枠の上限あり",
  },
  "claude-web": {
    capabilities: { architecture: 5, documentation: 5, ux_review: 5, research: 4, coding: 4, translation: 4 },
    qualityScore: 5,
    reliabilityScore: 3,
    automationLevel: 1,
    freeStatus: "free_tier",
    limitations: "無料枠にメッセージ数の上限あり。手動コピー&ペースト運用",
  },
  chatgpt: {
    capabilities: { translation: 5, research: 4, documentation: 4, ux_review: 4, coding: 4, seo: 4, image_generation: 3 },
    qualityScore: 4,
    reliabilityScore: 3,
    automationLevel: 1,
    freeStatus: "free_tier",
    limitations: "無料枠に上限あり。UI変更が多い",
  },
  gemini: {
    capabilities: { research: 5, seo: 4, translation: 4, image_generation: 4, documentation: 4, ux_review: 3 },
    qualityScore: 4,
    reliabilityScore: 3,
    automationLevel: 1,
    freeStatus: "free_tier",
    limitations: "無料枠に上限あり",
  },
  perplexity: {
    capabilities: { research: 5, seo: 3 },
    qualityScore: 4,
    reliabilityScore: 3,
    automationLevel: 1,
    freeStatus: "free_tier",
    limitations: "無料枠の検索回数に上限あり",
  },
  copilot: {
    capabilities: { coding: 3, research: 3, image_generation: 3 },
    qualityScore: 3,
    reliabilityScore: 3,
    automationLevel: 1,
    freeStatus: "free",
  },
  deepseek: {
    capabilities: { coding: 4, architecture: 3, testing: 3, research: 3 },
    qualityScore: 3.5,
    reliabilityScore: 2.5,
    automationLevel: 1,
    freeStatus: "free_tier",
  },
  mistral: {
    capabilities: { coding: 3.5, translation: 4, documentation: 3, research: 3 },
    qualityScore: 3.5,
    reliabilityScore: 3,
    automationLevel: 1,
    freeStatus: "free_tier",
  },
  qwen: {
    capabilities: { coding: 4, translation: 4, research: 3, documentation: 3 },
    qualityScore: 3.5,
    reliabilityScore: 3,
    automationLevel: 1,
    freeStatus: "free_tier",
    limitations: "ログインが必要",
  },
  grok: {
    capabilities: { research: 4, coding: 3, seo: 3, image_generation: 3 },
    qualityScore: 3.5,
    reliabilityScore: 3,
    automationLevel: 1,
    freeStatus: "free_tier",
    limitations: "無料枠に上限あり",
  },
  poe: {
    capabilities: { research: 3, coding: 3, translation: 3, image_generation: 3 },
    qualityScore: 3,
    reliabilityScore: 3,
    automationLevel: 1,
    freeStatus: "free_tier",
    limitations: "無料枠のポイントに上限あり",
  },
  you: {
    capabilities: { research: 4, seo: 3, coding: 3 },
    qualityScore: 3.5,
    reliabilityScore: 3,
    automationLevel: 1,
    freeStatus: "free_tier",
    limitations: "無料枠に上限あり",
  },
  pi: {
    capabilities: { translation: 3, documentation: 3, ideation: 5 },
    qualityScore: 3,
    reliabilityScore: 3,
    automationLevel: 1,
    freeStatus: "free",
    limitations: "会話向きで、コード・長い成果物には不向き",
  },
  notebooklm: {
    capabilities: { research: 4.5, documentation: 4 },
    qualityScore: 4,
    reliabilityScore: 3,
    automationLevel: 1,
    freeStatus: "free_tier",
    limitations: "手元の資料を読み込ませて使う。資料がないと力を発揮しにくい",
  },
  "bolt-new": {
    capabilities: { coding: 4, architecture: 3, testing: 2.5 },
    qualityScore: 3.5,
    reliabilityScore: 3,
    automationLevel: 1,
    freeStatus: "free_tier",
    limitations: "Webアプリの生成向け。無料枠のトークンに上限あり",
  },
  genspark: {
    capabilities: { research: 4, documentation: 3.5, seo: 3.5 },
    qualityScore: 3.5,
    reliabilityScore: 3,
    automationLevel: 1,
    freeStatus: "free_tier",
    limitations: "無料枠に上限あり",
  },
  manus: {
    capabilities: { research: 4, coding: 3.5, documentation: 3.5 },
    qualityScore: 3.5,
    reliabilityScore: 2.5,
    automationLevel: 1,
    freeStatus: "free_tier",
    limitations: "招待・無料枠に制限があり、利用できない場合あり",
  },
  ideogram: {
    capabilities: { image_generation: 4.5 },
    qualityScore: 4.5,
    reliabilityScore: 3,
    automationLevel: 1,
    freeStatus: "free_tier",
    limitations: "無料枠の生成数に上限あり。文字入り画像が得意",
  },
  leonardo: {
    capabilities: { image_generation: 4.5 },
    qualityScore: 4.5,
    reliabilityScore: 3,
    automationLevel: 1,
    freeStatus: "free_tier",
    limitations: "無料枠のトークンに上限あり",
  },
  playground: {
    capabilities: { image_generation: 4 },
    qualityScore: 4,
    reliabilityScore: 3,
    automationLevel: 1,
    freeStatus: "free_tier",
    limitations: "無料枠に1日の上限あり",
  },
  craiyon: {
    capabilities: { image_generation: 2.5 },
    qualityScore: 2.5,
    reliabilityScore: 3,
    automationLevel: 1,
    freeStatus: "free",
    limitations: "画質は控えめ。広告あり",
  },
  recraft: {
    capabilities: { image_generation: 4.5 },
    qualityScore: 4.5,
    reliabilityScore: 3,
    automationLevel: 1,
    freeStatus: "free_tier",
    limitations: "無料枠の生成数に上限あり。ロゴ・ベクター向け",
  },
  runway: {
    capabilities: { video_generation: 5 },
    qualityScore: 4.5,
    reliabilityScore: 3,
    automationLevel: 1,
    freeStatus: "free_tier",
    limitations: "無料枠は少量のクレジットのみ",
  },
  pika: {
    capabilities: { video_generation: 4 },
    qualityScore: 4,
    reliabilityScore: 3,
    automationLevel: 1,
    freeStatus: "free_tier",
    limitations: "無料枠のクレジットに上限あり",
  },
  luma: {
    capabilities: { video_generation: 4.5 },
    qualityScore: 4.5,
    reliabilityScore: 3,
    automationLevel: 1,
    freeStatus: "free_tier",
    limitations: "無料枠の生成数に上限あり",
  },
  kling: {
    capabilities: { video_generation: 4.5 },
    qualityScore: 4.5,
    reliabilityScore: 3,
    automationLevel: 1,
    freeStatus: "free_tier",
    limitations: "無料枠のクレジットに上限あり。地域によっては待ち時間が長い",
  },
  "google-ai-studio": {
    capabilities: { coding: 4, research: 4, documentation: 4, image_generation: 3 },
    qualityScore: 4,
    reliabilityScore: 3,
    automationLevel: 1,
    freeStatus: "free_tier",
    limitations: "Googleアカウントでログイン。無料枠に利用上限あり。出力を手動でコピーして使う",
  },
  jules: {
    capabilities: { coding: 4, debugging: 4, testing: 3.5 },
    qualityScore: 4,
    reliabilityScore: 3,
    automationLevel: 1,
    freeStatus: "free_tier",
    limitations: "Googleアカウントでログイン。GitHubのリポジトリ連携が前提で、1日の利用回数に上限あり",
  },
  stitch: {
    capabilities: { ux_review: 4, design: 4 },
    qualityScore: 3.5,
    reliabilityScore: 3,
    automationLevel: 1,
    freeStatus: "free_tier",
    limitations: "Googleアカウントでログイン。画面デザインの試作向け。実験的な機能で変更が多い",
  },
  lovable: {
    capabilities: { coding: 3.5, ux_review: 3, architecture: 3 },
    qualityScore: 3.5,
    reliabilityScore: 3,
    automationLevel: 1,
    freeStatus: "free_tier",
    limitations: "Googleアカウントでもログインできる。無料枠は1日の利用量に上限あり",
  },
  "google-flow": {
    capabilities: { video_generation: 4.5 },
    qualityScore: 4.5,
    reliabilityScore: 3,
    automationLevel: 1,
    freeStatus: "free_tier",
    limitations: "利用できる国・プランに制限あり",
  },
  suno: {
    capabilities: { music_generation: 5 },
    qualityScore: 4.5,
    reliabilityScore: 3,
    automationLevel: 1,
    freeStatus: "free_tier",
    limitations: "無料枠は1日の曲数に上限あり。商用利用は有料プランが必要",
  },
  elevenlabs: {
    capabilities: { voice_generation: 5 },
    qualityScore: 4.5,
    reliabilityScore: 3,
    automationLevel: 1,
    freeStatus: "free_tier",
    limitations: "無料枠は文字数に上限あり。商用利用は有料プランが必要",
  },
};

/**
 * Applies DEFAULT_AI_PROFILES to services that are registered but unscored.
 * Returns the ids it classified. Never touches a service that already has
 * capability scores, nor one whose free_status the user has set away from unknown.
 */
export function seedRegistryProfiles(store: Store, profiles: Record<string, AiProfile> = DEFAULT_AI_PROFILES): string[] {
  const seeded: string[] = [];
  for (const [id, profile] of Object.entries(profiles)) {
    const service = store.getAiService(id);
    if (!service || Object.keys(service.capabilityScores).length > 0) continue;
    store.setCapabilities(id, profile.capabilities);
    store.patchAiService(id, {
      qualityScore: profile.qualityScore,
      reliabilityScore: profile.reliabilityScore,
      automationLevel: profile.automationLevel,
      freeStatus: service.freeStatus === "unknown" ? profile.freeStatus : service.freeStatus,
      freeLimit: profile.freeLimit ?? null,
      limitations: profile.limitations ?? null,
    });
    seeded.push(id);
  }
  if (seeded.length) {
    store.addDecision({
      title: "AI Registry: 既定プロファイルを適用",
      reason: `能力・品質・信頼性のスコアは実測ではなく初期値(仮定): ${seeded.join(", ")}。実運用の成否に合わせて調整する前提`,
      isAssumption: true,
    });
  }
  return seeded;
}


/**
 * One-time registry update (recorded in settings): adds the "ideation" capability (brainstorming, name ideas, wording ideas) to the
 * services that already have scores, keeping everything else. Pi is built for this kind of conversation; the other scores are
 * assumptions like all the initial ones. Returns the ids it changed.
 */
export const IDEATION_SCORES: Record<string, number> = { pi: 5, chatgpt: 4, "claude-web": 4, gemini: 3.5, qwen: 3, mistral: 3, genspark: 3 };
export function applyIdeationCapability(store: Store): string[] {
  const KEY = "registry.ideation.v1";
  if (store.getSetting<boolean>(KEY, false)) return [];
  const changed: string[] = [];
  for (const [id, score] of Object.entries(IDEATION_SCORES)) {
    const service = store.getAiService(id);
    if (!service || service.capabilityScores.ideation !== undefined) continue;
    store.setCapabilities(id, { ...service.capabilityScores, ideation: score });
    changed.push(id);
  }
  store.setSetting(KEY, true);
  if (changed.length) store.addDecision({ title: "AI Registry: 「アイデア出し(ideation)」の能力を追加", reason: `会話・アイデア出しに向くPiを中心に、初期値(仮定)の点数を追加: ${changed.join(", ")}`, isAssumption: true });
  return changed;
}

/** The browser AIs a fresh install starts with (the ones people use for free). Level 1 (manual) until the user raises it; the scores come from DEFAULT_AI_PROFILES. */
export const BUILT_IN_WEB_AIS: { id: string; name: string; url: string; freeStatus: "free" | "free_tier" }[] = [
  { id: "chatgpt", name: "ChatGPT (Web)", url: "https://chatgpt.com", freeStatus: "free_tier" },
  { id: "gemini", name: "Gemini (Web)", url: "https://gemini.google.com", freeStatus: "free_tier" },
  { id: "claude-web", name: "Claude (Web)", url: "https://claude.ai", freeStatus: "free_tier" },
  { id: "perplexity", name: "Perplexity (Web)", url: "https://www.perplexity.ai", freeStatus: "free_tier" },
  { id: "copilot", name: "Microsoft Copilot (Web)", url: "https://copilot.microsoft.com", freeStatus: "free" },
  { id: "deepseek", name: "DeepSeek (Web)", url: "https://chat.deepseek.com", freeStatus: "free_tier" },
  { id: "mistral", name: "Mistral Le Chat (Web)", url: "https://chat.mistral.ai", freeStatus: "free_tier" },
  { id: "qwen", name: "Qwen Chat (Web)", url: "https://chat.qwen.ai", freeStatus: "free_tier" },
  { id: "grok", name: "Grok (Web)", url: "https://grok.com", freeStatus: "free_tier" },
  { id: "poe", name: "Poe (Web)", url: "https://poe.com", freeStatus: "free_tier" },
  { id: "you", name: "You.com (Web)", url: "https://you.com", freeStatus: "free_tier" },
  { id: "pi", name: "Pi (Web)", url: "https://pi.ai", freeStatus: "free" },
  { id: "notebooklm", name: "NotebookLM (Web)", url: "https://notebooklm.google.com", freeStatus: "free_tier" },
  { id: "bolt-new", name: "Bolt.new (Web)", url: "https://bolt.new", freeStatus: "free_tier" },
  { id: "genspark", name: "Genspark (Web)", url: "https://www.genspark.ai", freeStatus: "free_tier" },
  { id: "manus", name: "Manus (Web)", url: "https://manus.im", freeStatus: "free_tier" },
  { id: "ideogram", name: "Ideogram（画像生成）", url: "https://ideogram.ai", freeStatus: "free_tier" },
  { id: "leonardo", name: "Leonardo.Ai（画像生成）", url: "https://leonardo.ai", freeStatus: "free_tier" },
  { id: "playground", name: "Playground（画像生成）", url: "https://playground.com", freeStatus: "free_tier" },
  { id: "craiyon", name: "Craiyon（画像生成）", url: "https://www.craiyon.com", freeStatus: "free" },
  { id: "recraft", name: "Recraft（画像生成）", url: "https://www.recraft.ai", freeStatus: "free_tier" },
  { id: "runway", name: "Runway（動画生成）", url: "https://runwayml.com", freeStatus: "free_tier" },
  { id: "pika", name: "Pika（動画生成）", url: "https://pika.art", freeStatus: "free_tier" },
  { id: "luma", name: "Luma Dream Machine（動画生成）", url: "https://lumalabs.ai/dream-machine", freeStatus: "free_tier" },
  { id: "kling", name: "Kling AI（動画生成）", url: "https://klingai.com", freeStatus: "free_tier" },
  { id: "google-flow", name: "Google Flow / Veo（動画生成）", url: "https://labs.google/flow", freeStatus: "free_tier" },
  { id: "suno", name: "Suno（音楽生成）", url: "https://suno.com", freeStatus: "free_tier" },
  { id: "elevenlabs", name: "ElevenLabs（音声生成）", url: "https://elevenlabs.io", freeStatus: "free_tier" },
];

/** Claude Code is the main AI: a fresh install must list it, or coding tasks have no AI on record (and no score to learn from). */
export function ensureClaudeCode(store: Store): boolean {
  if (store.getAiService("claude-code")) return false;
  store.upsertAiService({ id: "claude-code", name: "Claude Code (CLI)", accessMode: "cli", adapterType: "claude-code", automationLevel: 3, freeStatus: "free_tier", requiresLogin: true });
  return true;
}

/** One-time: registers BUILT_IN_WEB_AIS that are missing, so an installed app (which has no imported config/) is not left with four AIs. Returns the ids it added. */
export function seedBuiltInWebAis(store: Store): string[] {
  const KEY = "registry.builtInWebAis.v1";
  if (store.getSetting<boolean>(KEY, false)) return [];
  const added: string[] = [];
  for (const ai of BUILT_IN_WEB_AIS) {
    if (store.getAiService(ai.id)) continue;
    store.upsertAiService({ ...ai, accessMode: "web", automationLevel: 1, requiresLogin: true, adapterType: "manual" });
    added.push(ai.id);
  }
  store.setSetting(KEY, true);
  return added;
}

/** Services dropped because they cannot be signed in to with a Google account (GitHub-only, Microsoft-account-only, Meta account). */
export const RETIRED_AI_IDS = ["meta-ai", "github-copilot", "ms-designer"];

/** Services added because they can be signed in to with a Google account. Level 1 (manual copy & paste) until the user raises it. */
export const GOOGLE_LOGIN_AIS: { id: string; name: string; url: string; provider: string }[] = [
  { id: "google-ai-studio", name: "Google AI Studio (Web)", url: "https://aistudio.google.com", provider: "Google" },
  { id: "jules", name: "Jules (Google・コード作成)", url: "https://jules.google", provider: "Google" },
  { id: "stitch", name: "Stitch (Google・画面デザイン)", url: "https://stitch.withgoogle.com", provider: "Google" },
  { id: "lovable", name: "Lovable (Web)", url: "https://lovable.dev", provider: "Lovable" },
];

/**
 * One-time registry update (recorded in settings, so a service the user adds back later is left alone):
 * removes the services that cannot use a Google sign-in, adds the ones that can. Returns what it changed.
 */
export function applyGoogleLoginRegistry(store: Store): { removed: string[]; added: string[] } {
  const KEY = "registry.googleLoginUpdate.v1";
  const result = { removed: [] as string[], added: [] as string[] };
  if (store.getSetting<boolean>(KEY, false)) return result;
  for (const id of RETIRED_AI_IDS) if (store.deleteAiService(id)) result.removed.push(id);
  for (const ai of GOOGLE_LOGIN_AIS) {
    if (store.getAiService(ai.id)) continue;
    store.upsertAiService({ ...ai, accessMode: "web", automationLevel: 1, requiresLogin: true, adapterType: "manual" });
    result.added.push(ai.id);
  }
  store.setSetting(KEY, true);
  if (result.removed.length || result.added.length) {
    store.addDecision({
      title: "AI Registry: Googleアカウントでログインできる構成に整理",
      reason: `Googleでログインできないため削除: ${result.removed.join(", ") || "なし"} / Googleでログインできるため追加: ${result.added.join(", ") || "なし"}。ログイン方式は各社の公式案内の調べ(2026-10)に基づく。`,
      isAssumption: true,
    });
  }
  return result;
}

/** Later retirements, each applied once under its own key (Adobe Firefly: Adobe ID only; HuggingChat and Kimi: removed at the user's request). */
const LATER_RETIREMENTS: { key: string; ids: string[] }[] = [
  { key: "registry.retired.firefly.v1", ids: ["firefly"] },
  { key: "registry.retired.huggingchat-kimi.v1", ids: ["huggingchat", "kimi"] },
  { key: "registry.retired.midjourney-v0.v1", ids: ["midjourney", "v0"] },
];

export function applyLaterRetirements(store: Store): string[] {
  const removed: string[] = [];
  for (const { key, ids } of LATER_RETIREMENTS) {
    if (store.getSetting<boolean>(key, false)) continue;
    for (const id of ids) if (store.deleteAiService(id)) removed.push(id);
    store.setSetting(key, true);
  }
  return removed;
}
