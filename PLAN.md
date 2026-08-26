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

### フェーズ2: Artifactsプレビュー（右ペイン） — 一部済
- [x] `workspace/` 内最新ファイル検知・一覧表示
- [x] Markdownレンダリング（react-markdown）
- [ ] シンタックスハイライト（shiki等、現状はプレーン`<pre>`表示 — 低優先度、PROGRESS.md参照）

### フェーズ3: ワークフロー編集 — 済（D&D以外）
- [x] ステップの追加・削除（左ペインの「＋追加」・各ステップの削除アイコン）
- [x] 並び替え（上下ボタン方式を採用。ドラッグ＆ドロップは見送り — 理由はPROGRESS.md参照）
- [x] `prompt_template` / `command_template` 編集UI（モーダル）

### フェーズ4: Claude Code連携強化
- [ ] コマンド生成の高度化（複数ファイル対応・相対パス解決）
- [ ] （任意・要確認）コマンドのワンクリック実行オプション

### フェーズ5: 仕上げ
- [ ] 設定画面（AIサービスの追加・削除管理）
- [ ] エラーハンドリング
- [ ] Tauri/Electron化の検討（配布する場合）

---

## 確認したいこと（着手前） — 承認済み(2026-08-26)

1. `legacy-ai-manager/` への退避内容はこのままでOKか（削除ではなく退避のみ） → OK
2. フェーズ0から順番に進めてよいか、それとも優先度を変えたい部分があるか → OKで進行
3. 新プロジェクトのディレクトリ名・`package.json` の名前をどうするか → `ai-orchestrator` に決定

## 進捗・不具合の詳細は [PROGRESS.md](PROGRESS.md) を参照

現在フェーズ0〜3が完了（フェーズ2はシンタックスハイライトのみ未実装、低優先度）。
次はフェーズ4（Claude Code連携強化）に着手予定。
