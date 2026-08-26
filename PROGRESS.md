# 作業ログ（進捗・不具合トラッキング）

このファイルは作業のたびに更新する。完了したタスクは `PLAN.md` 側にも済マークを付ける。

## 表記ルール
- 完了タスク: `済`
- 不具合・要確認事項: `[優先度: 高/中/低]` を付けて記載、解消したら `解決済` に変更（削除はしない）

---

## 2026-08-26（1回目）: 旧アプリ退避 + UIモックアップ

### 完了（済）
- 旧 `ai-manager` を `legacy-ai-manager/` に git mv で退避
- Claude風3ペインUIのモックアップを作成・公開
  https://claude.ai/code/artifact/3acc8bfa-091e-4852-a31e-f204712a68b8
- `PLAN.md` 作成（5フェーズの実装計画）

---

## 2026-08-26（2回目）: フェーズ0〜2 実装（MVP動作確認済み）

### 完了（済）
- Vite + React 19 + TypeScript + Tailwind CSS 初期化（`package.json` 名を `ai-orchestrator` に変更）
- `src/types/workflow.ts`: Zodスキーマで `workflow.json` の型を検証
- `config/workflow.json`: サンプル4ステップ（設計→レビュー→実装→QA）を用意
- `workspace/{docs,src,logs}/`: サンプル成果物ファイルを配置
- `server/index.ts`: Express + chokidar + ws によるローカルサーバー
  - `GET/PUT /api/workflow`
  - `GET /api/artifacts`（workspace/配下のファイル一覧、隠しファイルは除外）
  - `GET /api/artifacts/*`（ファイル内容取得）
  - `/ws` でファイル変更をリアルタイムにブロードキャスト
- 3ペインUI実装（`src/components/WorkflowPane.tsx`, `PromptPane.tsx`, `ArtifactsPane.tsx`, `src/App.tsx`）
  - 左: ステップ一覧・選択・上下並び替え（`workflow.json`に即保存）
  - 中央: 選択ステップの入力ファイル内容を自動読み込みしてプロンプト生成、コピー、Claude Codeコマンド表示（Web AI向けとCLI向けでプロンプト生成方法を分岐 — CLI系はファイル内容を貼らずコマンドのみ表示）
  - 右: Artifacts一覧・タブ切り替え・Markdownレンダリング（react-markdown）
- `.claude/launch.json` を新プロジェクト用に更新（旧`jarvis-daemon`設定は削除）
- ブラウザで動作確認済み:
  - ステップ選択・プロンプト自動生成（ファイル内容の埋め込み含む）
  - クリップボードコピー
  - 「次のステップへ進む」→ status更新 → `workflow.json` に永続化
  - 上下ボタンでの並び替え → `workflow.json` に永続化
  - `workspace/`内ファイルをターミナルから直接編集 → UIが自動リロードなしで即座に反映（chokidar + WebSocket）
- `npm run build`（tsc + vite build）・`npx oxlint` ともにエラーなし

### 不具合・要確認（優先順位順）

- **[優先度: 低] コードファイルのシンタックスハイライト未実装**
  現状 `src/App.tsx` 等のコードファイルはプレーンな等幅テキストで表示（色分けなし）。
  仕様書4.3では「シンタックスハイライト付きのコードエディタ」を要求している。
  → フェーズ2の残タスクとして `shiki` 導入を予定。

- **[優先度: 低] ワークフロー編集UI（ステップ追加・削除・テンプレート編集）が未実装**
  左ペインの「＋追加」ボタン、中央の「テンプレートを編集」ボタンは現状見た目のみで機能しない。
  → フェーズ3で対応予定。

- **[優先度: 低] `react-markdown`のプレビュー領域に専用スタイル（`prose`相当）が未適用**
  `ArtifactsPane.tsx`で `className="prose-artifact"` を指定しているが、対応するCSSクラス定義がまだない。見た目は素朴なテキスト表示になっている。
  → 実害はないが、フェーズ2の仕上げとして見た目調整が必要。

- **[優先度: 低] クリップボードコピーの失敗時、ユーザーへの通知がない**
  `navigator.clipboard.writeText` が権限エラーで失敗した場合、ボタンのラベルが変化しないだけで無言で失敗する。
  → 失敗時のトースト表示等は今後の改善候補（実用上は大きな問題になりにくいため低優先度）。

- **[優先度: 低・許容] oxlintの `react/set-state-in-effect` 警告が3件（`src/App.tsx`）**
  データ取得（`fetchWorkflow`/`fetchArtifactContent`等）を`useEffect`内で`setState`する一般的なパターンに対する定型警告。動作上の不具合ではなく、意図した非同期データフェッチのため許容している。

### 現在の起動方法（開発時）
```bash
npm run server   # ローカルAPI + ファイル監視サーバー (port 4173)
npm run dev      # Vite開発サーバー (port 5173, /api・/wsは4173へプロキシ)
```
両方同時に起動する必要がある。`.claude/launch.json` にも両方の設定を登録済み。

### 次にやること
フェーズ3（ワークフロー編集: ステップ追加・削除・並び替えのD&D化・テンプレート編集UI）に着手。

---

## 2026-08-27: フェーズ3 実装（ワークフロー編集UI）

### 完了（済）
- `src/components/Modal.tsx`: 共通モーダルコンポーネント
- `src/components/AddStepModal.tsx`: ステップ追加フォーム（役割・担当AI・入出力ファイル・プロンプト・Claude Codeコマンドを入力）
- `src/components/EditTemplateModal.tsx`: 選択中ステップの `prompt_template` / `command_template` を編集して保存
- `WorkflowPane.tsx` に削除ボタン（ゴミ箱アイコン）を追加。削除時は `window.confirm` で確認
- `App.tsx` に `handleAddStep` / `handleDeleteStep` / `handleSaveTemplate` を実装、いずれも即 `workflow.json` に保存
- ブラウザで実際に動作確認済み: ステップ追加 → `workflow.json`に反映 / テンプレート編集モーダルの表示・キャンセル / ステップ削除 → インデックス再採番まで確認
- `npm run build` / `tsc --noEmit` / `oxlint` エラーなし

### 不具合・要確認（優先順位順）

- **[優先度: 低・設計判断] ステップ並び替えはドラッグ＆ドロップ化を見送り、上下ボタン方式を継続**
  仕様書4.1では「ドラッグ＆ドロップ」も選択肢として挙げられているが、上下ボタンで同等の操作が可能なため、実装コストに見合わないと判断。ユーザーから要望があれば追加実装する。

- **[優先度: 低] ステップ削除の確認に `window.confirm`（ブラウザネイティブダイアログ）を使用**
  デザインの統一感という点ではモーダルに統一した方が良いが、破壊的操作の確認としては機能的に十分なため現状維持。UI磨き込み時に置き換え候補。

- **[検証メモ] このセッションのブラウザ検証ツールで、モーダルの開閉ボタンを座標クリック（`computer`アクション）すると反応しないことがあった。**
  JavaScript経由で直接`.click()`した場合は問題なく動作しており、実装（Reactの`onClick`ハンドラ）自体に不具合はない。検証ツール側（プレビューペインが実際に描画されていない状態での座標クリック）の制約によるものと判断。アプリの不具合ではないため優先度の記載なし。

### 次にやること
フェーズ4（Claude Code連携強化: コマンド生成の高度化）に着手。

---

## 2026-08-27（2回目）: フェーズ4 実装（コマンド生成の高度化）

### 完了（済）
- `src/lib/claudeCommand.ts`: `command_template` が未設定でも、担当AIに「Claude Code」を含むステップは `input_files`/`output_files` から実行コマンドを自動生成するように変更。ユーザーが `command_template` を明示的に設定した場合はそれを優先（レビュー・QAステップ等、"実装して"という定型文が合わない場合の逃げ道として維持）。
- コマンド表示部分をクリックでコピーできるように変更（コピー成功時に一時的にラベル表示、テキストコピーと同じパターン）。
- サンプル `config/workflow.json` の実装ステップ（step_3）を `command_template: null` にして自動生成の例に、QAステップ（step_4）は明示テンプレートのまま残し、両方の経路を実演できるようにした。
- ブラウザで確認: 実装ステップ選択時に3つの入力ファイルすべてを反映したコマンドが自動生成されること、QAステップでは明示テンプレートが優先されることを確認。
- `npm run build` / `oxlint` エラーなし

### 不具合・要確認（優先順位順）

- **[優先度: 中・要ユーザー判断] コマンドのワンクリック実行機能は未実装のまま保留**
  仕様書には無いがPLAN.mdのフェーズ4に含めていた「任意」項目。ローカルシェルで `claude` コマンド等を実際に実行する機能はアプリに常駐する強い権限（任意コマンド実行能力）を持たせることになり、`CLAUDE.md`の安全原則にも関わる重めの設計判断のため、ユーザーへの確認なしには実装しないことにした。必要であれば次の指示で着手する。

### 次にやること
フェーズ5（仕上げ: 設定画面・エラーハンドリング・配布形態の検討）に着手。

---

## 2026-08-27（3回目）: フェーズ5 実装（設定画面・エラーハンドリング）+ Push権限エラー

### 完了（済）
- `config/ai_services.json`: AIサービス（名前・URL）の管理用ファイルを新設。サンプルでChatGPT/Gemini/Claude(Web)/Claude Code(CLI)を登録。
- サーバーに `GET/PUT /api/ai-services` を追加、chokidar監視対象にも追加。
- `src/types/aiService.ts`: Zodスキーマ。
- `src/components/SettingsModal.tsx`: サービスの追加・編集・削除UI（右上の歯車アイコンから開く）。
- `PromptPane.tsx`: 選択中ステップの担当AIに対応するURLが登録されていれば「開く ↗」リンクを表示（`target="_blank"` で新規タブに開くのみ。自動入力・自動送信はしない — `CLAUDE.md`の原則に準拠）。
- `src/lib/api.ts`: ZodのバリデーションエラーをUIにそのままダンプせず、フィールド名とメッセージを日本語で整形するように変更（`friendlyError`）。
- エラーバナーに「閉じる」ボタンを追加（今までは表示されたら消せなかった）。
- ブラウザで確認: 設定画面の開閉、サービスの追加→保存→`ai_services.json`へ反映、外部からの変更がリアルタイムで画面に反映されることを確認。
- `npm run build` / `oxlint` エラーなし

### 不具合・要確認（優先順位順）

- **[優先度: 高・ユーザー対応が必要] `git push origin main` が403エラーで失敗**
  ```
  remote: Permission to aijarvismanager-a11y/jarvis.git denied to specialladder-ux.
  fatal: unable to access '.../jarvis.git/': The requested URL returned error: 403
  ```
  現在のgit認証ユーザー（`specialladder-ux`）にリモートリポジトリへのpush権限がない状態。ローカルのコミット自体は正常に完了しているため作業は失われていないが、GitHub側のリポジトリ権限（Collaborator設定）または認証情報（Git Credential Manager経由のログインアカウント）の確認・修正が必要。コミット履歴はローカルに残っているので、権限が直ればいつでもpush可能。

- **[優先度: 中・要ユーザー判断] Tauri/Electron化は未着手**
  現状は「ブラウザ + ローカルNode.jsサーバー」の構成で仕様書のローカル完結要件は満たしているため、配布用にネイティブアプリ化するかは別判断。着手する場合はビルドパイプライン構築などまとまった作業になるため、必要であれば別途指示を。

### 次にやること
- push権限の問題を解決後、これまでのコミットをpush
- 残タスク（シンタックスハイライト、コマンド実行機能、パッケージング）はいずれも低〜中優先度・要ユーザー判断のため、指示があり次第対応
