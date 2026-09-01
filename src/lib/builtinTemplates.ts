import type { WorkflowTemplate } from "./workflowTemplate";
import { WORKFLOW_TEMPLATE_FORMAT } from "./workflowTemplate";

export type BuiltinTemplate = {
  id: string;
  label: string;
  description: string;
  template: WorkflowTemplate;
};

// One-click starting points for common jobs, so "新しいプロジェクト" doesn't
// always mean building the step list by hand from scratch. Each is just an
// ordinary WorkflowTemplate (same shape as an exported/imported one) with a
// label and one-line description for the picker.
export const BUILTIN_TEMPLATES: BuiltinTemplate[] = [
  {
    id: "app-dev",
    label: "アプリ開発",
    description: "アイデア出し→設計→レビュー→実装→QAの5工程。",
    template: {
      format: WORKFLOW_TEMPLATE_FORMAT,
      version: 1,
      name: "アプリ開発",
      steps: [
        {
          role: "Ideator（アイデア出し）",
          ai_name: "ChatGPT (Web)",
          prompt_template:
            "作りたいものについて、目的・想定ユーザー・欲しい機能を箇条書きで洗い出したいです。壁打ち相手になって、良い点も気になる点も遠慮なく指摘しながら一緒に整理してください。",
          command_template: null,
          input_files: [],
          output_files: ["docs/ideas.md"],
        },
        {
          role: "Architect（設計）",
          ai_name: "ChatGPT (Web)",
          prompt_template: "前提条件と要望を元に、要件定義書とディレクトリ構造をMarkdownで出力してください。",
          command_template: null,
          input_files: ["docs/ideas.md"],
          output_files: ["docs/requirements.md"],
        },
        {
          role: "Reviewer（設計レビュー）",
          ai_name: "Claude (Web)",
          prompt_template:
            "設計書をレビューし、懸念点・不足要件・改善案を箇条書きで出力してください。実装難易度の高い箇所には理由も添えてください。",
          command_template: null,
          input_files: ["docs/requirements.md"],
          output_files: ["docs/design_review.md"],
        },
        {
          role: "Lead Developer（実装）",
          ai_name: "Claude Code (CLI)",
          prompt_template: "提供された設計書とレビュー内容を元に、実際のソースコードを実装・修正してください。",
          command_template: null,
          input_files: ["docs/requirements.md", "docs/design_review.md"],
          output_files: ["src/*"],
        },
        {
          role: "QA（テスト・修正）",
          ai_name: "Claude Code (CLI)",
          prompt_template: "実装されたコードに対してテストを実行し、不具合があれば修正してください。",
          command_template: null,
          input_files: ["src/*"],
          output_files: ["logs/test-result.log"],
        },
      ],
    },
  },
  {
    id: "writing",
    label: "記事執筆",
    description: "アイデア出し→構成案→執筆→校正→仕上げの5工程。",
    template: {
      format: WORKFLOW_TEMPLATE_FORMAT,
      version: 1,
      name: "記事執筆",
      steps: [
        {
          role: "Ideator（アイデア出し）",
          ai_name: "ChatGPT (Web)",
          prompt_template:
            "書きたい記事のテーマ・伝えたいこと・想定読者を洗い出したいです。壁打ち相手になって、切り口や構成のアイデアを一緒に広げてください。",
          command_template: null,
          input_files: [],
          output_files: ["docs/ideas.md"],
        },
        {
          role: "Outliner（構成案）",
          ai_name: "ChatGPT (Web)",
          prompt_template: "アイデアを元に、見出し構成（大見出し・小見出し）と各セクションで書く内容を箇条書きでまとめてください。",
          command_template: null,
          input_files: ["docs/ideas.md"],
          output_files: ["docs/outline.md"],
        },
        {
          role: "Writer（執筆）",
          ai_name: "Claude (Web)",
          prompt_template: "構成案に沿って本文を執筆してください。",
          command_template: null,
          input_files: ["docs/outline.md"],
          output_files: ["docs/draft.md"],
        },
        {
          role: "Editor（校正・推敲）",
          ai_name: "Claude (Web)",
          prompt_template: "誤字脱字・冗長な表現・論理の飛躍がないか校正してください。改善案も具体的に示してください。",
          command_template: null,
          input_files: ["docs/draft.md"],
          output_files: ["docs/review.md"],
        },
        {
          role: "Finalizer（仕上げ）",
          ai_name: "ChatGPT (Web)",
          prompt_template: "校正内容を踏まえて最終稿に仕上げてください。",
          command_template: null,
          input_files: ["docs/draft.md", "docs/review.md"],
          output_files: ["docs/final.md"],
        },
      ],
    },
  },
  {
    id: "research",
    label: "リサーチ",
    description: "調査設計→情報収集→整理・分析→レポート化の4工程。",
    template: {
      format: WORKFLOW_TEMPLATE_FORMAT,
      version: 1,
      name: "リサーチ",
      steps: [
        {
          role: "Scoper（調査設計）",
          ai_name: "ChatGPT (Web)",
          prompt_template:
            "調べたいテーマについて、調査の目的・知りたいこと・調べる範囲を整理したいです。壁打ち相手になってください。",
          command_template: null,
          input_files: [],
          output_files: ["docs/scope.md"],
        },
        {
          role: "Researcher（情報収集）",
          ai_name: "Perplexity (Web)",
          prompt_template: "整理した調査範囲に沿って、最新情報を出典付きで調べてまとめてください。",
          command_template: null,
          input_files: ["docs/scope.md"],
          output_files: ["docs/research.md"],
        },
        {
          role: "Analyzer（整理・分析）",
          ai_name: "Claude (Web)",
          prompt_template: "集めた情報を整理し、共通点・相違点・重要なポイントを構造化してまとめてください。",
          command_template: null,
          input_files: ["docs/research.md"],
          output_files: ["docs/analysis.md"],
        },
        {
          role: "Reporter（レポート化）",
          ai_name: "ChatGPT (Web)",
          prompt_template: "分析内容を元に、読みやすいレポート形式でまとめてください。",
          command_template: null,
          input_files: ["docs/analysis.md"],
          output_files: ["docs/report.md"],
        },
      ],
    },
  },
];
