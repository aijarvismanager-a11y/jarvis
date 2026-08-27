# AI Orchestrator

複数のAI（ChatGPT/Gemini/Claude等のWeb版、Claude Code CLI）をバトンリレー方式で連携させ、ローカル完結でアプリ開発の工程を管理するツール。API課金を導入せず、既存のブラウザ/CLIをそのまま使う。

## 起動方法

```bash
npm install
npm run start
```

`npm run start` でローカルAPIサーバー（port 4173）とフロントエンド（port 5173）が同時に起動する。ブラウザで `http://localhost:5173` を開く。

個別に起動する場合：

```bash
npm run server   # ローカルAPI + ファイル監視サーバー
npm run dev      # フロントエンド（Vite）
```

## ディレクトリ構成

- `config/workflow.json` — ワークフローのステップ定義（順序・担当AI・状態・入出力ファイル・プロンプト/コマンドのテンプレート）
- `config/ai_services.json` — 設定画面で管理するAIサービス一覧（名前・URL）
- `workspace/` — 各AIが読み書きする成果物置き場（`docs/`・`src/`・`logs/`）。Artifactsペインが監視する対象
- `server/` — Expressサーバー（`workflow.json`/`ai_services.json`のAPI、`workspace/`のファイル監視・配信、コマンド実行）
- `src/` — フロントエンド（React + TypeScript + Tailwind）

## Claude Codeコマンドのローカル実行について

「ローカルで実行」ボタンは、表示されているコマンドをサーバー経由でそのまま実行する（`workspace/`をカレントディレクトリとして）。任意コマンド実行を許すため、必ず実行前確認モーダルでコマンド内容を確認すること。

自動生成されるコマンドには非対話実行に必要な `-p --permission-mode acceptEdits` を付与している。`claude` CLIを初めて使う場合は事前にログインが必要：

```bash
claude login
```

（このアプリを操作しているClaude Codeセッション自体の認証は、単体で起動した`claude`コマンドには引き継がれない。別途ログインが必要。）

## テスト・ビルド

```bash
npm run test    # vitest
npm run build   # 型チェック + 本番ビルド
npm run lint    # oxlint
```

## その他

- `legacy-ai-manager/` — 旧Electron版アプリ（参考用に退避、現行アプリとは無関係）
- 進捗・既知の問題は [PLAN.md](PLAN.md) / [PROGRESS.md](PROGRESS.md) を参照
- 使い方は [MANUAL.html](MANUAL.html) を参照（ダブルクリックでブラウザに開く。オンライン版もあり: https://claude.ai/code/artifact/97733358-e6fc-48e9-bb35-5cb45f284780）
