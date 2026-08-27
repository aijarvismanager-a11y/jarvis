export type TaskCategory = {
  id: string;
  label: string;
  recommendedAi: string;
  reason: string;
  role: string;
  promptTemplate: string;
  inputHint: string;
  outputHint: string;
};

// A starting point for "which AI should do this?" — not a hard rule, just
// a sensible default the user can override. Ordered as a rough pipeline:
// idea -> requirements -> review -> implementation -> QA.
export const TASK_CATEGORIES: TaskCategory[] = [
  {
    id: "idea",
    label: "アイデア出し・壁打ち",
    recommendedAi: "ChatGPT / Gemini / Claude (Web)",
    reason: "まだ形になっていない段階の発散的な会話は、汎用の対話AIとの壁打ちが向いています。",
    role: "Ideator（アイデア出し）",
    promptTemplate:
      "作りたいものについて、目的・想定ユーザー・欲しい機能を箇条書きで洗い出したいです。壁打ち相手になって、良い点も気になる点も遠慮なく指摘しながら一緒に整理してください。",
    inputHint: "",
    outputHint: "workspace/docs/ideas.md",
  },
  {
    id: "requirements",
    label: "要件定義・設計",
    recommendedAi: "ChatGPT / Gemini (Web)",
    reason: "洗い出したアイデアを構造化された文章（要件定義書・ディレクトリ構成）にまとめるのが得意です。",
    role: "Architect（設計）",
    promptTemplate: "前提条件と要望を元に、要件定義書とディレクトリ構造をMarkdownで出力してください。",
    inputHint: "workspace/docs/ideas.md",
    outputHint: "workspace/docs/requirements.md",
  },
  {
    id: "review",
    label: "設計レビュー",
    recommendedAi: "Claude (Web)",
    reason: "長めの文書を通して読み、矛盾点や漏れを批判的にチェックするのに向いています。",
    role: "Reviewer（設計レビュー）",
    promptTemplate:
      "設計書をレビューし、懸念点・不足要件・改善案を箇条書きで出力してください。実装難易度の高い箇所には理由も添えてください。",
    inputHint: "workspace/docs/requirements.md",
    outputHint: "workspace/docs/design_review.md",
  },
  {
    id: "coding",
    label: "実装",
    recommendedAi: "Claude Code (CLI)",
    reason: "ローカルのファイルを直接読み書きしながら、実際のコードを書き進められます。",
    role: "Lead Developer（実装）",
    promptTemplate: "提供された設計書とレビュー内容を元に、実際のソースコードを実装・修正してください。",
    inputHint: "workspace/docs/design_review.md",
    outputHint: "workspace/src/*",
  },
  {
    id: "qa",
    label: "テスト・QA",
    recommendedAi: "Claude Code (CLI)",
    reason: "実装済みのコードに対して、テスト実行から修正までを一貫して行えます。",
    role: "QA（テスト・修正）",
    promptTemplate: "実装されたコードに対してテストを実行し、不具合があれば修正してください。",
    inputHint: "workspace/src/*",
    outputHint: "workspace/logs/test-result.log",
  },
  {
    id: "custom",
    label: "その他（自分で入力）",
    recommendedAi: "",
    reason: "",
    role: "",
    promptTemplate: "",
    inputHint: "",
    outputHint: "",
  },
];
