export type Recommendation = { service: string; reason: string };

// A simple keyword heuristic, not real classification — it exists to give
// a sensible starting suggestion so the user doesn't have to pick an AI
// blind, not to be a smart judge of the idea. First matching rule wins.
const RULES: { keywords: string[]; service: string; reason: string }[] = [
  {
    keywords: ["最新", "ニュース", "調べ", "リサーチ", "検索", "比較", "トレンド", "出典"],
    service: "Perplexity (Web)",
    reason: "最新情報の検索や、出典付きでのリサーチが得意です。",
  },
  {
    keywords: ["画像", "イラスト", "ロゴ", "写真", "アイコン", "サムネ"],
    service: "Midjourney（画像生成）",
    reason: "画像・イラストの生成に特化しています。",
  },
  {
    keywords: ["動画", "ムービー", "映像", "アニメーション"],
    service: "Runway（動画生成）",
    reason: "動画生成に特化しています。",
  },
  {
    keywords: ["音楽", "作曲", "BGM", "曲"],
    service: "Suno（音楽生成）",
    reason: "音楽・楽曲の生成に特化しています。",
  },
  {
    keywords: ["ナレーション", "音声", "読み上げ", "声"],
    service: "ElevenLabs（音声生成）",
    reason: "自然な音声生成・読み上げが得意です。",
  },
  {
    keywords: ["スプレッドシート", "表計算", "データ分析", "グラフ", "集計"],
    service: "Gemini (Web)",
    reason: "Googleサービスとの連携やデータ整理が得意です。",
  },
  {
    keywords: ["資料", "長い", "要約", "PDF", "複数の文書", "レビューして"],
    service: "NotebookLM (Web)",
    reason: "複数の長い資料を読み込んでの要約・質問応答が得意です。",
  },
  {
    keywords: ["コード", "アプリ", "システム", "実装", "プログラム", "API", "開発", "ツール"],
    service: "Claude (Web)",
    reason: "技術的な要件整理や、後工程の設計・実装との相性が良いです。",
  },
];

const DEFAULT: Recommendation = {
  service: "ChatGPT (Web)",
  reason: "特定の分野に偏らない、汎用的な壁打ち相手としてまず試すのにおすすめです。",
};

export function recommend(text: string): Recommendation {
  const hit = RULES.find((r) => r.keywords.some((k) => text.includes(k)));
  return hit ?? DEFAULT;
}
