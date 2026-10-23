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
