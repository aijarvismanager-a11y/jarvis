export type Recommendation = { service: string; reason: string };

// A simple keyword heuristic, not real classification — it exists to give
// a sensible starting suggestion so the user doesn't have to pick an AI
// blind, not to be a smart judge of the idea. First matching rule wins,
// so more specific rules are listed before broader ones they could
// otherwise be shadowed by (e.g. "文字入り画像" before the general
// "画像" rule, since both mention images).
const RULES: { keywords: string[]; service: string; reason: string }[] = [
  {
    keywords: ["文字入り", "テキスト入り", "文字が読める画像", "ロゴの文字"],
    service: "Ideogram（画像生成）",
    reason: "画像内に正確な文字を入れるのが得意です。",
  },
  {
    keywords: ["商用利用", "Adobe", "Photoshop", "権利関係がクリア"],
    service: "Adobe Firefly（画像生成）",
    reason: "商用利用が明確に許諾された学習データを使っており、権利面で安心です。",
  },
  {
    keywords: ["UIを作りたい", "コンポーネント", "React", "画面のデザインをコードに", "フロントエンドの見た目"],
    service: "v0 by Vercel (Web)",
    reason: "UIのデザインをそのまま動くコードに変換するのが得意です。",
  },
  {
    keywords: ["GitHub", "リポジトリ", "プルリクエスト", "PRを"],
    service: "GitHub Copilot Chat (Web)",
    reason: "GitHub上のコード・PRとの連携作業に向いています。",
  },
  {
    keywords: ["X（旧Twitter）", "Twitterの投稿", "SNSの反応", "リアルタイムの話題"],
    service: "Grok (Web)",
    reason: "X（旧Twitter）のリアルタイムな話題把握に強みがあります。",
  },
  {
    keywords: ["雑談", "悩み相談", "話を聞いて", "愚痴"],
    service: "Pi (Web)",
    reason: "共感的な対話・雑談相手として設計されています。",
  },
  {
    keywords: ["自動化したい", "エージェントに", "代行してほしい", "自動でやって"],
    service: "Manus (Web)",
    reason: "複数手順のタスクを自律的に代行するエージェント型AIです。",
  },
  {
    keywords: ["オープンソースのAI", "オープンモデル"],
    service: "HuggingChat (Web)",
    reason: "オープンソースのモデルを無料で試せます。",
  },
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
    keywords: [
      "コード",
      "アプリ",
      "システム",
      "実装",
      "プログラム",
      "API",
      "開発",
      "ツール",
      "サイト",
      "ホームページ",
      "Webサイト",
      "ウェブサイト",
      "サービス",
    ],
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
