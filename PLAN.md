# AI Orchestrator 再構築計画

作成日: 2026-08-26
仕様書: `~/Desktop/ai-orchestrator-spec.md`
参考(旧実装): `legacy-ai-manager/`（既存の ai-manager アプリ一式を退避。中身は必要な時だけ覗く程度でOK。削除はしていない）

---

## 現在の状態

- 旧 `ai-manager` の全ファイルを `legacy-ai-manager/` に移動済み（git mv、コミットはまだしていない — 内容確認後にコミットするか判断してください）
- ルート直下は空（`.claude/`, `.git/`, `legacy-ai-manager/`, `PLAN.md` のみ）
- UIモックアップを作成済み（Claude風3ペインUI）
  → https://claude.ai/code/artifact/3acc8bfa-091e-4852-a31e-f204712a68b8
  - 左: ワークフロー（ステップ選択・上下並び替え）
  - 中央: プロンプト生成・コピー・Claude Codeコマンド表示
  - 右: Artifactsプレビュー（Markdown/コードタブ切り替え）
- まだ実装コードは1行も新規に書いていない（このPLAN.mdのみ新規作成）

## これから作るものの前提

- API課金を使わない、ローカル完結（`CLAUDE.md` の絶対原則を新プロジェクトにも引き継ぐ）
- 既存 `ai-manager`（Electron + React）は「参考程度」— 作り直しは仕様書ベースでゼロから
- スタック: Vite + React + TypeScript + Tailwind CSS + Node製軽量ローカルサーバー + chokidar

---

## 実装フェーズ（優先順位順）

### フェーズ0: 土台（最初に着手） — 済
- [x] Vite + React + TypeScript + Tailwind 初期化
- [x] `config/workflow.json` の型定義・スキーマ検証（Zod想定）
- [x] 軽量ローカルサーバー（Express）+ chokidarで `workspace/` 監視 → WebSocketでフロント通知
- [x] 3ペインの空レイアウト実装（モックアップをベースにコード化）

### フェーズ1: バトンリレー最小ループ（MVP） — 済
- [x] `workflow.json` 読み込み・ステップ一覧表示（左ペイン）
- [x] 選択ステップの `input_files` を読み込みプロンプト生成（中央ペイン）
- [x] クリップボードコピー機能
- [x] 「次のステップへ進む」→ status更新 → `workflow.json` 書き込み

### フェーズ2: Artifactsプレビュー（右ペイン） — 済
- [x] `workspace/` 内最新ファイル検知・一覧表示
- [x] Markdownレンダリング（react-markdown、`.prose-artifact`スタイル適用済み）
- [x] シンタックスハイライト（shiki導入済み）

### フェーズ3: ワークフロー編集 — 済（D&D以外）
- [x] ステップの追加・削除（左ペインの「＋追加」・各ステップの削除アイコン）
- [x] 並び替え（上下ボタン方式を採用。ドラッグ＆ドロップは見送り — 理由はPROGRESS.md参照）
- [x] `prompt_template` / `command_template` 編集UI（モーダル）

### フェーズ4: Claude Code連携強化 — 済
- [x] コマンド生成の高度化（複数ファイル対応・相対パス解決、`src/lib/claudeCommand.ts`）
- [x] コマンドのワンクリック実行オプション（ユーザー承認の上で実装。確認モーダル必須、`workspace/`をカレントディレクトリとしてローカル実行、結果表示）

### フェーズ5: 仕上げ — 一部済
- [x] 設定画面（AIサービスの追加・削除管理、`config/ai_services.json`）
- [x] エラーハンドリング（Zodバリデーションエラーの日本語化、エラーバナーに閉じるボタン追加）
- [ ] Tauri/Electron化の検討（配布する場合） → 未着手・要ユーザー判断（PROGRESS.md参照）

---

## 確認したいこと（着手前） — 承認済み(2026-08-26)

1. `legacy-ai-manager/` への退避内容はこのままでOKか（削除ではなく退避のみ） → OK
2. フェーズ0から順番に進めてよいか、それとも優先度を変えたい部分があるか → OKで進行
3. 新プロジェクトのディレクトリ名・`package.json` の名前をどうするか → `ai-orchestrator` に決定

## 進捗・不具合の詳細は [PROGRESS.md](PROGRESS.md) を参照

現在フェーズ0〜5まで完了。低優先度だった不具合はすべて解決済み。コマンドのワンクリック実行はユーザー承認を得て実装済み。
Tauri/Electron化は「今は不要」と判断（現状のブラウザ+ローカルサーバー構成を継続）。

## 実機耐性チェック（2026-08-27）
「実機に耐えうるか」との確認を受けて以下を実施・解決：
- 起動を`npm run start`1コマンドに統一（`concurrently`）
- `vitest`導入、コマンド生成ロジックとworkflowスキーマの自動テストを追加
- Windowsでのコマンド出力文字化けを緩和
- **実際に`claude` CLIで実行検証** → `-p --permission-mode acceptEdits`が非対話実行に必須と判明し追加
- **重要**: 検証の過程で、実機の`claude` CLIが未ログインであることが判明 → `claude auth login`でログイン完了後、実際に「ローカルで実行」ボタンから`claude`を実行し、正常終了・ファイル読み込み・文字化けなし・安全な挙動（未生成ファイルへの依存を検知して実装を強行しない）まで実機で確認済み。詳細はPROGRESS.md参照。

**→ 実機での動作確認、完了。**

## リポジトリ・Push状況
2026-08-27、push権限エラーを解決済み。`git remote set-url`でリモートURLに正しいGitHubアカウント（`aijarvismanager-a11y`）を指定し、以後正常にpushできる状態。
