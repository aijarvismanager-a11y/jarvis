export type ImageRecommendation = { serviceId: string; reason: string };

// ai_services.json ids that are free-to-use image-generation tools (as
// opposed to general chat/video/music AIs) — shared by the recommender and
// the UI that filters the picker down to just these. Midjourney is
// deliberately excluded: it dropped its free trial and requires a paid
// plan before it will generate anything. Playground is excluded too — it
// pivoted away from AI art generation in late 2024 and gutted its free
// tier to 10 edits per 3-hour window.
export const IMAGE_SERVICE_IDS = ["ideogram", "leonardo", "firefly", "recraft", "ms-designer", "craiyon"];

// Short "good at" blurb per service, shown next to its name in the manual
// picker so a no-match choice isn't a blind guess between six look-alike
// names.
export const IMAGE_SERVICE_SPECIALTIES: Record<string, string> = {
  ideogram: "文字入り画像が得意",
  leonardo: "イラスト・キャラクター表現が得意",
  firefly: "商用利用の権利面が明確で安心",
  recraft: "ベクター・アイコン・ミニマルデザインが得意",
  "ms-designer": "DALL-E 3相当の高品質な汎用画像",
  craiyon: "サインアップ不要・無制限で気軽に量産",
};

// Keyword heuristic scoped to image-generation services only (a sibling to
// ideaRecommendation.ts's general-purpose version). First matching rule
// wins, so more specific rules are listed before broader ones. There is
// deliberately no catch-all fallback: a recommendation is only shown when
// the prompt's own wording actually points at a service's strength —
// otherwise the picker is left to the user rather than asserting a pick
// the prompt gave no reason for.
const RULES: { keywords: string[]; serviceId: string; reason: string }[] = [
  {
    keywords: ["文字入り", "テキスト入り", "文字が読める画像", "ロゴの文字", "タイポグラフィ"],
    serviceId: "ideogram",
    reason: "画像内に正確な文字を入れるのが得意です。",
  },
  {
    keywords: ["商用利用", "Adobe", "Photoshop", "権利関係がクリア", "ライセンス"],
    serviceId: "firefly",
    reason: "商用利用が明確に許諾された学習データを使っており、権利面で安心です。",
  },
  {
    keywords: ["フォトリアル", "実写", "人物", "ポートレート", "リアルな写真"],
    serviceId: "leonardo",
    reason: "写実的な人物・ポートレート表現に強みがあります。",
  },
  {
    keywords: ["イラスト", "アニメ調", "キャラクター", "ファンタジー", "背景美術", "アートスタイル"],
    serviceId: "leonardo",
    reason: "スタイル豊富なイラスト・キャラクター表現が得意で、無料枠も大きいです。",
  },
  {
    keywords: ["高品質", "クオリティ重視", "こだわりたい", "丁寧に仕上げ"],
    serviceId: "ms-designer",
    reason: "無料でDALL-E 3相当の高品質な仕上がりが得られます。",
  },
  {
    keywords: ["ラフ", "下書き", "プロトタイプ", "素早く", "たくさん試したい"],
    serviceId: "craiyon",
    reason: "サインアップ不要・無制限で、気軽にたくさん試すのに向いています。",
  },
  {
    keywords: ["ベクター", "SVG", "アイコン", "フラットデザイン", "ロゴマーク", "シンプル", "ミニマル"],
    serviceId: "recraft",
    reason: "ベクター・アイコン調のクリーンな画像生成が得意です。",
  },
];

export function recommendImageService(text: string): ImageRecommendation | null {
  const hit = RULES.find((r) => r.keywords.some((k) => text.includes(k)));
  return hit ? { serviceId: hit.serviceId, reason: hit.reason } : null;
}
