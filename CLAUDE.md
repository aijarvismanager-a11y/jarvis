# CLAUDE.md — AI Orchestrator

このファイルは、今後このプロジェクトをClaude Code等で変更する際の絶対ルールを記す。

## 絶対原則

- **API課金を導入しない。** OpenAI/Anthropic/Google等の有料APIを必須にしない。APIキーがなくても完全に動作する設計を維持する。
- **既存機能を勝手に削除しない。** 削除が必要な場合は必ずユーザーに確認する。
- **UIを複雑化しない。** 情報を詰め込みすぎない、ボタンをわかりやすく保つ。
- **AIサービスの認証情報を取得しない。** パスワード保存・Cookie不正取得・ブラウザ認証情報取得は禁止。ログインは常にユーザーが各AIサービスのWebページ上で行う。
- **ローカル中心。** プロジェクト/タスク/Handoff/プロンプト/設定はすべてローカルファイル（JSON）で完結させる。外部サーバーを必須にしない。
- **軽量設計。** 常駐監視は開いているプロジェクトフォルダのみ。不要なポーリング・大量プロセス起動を避ける。
- **日本語UI。** ユーザー向けの文言は日本語を基本とする。

## アーキテクチャ概要

- `app/main/` — Electronメインプロセス。ウィンドウ管理、`shell.openExternal`によるAI起動、ローカルJSONストア（`app/main/store/*.ts`）、chokidarによる軽量ファイル監視、ZIPバックアップ。
- `app/preload/` — `contextBridge`で`window.api`のみを安全に公開。rendererはNode/fsに直接触れない。
- `app/renderer/` — React + Vite製UI。`design/`に移植済みの表示コンポーネント（Button/Chip/Icon等）とCSSトークン、`screens/`に画面ごとのコンポーネント。
- `config/` — `ai_services.json`（AIサービス定義）・`categories.json`（カテゴリー）・`settings.default.json`（既定設定）。新しいAIサービスを追加する場合、コード変更は不要（Settings画面から追加、または`ai_services.json`を直接編集）。
- 実行時データは開発時 `./data`、パッケージ後は Electron の `userData` ディレクトリに保存される（JSON、DB不使用）。

## AIサービスの扱い

- 各AIは埋め込みiframeではなく**既定ブラウザ**で開く（`shell.openExternal`）。AIサイトへの自動入力・自動送信・回答取得の自動化はしない。
