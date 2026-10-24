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
  "meta-ai": {
    capabilities: { research: 4, translation: 4, documentation: 3, image_generation: 3, coding: 3 },
    qualityScore: 3.5,
    reliabilityScore: 3,
    automationLevel: 1,
    freeStatus: "free",
    limitations: "地域・アカウントにより使えない場合あり",
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
  huggingchat: {
    capabilities: { coding: 3, research: 3, documentation: 3 },
    qualityScore: 3,
    reliabilityScore: 2.5,
    automationLevel: 1,
    freeStatus: "free",
    limitations: "モデルや混雑により応答が不安定",
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
    capabilities: { translation: 3, documentation: 3 },
    qualityScore: 3,
    reliabilityScore: 3,
    automationLevel: 1,
    freeStatus: "free",
    limitations: "会話向きで、コード・長い成果物には不向き",
  },
  kimi: {
    capabilities: { research: 3.5, documentation: 3.5, translation: 3.5, coding: 3 },
    qualityScore: 3.5,
    reliabilityScore: 3,
    automationLevel: 1,
    freeStatus: "free_tier",
    limitations: "ログインが必要",
  },
  notebooklm: {
    capabilities: { research: 4.5, documentation: 4 },
    qualityScore: 4,
    reliabilityScore: 3,
    automationLevel: 1,
    freeStatus: "free_tier",
    limitations: "手元の資料を読み込ませて使う。資料がないと力を発揮しにくい",
  },
  "github-copilot": {
    capabilities: { coding: 4, debugging: 4, testing: 3.5, documentation: 3 },
    qualityScore: 4,
    reliabilityScore: 3.5,
    automationLevel: 1,
    freeStatus: "free_tier",
    limitations: "無料枠の利用回数に上限あり。GitHubログインが必要",
  },
  v0: {
    capabilities: { coding: 4, ux_review: 4, architecture: 3 },
    qualityScore: 4,
    reliabilityScore: 3,
    automationLevel: 1,
    freeStatus: "free_tier",
    limitations: "主にWeb画面(React/Tailwind)の生成向け。無料枠に上限あり",
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
  midjourney: {
    capabilities: { image_generation: 5 },
    qualityScore: 5,
    reliabilityScore: 3,
    automationLevel: 1,
    freeStatus: "paid",
    limitations: "無料枠なし(有料)。無料のみの運用では選ばれない",
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
  firefly: {
    capabilities: { image_generation: 4 },
    qualityScore: 4,
    reliabilityScore: 3,
    automationLevel: 1,
    freeStatus: "free_tier",
    limitations: "無料枠のクレジットに上限あり",
  },
  playground: {
    capabilities: { image_generation: 4 },
    qualityScore: 4,
    reliabilityScore: 3,
    automationLevel: 1,
    freeStatus: "free_tier",
    limitations: "無料枠に1日の上限あり",
  },
  "ms-designer": {
    capabilities: { image_generation: 4, ux_review: 2.5 },
    qualityScore: 3.5,
    reliabilityScore: 3,
    automationLevel: 1,
    freeStatus: "free",
    limitations: "Microsoftアカウントが必要",
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
