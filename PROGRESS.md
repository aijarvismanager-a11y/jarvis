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

- **[優先度: 低・解決済 2026-08-27] コードファイルのシンタックスハイライト未実装**
  → `src/lib/highlight.ts`で`shiki`導入により解決。詳細は本ファイル末尾の「フェーズ5総仕上げ」を参照。

- **[優先度: 低・解決済 2026-08-26] ワークフロー編集UI（ステップ追加・削除・テンプレート編集）が未実装**
  → フェーズ3で対応済み（下記ログ参照）。

- **[優先度: 低・解決済 2026-08-27] `react-markdown`のプレビュー領域に専用スタイル（`prose`相当）が未適用**
  → `src/index.css`に`.prose-artifact`のスタイル定義を追加して解決。

- **[優先度: 低・解決済 2026-08-27] クリップボードコピーの失敗時、ユーザーへの通知がない**
  → `PromptPane.tsx`にフォールバックコピー（`execCommand`）と失敗時のエラーメッセージ表示を追加して解決。

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

- **[優先度: 低・解決済 2026-08-27] ステップ削除の確認に `window.confirm`（ブラウザネイティブダイアログ）を使用**
  → `src/components/ConfirmDeleteModal.tsx`を追加し、他のモーダルとデザインを統一。

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

---

## 2026-08-27（4回目）: push権限問題の解決 + フェーズ5総仕上げ（残っていた低優先度不具合をすべて解決）

### 完了（済）
- **push権限エラーを解決**: `git remote set-url` でリモートURLに正しいGitHubアカウント（`aijarvismanager-a11y`、既にGit Credential Managerに認証情報あり）を明示指定し、push成功。以後の`git push`/`pull`はこのアカウントで認証される。
- **シンタックスハイライトを実装**: `shiki`を導入（`src/lib/highlight.ts`）。`ArtifactsPane.tsx`で`.ts/.tsx/.js/.jsx/.json/.sh/.py/.html/.css/.yaml`ファイルを検出し色分け表示。
  - 実装中に注意した点: `shiki`の`createHighlighter`に文字列で言語名を渡す通常の使い方だと、TypeScript/JSXなどの文法が内部で埋め込み言語（他言語のコードブロック）を大量に参照しており、Viteのバンドルに無関係な言語（C++、Emacs Lisp、Wolfram等）まで含まれてビルド後のJSが数MB膨らむ問題が発生。`createHighlighterCore` + 各言語ファイルの静的import + WASM不要のJS正規表現エンジン（`shiki/engine/javascript`）に切り替えて解決（ビルドサイズは正常範囲に戻った）。
- **Markdownプレビューのスタイル未適用を解決**: `src/index.css`に`.prose-artifact`のスタイル定義（見出し・リスト・コードブロック・リンク・引用）を追加。
- **クリップボードコピー失敗時の無通知を解決**: `navigator.clipboard`が使えない場合は`document.execCommand('copy')`にフォールバックし、それも失敗した場合はプロンプト欄の下にエラーメッセージを表示するように変更。
- **ステップ削除確認の`window.confirm`を解決**: `ConfirmDeleteModal.tsx`を追加し、他のモーダル（追加・編集・設定）とデザインを統一。
- ブラウザで全項目の動作確認済み（シンタックスハイライトの色分け表示、Markdownの見出しスタイル、削除確認モーダルの表示・キャンセル）。
- `npm run build` / `tsc --noEmit` / `oxlint` エラーなし。

### 不具合・要確認（この時点で残っているもの）

- **[優先度: 低・許容・対応不要] oxlintの `react/set-state-in-effect` 警告（`src/App.tsx`, `src/components/ArtifactsPane.tsx`）**
  データ取得を`useEffect`内で`setState`する意図した非同期パターンへの定型警告。動作上の問題はなく、これは今後も許容する設計判断（対応不要）。

- **[優先度: 低・設計判断・対応不要] ステップ並び替えのドラッグ＆ドロップ化は見送り**
  上下ボタンで同等の操作が可能なため実装しない判断を維持。要望があれば着手可能。

- **[優先度: 中・要ユーザー判断] コマンドのワンクリック実行機能**
  ローカルで任意コマンドを実行する強い権限をアプリに持たせることになるため、ユーザーの明示的な指示なしには実装しない。

- **[優先度: 中・要ユーザー判断] Tauri/Electron化（配布パッケージング）**
  現状の「ブラウザ＋ローカルNode.jsサーバー」構成でも要件は満たしているため、ネイティブアプリ化するかどうかは別途判断が必要。

**→ 上記2件（コマンド実行・パッケージング）は安全性やスコープに関わる設計判断のため、これまでどおり指示を待って対応します。それ以外の不具合はすべて解決済みです。**

---

## 2026-08-27（5回目）: コマンドのワンクリック実行機能を実装（ユーザー承認済み）

ユーザーに確認したところ「実装する」との回答（Tauri/Electron化は「今は不要」）。以下を実装。

### 完了（済）
- `server/index.ts`: `POST /api/execute` を追加。`node:child_process`の`exec`でコマンドを実行。
  - カレントディレクトリは`workspace/`（生成されるコマンドの相対パス`docs/...`・`src/...`がそのまま解決される場所に合わせた）。
  - タイムアウト120秒・出力バッファ上限5MB。タイムアウト時は`timedOut:true`を返す。
  - **安全性の設計**: このエンドポイントは実行するコマンド文字列をそのまま`exec`に渡す（＝任意コマンド実行）。これは「ローカル・シングルユーザー向けツールであり、実行されるコマンドはユーザー自身がUI上で確認・入力したもの」という前提に立っている（ユーザーが自分の端末で自分でコマンドを打つのと同じ信頼レベル）。外部からのリクエストを受け付けるものではなく、ネットワーク越しに他者が叩けるエンドポイントではない（ローカルサーバーのみ）。
- `src/lib/api.ts`: `executeCommand()`を追加。
- `src/components/ConfirmModal.tsx`: 汎用確認モーダルを新設し、ステップ削除確認（旧`ConfirmDeleteModal`）とコマンド実行確認の両方で共用するようにリファクタリング。
- `PromptPane.tsx`: 「ローカルで実行」ボタン → 確認モーダル（実行するコマンドをそのまま表示）→ 実行 → 結果表示（終了コード・stdout・stderr）のフローを実装。ステップ切り替え時は前回の実行結果をクリア。
- ブラウザで動作確認: 実行前確認モーダルに正確なコマンドが表示されること、成功時（終了コード0・緑バッジ）と失敗時（終了コード1・赤バッジ・stderr表示）の両方の表示を確認（テストは`fetch`をスタブして検証。実際の`claude` CLIは未インストール環境のため、サーバー側エンドポイント自体は`echo`コマンドで動作確認済み）。
- `npm run build` / `tsc --noEmit`（app・server両方） / `oxlint` エラーなし

### 不具合・要確認（優先順位順）

- **[優先度: 低・既知の制約] Windows環境でのコマンド出力の文字化け**
  `node:child_process`の`exec`はOSのデフォルトコードページ（日本語Windowsでは Shift-JIS/cp932）でバイト列を解釈するため、`dir`など一部のネイティブコマンドの出力が文字化けする場合がある（動作確認時に確認）。`claude`コマンド自体はNode.js製でUTF-8出力である可能性が高く実害は小さいと見込むが、他の任意コマンドを実行した場合に文字化けが起きる可能性がある。必要であれば`iconv-lite`等でのデコード調整を追加できる（低優先度）。

- **[優先度: 低・未検証] 実際の`claude` CLIでの動作は未検証**
  このマシンに`claude` CLIがインストールされていないため、生成されたコマンドを実際に実行して成果物が生成されることまでは確認できていない。`claude`がインタラクティブなセッションを開始し標準入力を待つ挙動をする場合、120秒のタイムアウトで打ち切られる可能性がある（`claude -p`等の非対話モードがあればそちらの使用を推奨）。ユーザー環境で実際に試して問題があれば調整する。

### 次にやること
特になし。指示があれば追加要望に対応。

---

## 2026-08-27（6回目）: 実機耐性の指摘に対応（起動の一本化・テスト追加・実際のclaude CLIでの検証）

ユーザーから「実機に耐えうる仕上がりか」との確認があり、その場で指摘した5項目に対応。

### 完了（済）
- **起動を1コマンド化**: `concurrently`を導入し、`npm run start`でサーバー+フロントを同時起動できるように（README.mdにも記載）。個別起動用の`npm run server`/`npm run dev`は従来通り残している。
- **自動テストを追加**: `vitest`導入。`src/lib/claudeCommand.test.ts`（コマンド自動生成ロジック）と`src/types/workflow.test.ts`（Zodスキーマのバリデーション）で計8件。`vitest.config.ts`で`legacy-ai-manager/`を除外（デフォルトだと旧アプリのテストまで拾ってしまっていたため）。
- **Windows文字化けの緩和**: `server/index.ts`で、Windows環境では実行コマンドの前に`chcp 65001>nul &&`を挿入し、UTF-8出力を正しく読めるようにした。
- **実際の`claude` CLIで実行確認 → 重要な発見あり**（詳細は下記「不具合」参照）: 自動生成コマンドに`-p --permission-mode acceptEdits`が必須と判明したため追加。これがないと`claude`が対話セッションを開始し、標準入力を待ったまま120秒でタイムアウトしてしまう（`src/lib/claudeCommand.ts`のコメントに理由を明記）。サンプル`workflow.json`のQAステップの明示コマンドにも同様に追記。`EditTemplateModal`にもこの注意書きを追加。
- `npm run build` / `npm run test` / `oxlint` すべてエラーなし。

### 不具合・要確認（優先順位順）

- **[優先度: 高・ユーザー対応が必要] 実機の`claude` CLIが未ログイン状態だった**
  実際に`claude -p --permission-mode acceptEdits "..."`をこのマシンで実行して検証したところ、`Not logged in · Please run /login`というエラーで失敗した。
  **原因**: 現在このタスクを進めているClaude Codeセッション自体は、ホスト側が管理する認証の仕組み（`CLAUDE_CODE_HOST_SESSION_ID`等の環境変数で連携）で動いており、そこから新しく`claude`コマンドを1つ起動しても、その認証情報は引き継がれない。単体の`claude` CLIとしてはこのマシンでまだ一度もログインしていない状態だった。
  **対応が必要な作業**（アプリの不具合ではなく、環境のセットアップ事項）: 通常のターミナルで
  ```bash
  claude login
  ```
  を一度実行し、ブラウザでの認証を完了させる。これをやらないと「ローカルで実行」ボタンは常に`Not logged in`で失敗する。
  ログイン後、再度「ローカルで実行」を押して、実際にファイルが生成される（`workspace/src/`配下等）ところまで確認することを推奨。

### 次にやること
- ユーザーに`claude login`を実行してもらい、実機での本番相当の動作（実際のコード生成）を確認してもらう
- それ以外の項目は現時点で対応完了

---

## 2026-08-27（7回目）: `claude auth login`完了 → 実機での「ローカルで実行」検証に成功

### 経緯
- `claude login`は誤り、正しくは`claude auth login`（サブコマンド体系）。
- 1回目のログイン試行はブラウザ認証は成功したがCLI側には反映されず（`claude auth status`が`loggedIn:false`のまま）。原因は特定できていないが、認証フローの完了通知（ブラウザの「準備が整いました。閉じてOK」ページ）が出た後も何らかの理由でローカル側の状態更新に失敗していた可能性がある。
- 2回目の`claude auth login`実行で正常にログイン完了（`claude auth status`で`loggedIn:true`、`specialladder@gmail.com`のProプランを確認）。

### 完了（済） — 実機での本番相当動作を確認
- サーバーの`/api/execute`経由で実際に`claude -p --permission-mode acceptEdits "..."`を実行し、以下をすべて確認：
  - 認証済み状態での正常実行（終了コード0）
  - `workspace/`をカレントディレクトリとして実際のファイル（`docs/requirements.md`・`architecture.md`）を正しく読み込み
  - 日本語出力が文字化けせず正常表示（Windows対策が機能）
  - `docs/design_review.md`（前段ステップの未生成の成果物）が無いことを検知し、実装を強行せず質問を返す安全な挙動を確認（非対話モードのため質問への回答はできず終了するが、ハングせず、意図しないファイル書き込みも発生しなかった）
- アプリの「ワンクリック実行」機能が、認証さえ済んでいれば実機で意図通りに動作することを実証できた。

### 不具合・要確認
- **[優先度: 低・未解明] 初回の`claude auth login`がブラウザ側は成功したのにCLI側の状態に反映されなかった理由は未特定**
  再現性は低そうで2回目は問題なく成功した。今後同様の報告があれば`claude doctor`での診断や、Windows認証情報ストアの直接確認などで深掘りする。

### 次にやること
特になし。実機での一連の動作確認が完了。ステップ2（レビュー）を完了させて`design_review.md`を用意すれば、実際のコード実装（`workspace/src/`への書き込み）まで確認できる状態。

---

## 2026-08-27（8回目）: ステップ2→3を実際に通し、実装まで完走 + タイムアウト不足を発見・修正

ユーザーの「ステップ2に行きましょ」の指示で、サンプルワークフローを実際に進めてフル検証。

### 完了（済）
- （Claude=このセッション自身が）ステップ2「Reviewer」役としてrequirements.md/architecture.mdをレビューし、`workspace/docs/design_review.md`を作成。
- アプリの「成果物の回収を完了し、次のステップへ」ボタンでステップ2→3へ実際に進行（`workflow.json`に反映）。
- ステップ3で「ローカルで実行」を実行 → **1回目は120秒タイムアウトで打ち切られ、何も生成されず終了**（重大な実機不具合を発見）。
- **原因**: 実際のコード実装タスクは複数ファイルの読み書きを伴うため、当時のexecuteタイムアウト（120秒）を素で超える。
- **修正**: `server/index.ts`
  - `child_process.exec`のtimeoutを120秒→**10分**に延長（`EXECUTE_TIMEOUT_MS`として定数化）。
  - Node.jsの`http.Server`自体が持つ`requestTimeout`/`headersTimeout`（デフォルトのままだとexecのタイムアウトより先にコネクションを切る可能性がある）を明示的に無効化（`0`に設定）。
  - `maxBuffer`も5MB→20MBに拡大（実装タスクの出力が長くなるケースに対応）。
  - レスポンスに`timeoutMs`を含め、UI側のタイムアウト表示（`PromptPane.tsx`）を固定文言「2分」から動的な分数表示に変更。
  - 実行確認モーダルに「実装タスクは完了まで数分かかることがある（最大10分）」の注記を追加。
- 修正後に再実行 → **約2分半で正常完了（終了コード0）**。実際に`workspace/src/`配下に`server.ts`・`workflowStore.ts`・`promptGenerator.ts`・`config.ts`等11ファイルが生成されることを確認。バトンリレー（ワークフロー進行→ローカル実行→実装成果物生成）が実機で完全に一巡することを実証。

### 不具合・要確認
特になし。今回発見した不具合はその場で修正・再検証済み。

### 次にやること
生成された`workspace/src/`の中身はあくまでサンプルワークフローの実行結果（このアプリ自体を再実装したもの）であり、本番のプロジェクト用途ではない。実運用では`workspace/`を実際の開発対象プロジェクトに差し替えて使う想定。

---

## 2026-08-27（9回目）: 「使い方が直感的にわからない」というUXフィードバックへの対応

ユーザーから「最初にどこを触ればいいか分からない」「アイデア出しの段階でどのAIに任せればいいか分からない」「バトンの渡し方の流れが分からない」という3点の指摘を受け、アプリ本体を改修。

### 完了（済）
- **`src/components/WelcomeBanner.tsx`**: 初回起動時（`localStorage`で判定）に画面上部へ「まずは左のワークフローからステップを1つクリックしてください」という案内バナーを表示。「わかった」を押すと次回以降表示されない。取扱説明書（`/MANUAL.html`）へのリンクも設置。
- **`src/lib/taskCategories.ts`**: 「アイデア出し・壁打ち」「要件定義・設計」「設計レビュー」「実装」「テスト・QA」「その他」の6カテゴリーごとに、おすすめのAIとその理由・役割名・プロンプト雛形・入出力ファイル例を定義。
- **`AddStepModal.tsx`**: ステップ追加時にカテゴリーのチップを選ぶだけで、担当AI・役割・プロンプト・入出力ファイルが自動入力されるように変更。選ぶと「おすすめ: ○○ — 理由」が表示される。これが「どのAIに任せればいいか分からない」への直接の回答になる。
- **`PromptPane.tsx`**: 各ステップの上部に「このステップの進め方」ガイドを常時表示するように変更。担当AIがWeb系かClaude Code(CLI)かで文面が変わる：
  - Web系: 「プロンプトをコピー → 担当AIのサイトを開いて貼り付け・実行 → 出てきた内容を`（出力ファイル）`に保存 → 次のステップへ」
  - Claude Code: 「実行コマンドを確認 → ローカルで実行 → 完了を待つ → 次のステップへ」
  - ステップ切り替えごとに再表示、×で個別に閉じられる。
- **サンプル`config/workflow.json`に「Ideator（アイデア出し）」ステップを追加**（`ChatGPT / Gemini / Claude (Web)`が担当、最初のステップとして完了扱い）。これまでのサンプルは「設計」から始まっていて、アイデア出しの工程自体が存在しなかった。`workspace/docs/ideas.md`のサンプルも追加。
- `public/MANUAL.html`（`root/MANUAL.html`と同内容）を追加し、アプリ内から`/MANUAL.html`としてリンクできるように。
- ブラウザで動作確認: 初回バナー表示・非表示、カテゴリー選択による自動入力、ステップごとのガイド文言の切り替え、すべて確認済み。
- `npm run build` / `vitest` / `oxlint` エラーなし。

### 不具合・要確認
- **[優先度: 低・運用上の注意] `MANUAL.html`が`/`(リポジトリ直下)と`public/`の2箇所に同一内容で存在する**
  リポジトリ直下はダブルクリックでオフライン閲覧するため、`public/`はアプリ内リンク用。今後内容を更新する際は両方同期する必要がある（同一ファイルのコピーであることをコミットメッセージ等で明記していく）。

### 次にやること
特になし。今回の3点のフィードバックには対応済み。

---

## 2026-08-28: デフォルトのAIサービスを追加（無料枠が使えるもの）

ユーザーの「デフォルトで入ってる無料枠が使えるAIサービスの数を増やして」との依頼で対応。

### 完了（済）
`config/ai_services.json`に以下を追加（既存4件 → 計13件）:
- Perplexity (Web)
- Microsoft Copilot (Web)
- Meta AI (Web)
- DeepSeek (Web)
- Mistral Le Chat (Web)
- Qwen Chat (Web)
- Grok (Web)
- HuggingChat (Web)
- Poe (Web)

いずれもログイン不要または無料枠で使えるブラウザ版チャットサービス。サーバーがファイル監視しているため再起動不要で反映され、設定画面（歯車アイコン）で全13件表示されることを確認済み。

### 次にやること
特になし。

---

## 2026-08-28（3回目）: 画像生成・動画生成・話題のAIを追加（計35件）

ユーザーの「画像生成、動画生成や最近話題になってるAI追加して」との依頼で対応（21件→35件）。

### 完了（済）
- **画像生成**: Midjourney・Ideogram・Leonardo.Ai・Adobe Firefly・Playground・Recraft
- **動画生成**: Runway・Pika・Luma Dream Machine・Kling AI・Google Flow (Veo)・Sora
- **音楽・音声生成（話題枠）**: Suno・ElevenLabs

名前に「（画像生成）」「（動画生成）」等のカテゴリーを付け、一覧で見分けやすくした。
JSONの妥当性とサーバー経由での反映（35件）、設定画面での表示を確認済み。

### 不具合・要確認
- **[優先度: 低・要確認] 今回追加したサービスのURLも記憶ベース。特にKling AI・Google Flow・Sora等は変更の可能性がやや高い分野（急成長中のサービス）なので、リンク切れがあれば設定画面から修正を。**

### 次にやること
特になし。

---

## 2026-08-28（2回目）: さらにAIサービスを追加（計21件）

ユーザーの「もっと増やせる？」との依頼で、開発フローに関連しそうなものを中心にさらに追加（13件→21件）:
- You.com
- Pi (Inflection AI)
- Kimi (Moonshot AI)
- NotebookLM（Google、ドキュメントレビューに向く）
- GitHub Copilot Chat（無料枠あり）
- v0 by Vercel（UI生成、設計段階に向く）
- Genspark
- Manus

`python -c "import json..."`でJSONの妥当性を確認、サーバーAPI経由で実際に21件返ってくることを確認済み。

### 不具合・要確認
- **[優先度: 低・要確認] 一部サービスのURL（Kimi・Genspark・Manus等）は確認時点の記憶に基づくもので、リブランディング等により変わっている可能性がある。**
  リンクが切れていた場合は設定画面から該当サービスのURLを直接修正できる。

### 次にやること
特になし。

---

## 2026-08-28（4回目）: アイデア出しの入口を「役割/AIを先に決める」から「まず話す→AIが提案」に変更

ユーザーの指摘: 「漠然とやりたいことをAI orchestratorに投げかけると、その内容だとこのAIが最適です、みたいなやり取りを最初のアイデア出しの部分でやりたい。いきなり役割とか担当AIとか決めろって言われてもわからない」。

これまでの「＋追加」ボタンは、カテゴリーを選ぶにせよ手動入力するにせよ、いきなり役割名・担当AI・入出力ファイルを埋めさせる構造になっており、「思いつきをまず話したいだけ」というユーザーの実際の使い方に合っていなかった。

### 完了（済）
- **`src/lib/ideaRecommendation.ts`**: フリーテキストからのキーワードマッチングで、向いていそうなAIサービスと理由を1つ返す簡易ヒューリスティック（最新情報→Perplexity、画像→Midjourney、動画→Runway、音楽→Suno、音声→ElevenLabs、表計算→Gemini、長い資料の要約→NotebookLM、コード/アプリ/システム→Claude (Web)、それ以外→ChatGPT）。「これは機械的な言葉マッチングであり賢い判定ではない」旨をUI上にも明記し、過大な期待を持たせないようにした。
- **`src/components/IdeaIntakeModal.tsx`**: 「＋追加」を押すと最初に開く新しいモーダル。「何を作りたいですか？」という自由記述のテキストエリアのみを最初に見せ、「おすすめのAIを聞く」でAIの提案（サービス名＋理由）を表示。そこから
  - 「このAIでステップを作る」→ 役割固定で「Ideator（アイデア出し）」、担当AIは提案されたサービス、プロンプトは入力したテキストそのもの、というステップを即作成
  - 「自分でAIを選び直す／詳しく編集する」→ 提案内容を引き継いだ状態で、従来のカテゴリー選択＋詳細編集フォーム（`AddStepModal`）に切り替え
- **`AddStepModal.tsx`**: `initial`（役割・AI・プロンプト）を受け取れるように変更し、IdeaIntakeModalからの引き継ぎに対応。
- **`App.tsx`**: 「＋追加」ボタンの遷移先をIdeaIntakeModalに変更。フローは 追加ボタン → IdeaIntakeModal（新規デフォルト） → （必要なら）AddStepModal（詳細編集、旧来通り）。
- ブラウザで実際に動作確認: 「家計簿アプリを作りたい。レシートを撮影したら自動で記録してくれるようにしたい」→ Claude (Web)を提案・ステップ作成まで確認。「最新のAIニュースを毎朝まとめてほしい」→ Perplexityを提案・詳細編集への引き継ぎまで確認。
- `npm run build` / `vitest` / `oxlint` エラーなし。

### 不具合・要確認
- **[優先度: 低・仕様として明記] AIの提案はキーワードマッチによる簡易判定であり、本物のAIによる意味理解ではない**
  精度を上げたい場合、将来的にはこのマッチング自体をAI（例えばClaude Code経由）に判定させる案もあるが、現状は「API課金なし・ローカル完結」の原則を保ったまま実現できる範囲で、シンプルなルールベースにとどめている。UI上にもその旨を明記済み。

### 次にやること
特になし。

---

## 2026-08-28（5回目）: 複数プロジェクトが1つのワークフローに混在する問題を解消（プロジェクトタブ化）

ユーザーの指摘: 「各ワークフローごとにタブとか何かしらで分けて表示できないの？現状は色んなものが一つのワークフローに入って見づらい」。実際に「サッカーの歴史サイト」「サッカー日本代表のサイト」という別々のアイデアが、サンプルの元のワークフローと同じ1本のステップリストに積み上がっていた（＝新しいアイデアを試すたびに前のプロジェクトの続きとして扱われてしまう構造上の欠陥）。

データモデルから作り直した（破壊的変更）。

### 完了（済）
- **`src/types/workflow.ts`**: `Workflow{current_project, steps}` を廃止し、`WorkflowFile{current_project_id, projects: Project[]}` / `Project{id, name, steps}` に変更。
- **`server/index.ts`**: Artifacts・コマンド実行のAPIを `/api/projects/:projectId/artifacts` 等のプロジェクトスコープ付きに変更。プロジェクトIDは英数字とハイフン・アンダースコアのみに制限（パストラバーサル対策）。実行時のcwdもプロジェクトごとの`workspace/<projectId>/`に。新規プロジェクトの初回実行時はディレクトリを自動作成。
- **物理ファイルの移行**: 既存の`workspace/docs`・`workspace/src`・`workspace/logs`等を`workspace/sample-project/`配下に移動。
- **`config/workflow.json`の移行**: 既存の1本のステップリストを3つのプロジェクトに分割
  - `sample-project`（このアプリ自身のデモ、5ステップ、全て完了）
  - `soccer-history`（「サッカーの歴史サイト」、実際にユーザーが試したアイデア出しステップ1件）
  - `soccer-japan-team`（「サッカー日本代表のサイト」、同上、進行中）
- **`src/components/ProjectTabs.tsx`**: プロジェクトタブバーを新設（ワークフローペインの上に配置）。タブ切り替え・削除（×ホバー表示）・「＋新しいプロジェクト」を提供。
- **`src/components/NewProjectModal.tsx`**: プロジェクト名だけを聞く最小限のモーダル。
- **`src/lib/paths.ts`**: `workspace/<projectId>/`プレフィックスを剥がす共通ヘルパー`stripProjectPrefix`を追加（`App.tsx`・`claudeCommand.ts`で共用）。
- **`AddStepModal.tsx` / `IdeaIntakeModal.tsx`**: `projectId`を受け取り、ユーザーが入力するファイルパスは「プロジェクト内の相対パス」（例: `docs/x.md`）のままでよく、保存時に自動で`workspace/<projectId>/`が付与されるように変更（`taskCategories.ts`のヒントも相対パスに修正）。
- **`App.tsx`**: プロジェクト切り替え・作成・削除のハンドラを追加。ステップ関連の全ハンドラ（追加・削除・並び替え・進行・テンプレート編集）を「現在選択中プロジェクトのstepsを更新する」形に書き換え。プロジェクト切り替え時は選択中ステップ・Artifacts選択をリセットし、そのプロジェクトの成果物一覧を再取得。
- **`MANUAL.html`（root・public両方、オンライン版Artifactも）**: プロジェクトタブの説明を追記。
- ブラウザで実際に動作確認: 3プロジェクトがタブとして分離表示されること、タブ切り替えでステップ・Artifacts・コマンドの表示（プロジェクトIDを含まない相対パス）が正しく切り替わること、タブ切り替えが`current_project_id`として永続化されること、新規プロジェクト作成→空のワークフローで開始→削除（実ファイルは残る）まで確認済み。
- テストも更新（`workflow.test.ts`を新スキーマに、`claudeCommand.test.ts`にプロジェクトプレフィックス除去のテストを追加）。`npm run build` / `vitest`（9件） / `oxlint` すべてエラーなし。

### 不具合・要確認
- **[優先度: 低・仕様として明記] プロジェクト削除は一覧から外すだけで、`workspace/<projectId>/`の実ファイルは削除しない**
  意図的な設計判断（誤操作でファイルを失わないため）。確認モーダルにもその旨明記。将来的に「完全に削除」オプションを求められたら別途対応。

### 次にやること
特になし。

---

## 2026-08-28（6回目）: 「AIの回答を貼り付けて保存」機能を追加（ワンストップ化）

ユーザーが実際にサンプルの「サッカー日本代表のサイト」プロジェクトを使ってみて「この一連の流れが分かりづらい」と指摘（具体的な言語化はできないとのこと）。あわせて「開く↗」を押したらChatGPTの入力欄に見覚えのない文章が入っていた、という報告もあったが、これはアプリ側が何かを自動入力した結果ではない（「開く↗」はページを開くだけで自動入力は一切行っていない）ことを確認・説明。

分析の結果、核心は「AIの回答を`workspace/.../ideas.md`に保存してください」と指示だけはするのに、**保存する手段をアプリの中に一切用意していなかった**こと（別途テキストエディタを開いて正しいパス・ファイル名で手動保存する必要があった）と判断。

### 完了（済）
- **`server/index.ts`**: `PUT /api/projects/:projectId/artifacts/*` を追加。指定パスへ内容を書き込む（親ディレクトリが無ければ自動作成）。
- **`src/lib/api.ts`**: `saveArtifactContent(projectId, relPath, content)` を追加。
- **`PromptPane.tsx`**: Claude Code以外（Web AI）のステップに「AIの回答を貼り付けて保存」欄（テキストエリア＋保存ボタン）を追加。保存先ファイル名をラベルに明示し、保存すると即座に`workspace/<projectId>/...`へ書き込まれ、ファイル監視経由でArtifactsペインにも自動反映される。
- 進め方ガイドの文言も「出てきた内容を◯◯に保存」→「返ってきた内容をコピーして、下の『AIの回答を貼り付けて保存』欄に貼り付けて保存」に更新し、具体的な操作を指すように変更。
- ブラウザで実際に動作確認: 「サッカー日本代表のサイト」プロジェクトでテキストを貼り付け→保存→実ファイル(`workspace/soccer-japan-team/docs/ideas.md`)が生成され、Artifactsペインにも即座に反映されることを確認。
- `npm run build` / `vitest`（9件） / `oxlint` エラーなし。

### 不具合・要確認
特になし。

### 次にやること
特になし。

---

## 2026-08-28（7回目）: 進め方ガイドの文言があいまいだった問題を修正

ユーザーの指摘: 「『下のプロンプトを「プロンプトをコピー」→...』という文章が、AIに聞く内容なのかこのままコピペする文言なのか分かりづらい」。

原因: ガイド文がボタン名をそのまま「」で囲んで地の文に埋め込んでいたため、引用符付きの文字列が「クリックするボタンの名前」なのか「そのままAIに貼り付ける文言」なのか区別がつかなかった。

### 完了（済）
- **`PromptPane.tsx`**: ガイドを1つの文章から番号付きリスト（`<ol>`）に変更。UI要素を指す語句には必ず「ボタン」「リンク」「欄」を付けて明示（例:「プロンプトをコピー」→「『プロンプトをコピー』ボタン」）。
  - Web AIステップ: ①コピーする ②サイトを開いて貼り付け・実行する ③AIの回答をコピーする ④貼り付けて保存する ⑤次のステップへ、の5項目。
  - Claude Codeステップ: ①コマンド確認 ②ローカルで実行 ③完了を待つ ④次のステップへ、の4項目。
- ブラウザで両パターン（Web AIステップ／Claude Codeステップ）の表示を確認済み。
- `npm run build` / `vitest`（9件） / `oxlint` エラーなし。

### 次にやること
特になし。

---

## 2026-08-28（8回目）: 「AIにまだ何も聞いていない段階」であることを明示

ユーザーの指摘: 「①コピーする、という手順が、まだ何もAIに聞いていない段階で表示されるのがよくわからない」。

より根本的な誤解: このアプリがAIと自動でやり取りしている（あるいは既に何かが進行中である）と思われていた可能性がある。実際には、このアプリはAIに一切自動で接続せず、「これから人間が手動でAIに持っていく内容」を用意しているだけ。この前提が画面上に明示されていなかった。

### 完了（済）
- **`PromptPane.tsx`**: ガイドの見出しの下に、前提を明示する一文を追加。
  - Web AIステップ: 「このアプリはAIと自動ではやり取りしません。まだAIには何も聞いていません — 以下の手順で、あなた自身がAIに聞きに行ってください。」
  - Claude Codeステップ: 「まだ何も実行されていません。以下の手順で進めてください。」
- ブラウザで表示確認済み。`npm run build` / `vitest`（9件） / `oxlint` エラーなし。

### 次にやること
特になし。

---

## 2026-08-28（9回目）: 手順内に実際のAIリンクを埋め込み

ユーザーの指摘: 「このあとに最適なAIのリンクを入れないとまだわかりずらい」。手順の中で「『開く↗』リンクから...」と文章で説明するだけで、実際にクリックできるリンクがその場になかった（ヘッダー部分に別途あるだけだった）。

### 完了（済）
- **`PromptPane.tsx`**: 手順リストの該当項目を、リンク名を説明する文章から実際のクリック可能なリンク（`{担当AI名} を開く ↗`）に変更。登録されたURLがない場合は従来通りテキストのみ表示。
- ブラウザで確認: `"ChatGPT (Web) を開く ↗"` が実際に `href="https://chatgpt.com"` のリンクとして手順内に表示されることを確認。
- `npm run build` / `vitest`（9件） / `oxlint` エラーなし。

### 次にやること
特になし。

---

## 2026-08-28（10回目）: 手順1・2の順番を入れ替え

ユーザーの指摘: 「1と2は逆やな」。「①プロンプトをコピー→②AIを開く」の順だったが、先にAIのサイトを開いてから貼り付けたほうが自然、との指摘。

### 完了（済）
- **`PromptPane.tsx`**: Web AIステップの手順を「①AIを開く → ②プロンプトをコピーして貼り付け・実行」の順に入れ替え。
- ブラウザで表示確認。`npm run build` / `vitest`（9件） / `oxlint` エラーなし。

### 次にやること
特になし。

---

## 2026-08-28（11回目）: 「AIの回答はどこまで貼り付けるか」を明記

ユーザーの質問: 「これって担当AIとのどの段階の会話まで貼り付けるの？」。何往復かやり取りしてよいのか、最初の1回の返答だけを貼るべきなのかが不明だった。

### 完了（済）
- **`PromptPane.tsx`**: 手順内・貼り付け欄の説明文の両方に「AIと何度かやり取りして構わない。納得のいく最終的な回答だけを貼る（会話全部は不要）」という趣旨を明記。
- ブラウザで表示確認。`npm run build` / `vitest`（9件） / `oxlint` エラーなし。

### 次にやること
特になし。

---

## 2026-08-28（12回目）: 「起点ステップ」の表現をなくす + 貼り付け欄の説明を整理・重複解消 + ファイルパスをクリックで開けるように

複数の指摘に対応:
1. 「前工程なしもわかりずらい」→「入力ファイル」行自体、値が無い時は表示しないように変更（ラベルも「参考にするファイル」に平易化、出力側は「保存先」に変更）。
2. 「貼り付け欄の説明文の表示位置が悪すぎる」→ 上の手順リストと内容が重複していた注記文を削除し、保存ボタンの隣に小さく保存先ファイル名だけを表示する形に整理。
3. 「保存先のファイルパスを開くリンクが欲しい」→ 「参考にするファイル」「保存先」に表示される各ファイルパスをクリックすると、右のArtifactsペインでそのファイルを選択・表示するように変更（`onOpenArtifact`を`App.tsx`から`PromptPane`に渡す形で実装）。

### 完了（済）
- `PromptPane.tsx` / `App.tsx` を上記の通り変更。
- ブラウザで確認: 入力ファイルなしの起点ステップで該当行が非表示になること、保存先ファイルパスのクリックでArtifactsペインの該当タブがアクティブになることを確認。
- `npm run build` / `vitest`（9件） / `oxlint` エラーなし。

### 次にやること
特になし。

---

## 2026-08-28（13回目）: 「テンプレート編集」モーダルを廃止しその場で直接編集できるように + ステップ作成時にAIリンクを直接登録できるように

ユーザーの指摘2件:
1. 「このプロンプトを書き換える」ボタンで別モーダルを開く必要ある？その場の枠で書き換えできればいいのでは。
2. ステップ作成フォームに担当AIのリンク先を直接入れられるようにすればいいのでは（今まではSettings画面で名前を一致させて別途登録する必要があった）。

どちらも妥当な指摘のため、その場で実装。

### 完了（済）
- **`EditTemplateModal.tsx`を削除**。`PromptPane.tsx`の「生成されたプロンプト」表示を読み取り専用の`<div>`から編集可能な`<textarea>`に変更。元の値と異なる場合のみ「変更を保存」ボタンが現れる方式（常時保存ボタンを出さず、誤操作を防止）。
- Claude Codeの実行コマンドも同様に「コマンドを書き換える」リンクからインライン編集できるように変更（保存/キャンセルボタン付き）。
- **`AddStepModal.tsx`に「AIのリンク（任意）」欄を追加**。入力して追加すると、`App.tsx`の新しい`handleUpsertAiService`が`ai_services.json`に自動登録（既存名なら更新、新規なら追加）。Settings画面を別途開く必要がなくなった。
- `taskCategories.ts`の「アイデア出し」「要件定義・設計」カテゴリーが複数AI名を結合した文字列（例:「ChatGPT / Gemini / Claude (Web)」）をおすすめAIにしていたため、`ai_services.json`との名前一致検索に失敗し「開く」リンクが出ない不具合があった。単一AI名（`ChatGPT (Web)`）に修正。サンプル`config/workflow.json`内の該当ステップも同様に修正。
- ブラウザで確認: インライン編集→保存→`workflow.json`へ反映、AIリンク入力→ステップ追加→`ai_services.json`へ自動登録、をそれぞれ確認済み。
- `npm run build` / `vitest`（9件） / `oxlint` エラーなし。

### 次にやること
ユーザーから「もっと使いやすくなる点・流れがおかしい点を先回りして検証してほしい」との依頼があったため、次のセッションで実際に一通り使うUXレビューを実施する。

---

## 2026-08-28（14回目）: 先回りUXレビュー — 役割・担当AIもインライン編集可能に

ユーザーの依頼「もう少しこうすれば使いやすいだろうとか、この流れおかしいよねっていうのを事前に検証しといて」を受けて、実際に一通り操作して点検。

### 見つけて直したもの
- **ステップ作成後、役割名・担当AI名を修正する手段が無かった**（プロンプト・コマンドはインライン編集できるようになったが、役割とAI名は不可）。`PromptPane.tsx`のヘッダー部分（役割名・担当AI名）を編集可能な`<input>`に変更し、フォーカスを外す（blur）と自動保存されるように実装。`App.tsx`に`handleSaveMeta`を追加。

### 検証中に判明した重要な注意点（アプリの不具合ではない）
このセッションのブラウザ検証ツールで、`computer`アクションの座標クリックが`document.activeElement`を実際には変更しない（＝クリックしたつもりの要素にフォーカスが当たらない）ことを確認した。プレビューペインが実際に描画・合成されていない状態が原因と考えられる（過去のセッションログにも同様の記録あり）。**この制約により、キーボード操作を伴う検証は座標クリックではなく、`.focus()`/`.blur()`のような直接的なDOM APIで行う必要がある**。今回はこの方法に切り替えて実際に保存されることを確認済み。今後の検証でも同様の手法を使うこと。

### 確認して問題なかったもの
- 「次のステップへ」を最終ステップで押した場合、次のステップが存在しなくてもクラッシュせず、ボタンが disabled になるだけで正常終了することを確認。

### 完了（済）
- `npm run build` / `vitest`（9件） / `oxlint` エラーなし。

### 次にやること
特になし。追加の使い勝手の指摘があれば都度対応。

---

## 2026-08-30: 「アイデア出しの後、次のステップへ進めない」不具合を修正 + プロンプトコピー横にAIリンクを追加

### 完了（済）
- **本物の不具合を発見・修正**: プロジェクトにステップが1つ（Ideator）しかない状態で「次のステップへ」を押すと、そのステップは「完了」になるが次の工程自体が存在しないため、ボタンが disabled になるだけで何も起きず「進めない」ように見えていた。ユーザーの実際のプロジェクト（サッカー関連2件）で再現確認。
  - `App.tsx`の`handleAdvance`: 次のステップが無い場合、即座にステップ追加フォームを開くように変更。
  - `PromptPane.tsx`: 既に完了していて次の工程が無い場合、disabledボタンの代わりに「このステップは完了していますが、次の工程はまだありません」というメッセージと「＋ 次のステップを追加する」ボタンを表示。
  - 実装当初は追加フォームとして`IdeaIntakeModal`（役割が常に「Ideator（アイデア出し）」に固定される）を開いていたが、パイプラインの続き（設計・レビュー等）を追加する場面では役割名が不適切になるため、カテゴリー選択式の`AddStepModal`を直接開くように修正。
- **「プロンプトをコピー」ボタンの右横に担当AIへのリンクを追加**（ユーザー要望）。ヘッダー部分やガイド内のリンクとは別に、コピー操作のすぐ隣に実際の遷移導線を用意。
- ブラウザで実際に再現→修正→動作確認（次のステップ追加フォームが正しいモーダルで開くこと、コピー横のリンクが機能することを確認）。
- `npm run build` / `vitest`（9件） / `oxlint` エラーなし。

### 次にやること
特になし。

---

## 2026-08-30（2回目）: 「AIがChatGPTとClaude Codeしか選ばれない」への回答と修正

ユーザーの質問「担当AIがChatGPTとClaudeCodeしか選ばれないけど正しい判断なの？」に対して、仕組みを正直に説明した上で見つかった不具合を修正。

### 分かったこと
- カテゴリーチップ（「＋追加」→カテゴリー選択）は**内容を見ない固定の対応表**（意図した設計。要件定義/設計→ChatGPT、実装/QA→Claude Codeなど）。
- アイデア出しの自由記述（IdeaIntakeModal）はキーワード判定だが、**「サイト」「ホームページ」等のWeb制作用語が判定リストに無かった**ため、「サッカー日本代表の**サイト**を作りたい」のような明らかに技術寄りの依頼がどのキーワードにも一致せず、デフォルトのChatGPTに落ちていた。

### 完了（済）
- `src/lib/ideaRecommendation.ts`の技術系キーワードに「サイト」「ホームページ」「Webサイト」「ウェブサイト」「サービス」を追加。「サッカー日本代表のサイトを作りたい」で実際にClaude (Web)が提案されることを確認。
- `npm run build` / `vitest`（9件） / `oxlint` エラーなし。

### 不具合・要確認
- **[優先度: 低・設計として明記] カテゴリーチップの担当AIは今後も内容非依存の固定値のまま**
  自由記述からの提案（IdeaIntakeModal経由）とは別物であることをユーザーに説明済み。手動で担当AI欄を書き換えることは常に可能。

### 次にやること
特になし。

---

## 2026-08-30（3回目）: AI提案の対象を拡張 + 前工程の成果物の中身も判定材料にする機能を追加

ユーザーの質問「それ以外の35件も自動提案の対象にできる？」への回答として対応。ただし画像/動画生成AIが6つずつ登録されているなど、単純なキーワードだけでは区別できないものが多いことを正直に説明した上で、区別できる根拠があるものだけ追加。

### 完了（済）
- **`src/lib/ideaRecommendation.ts`にルールを8件追加**（9件→17件+デフォルトのChatGPT）:
  - v0 by Vercel（UI/コンポーネント/React）
  - GitHub Copilot Chat（GitHub/リポジトリ/PR）
  - Grok（X（旧Twitter）/SNSのリアルタイム性）
  - Pi（雑談/相談/愚痴）
  - Manus（自動化/エージェント/代行）
  - HuggingChat（オープンソース指定）
  - Ideogram（画像生成、文字入り画像）— Midjourneyの一般ルールより先に判定されるよう順序を調整
  - Adobe Firefly（画像生成、商用利用/Adobe指定）— 同上
  - 画像/動画生成の残り4件ずつ（Leonardo.Ai・Playground・Recraft、Pika・Luma・Kling・Google Flow・Sora）は判別できる言語的手がかりが無いため見送り（ユーザーに理由を説明済み）。

- **ユーザーからの追加要望に対応**: 「2回目以降のステップ追加時、前工程の成果物ファイルの中身を実際に読み取って担当AIの推奨に使ってほしい」との要望を確認の上、実装。
  - `AddStepModal.tsx`: カテゴリーチップを選ぶと、そのカテゴリーの入力ファイル（前工程の成果物）を実際にサーバーから取得し、`recommend()`でその中身を判定。カテゴリーの固定デフォルトと異なるAIが提案された場合、「前工程の成果物の内容から見ると、◯◯の方が合いそうです」という追加の提案ボックスを表示し、「採用する」ボタンで担当AI欄に反映できるようにした。
  - 実際にユーザーの「サッカー日本代表のサイト」プロジェクトの`design_review.md`（「最新」「調べ」という語を含む文書）で検証。「実装」カテゴリー選択時にデフォルトのClaude Code (CLI)とは別に「Perplexity (Web)の方が合いそうです」という提案が表示され、「採用する」で担当AI欄が正しく切り替わることを確認。
  - **正直な限界の指摘**: この検証で、文書内の説明文中の単語（「最新の試合情報を調べる機能」のような、AIに調べ物を頼みたいわけではない文脈）にも反応してしまうことを確認した。キーワードマッチである以上、文脈は読めない。あくまで「参考程度の追加提案」であり、強制ではなく「採用する」ボタンを押さない限り反映されない設計にしている。
- `npm run build` / `vitest`（9件） / `oxlint` エラーなし。

### 次にやること
特になし。


---

## 2026-10-23: 新仕様の受領とPhase 0(完全監査)を実施 — コード変更なし

新仕様「新AIオーケストラ — ゼロベース再構築・完全実装仕様書」と監査プロンプトに基づき、現行プロジェクトを監査した。実装・削除は行っていない。

### 完了（済）
- `docs/audit/` に監査文書12本を作成(AUDIT_PROJECT_STRUCTURE / FEATURES / ARCHITECTURE / SECURITY / TESTS / DATA、REUSE、MIGRATION、DECISIONS、GAP_ANALYSIS、IMPLEMENTATION_ROADMAP、EXECUTIVE_SUMMARY)
- 実測: `npm test` 26件合格 / lint エラー0 / **`npm run build` 失敗**(`AddStepModal.tsx:75` TS18047)
- 推奨移行方式は B(段階的リビルド)。`PLAN.md` `README.md` に再構築中の注記を追記

### 不具合・要確認
- [優先度: 高] APIサーバーが認証なしの任意コマンド実行(`/api/projects/:id/execute`)を全インターフェース(`::`)で待ち受け(S-1/S-2)。修正は承認待ち
- [優先度: 中] `npm run build` 失敗(上記)
- [優先度: 低] ルート直下に空ディレクトリ8個(Phase 9で処分)。※テスト残骸と推定していたプロジェクト2件は実プロジェクトと判明(2026-10-23訂正)

### 次にやること
ユーザー承認後、Phase 0.5(緊急修正)→ Phase 1(Core State)。詳細は `docs/audit/IMPLEMENTATION_ROADMAP.md`。


---

## 2026-10-23（2回目）: Phase 0.5 緊急修正(セキュリティ+build)

### 完了（済）
- `server/index.ts`: `127.0.0.1` のみで待ち受け / 全APIでHost・Origin検査(403) / `/execute` に起動ごとのトークン必須 / WebSocketにも検査 / `PUT /api/workflow`・`/api/ai-services` をZod検証(400) / JSON上限2MB / `GET /api/session-token` 追加
- `src/lib/api.ts`: `executeCommand` がトークンを自動取得して付与(サーバー再起動後の403は1回だけ再取得して再試行)
- `vite.config.ts`: プロキシ先を `127.0.0.1` に(`localhost` が `::1` に解決されると接続できなくなるため)
- `tsconfig.server.json`: サーバーがZodスキーマを共有できるよう `src/types` の2ファイルを対象に追加
- `AddStepModal.tsx:75` の null ガードで build 失敗を解消
- 検証: `npm run build` 成功 / test 26件合格 / lint エラー0 / 実機: LAN IPへの接続拒否、偽Host・偽Origin・トークンなし 403、正トークン 200、ブラウザ(Vite経由)から実行成功、WebSocket接続成功

### 不具合・要確認
- 同一PC・同一ユーザーの別プロセスからはトークンを取得できる(単一ユーザーのローカルツールとして許容)
- S-3(shell文字列実行)・S-5(同時数制限)は Phase 3 で対応
- 起動直後にページを開くとWebSocket接続失敗が数回出る(サーバー起動待ち。再接続後は正常)

### 次にやること
Phase 1 — Core State(SQLite)。先に better-sqlite3 のWindowsビルド可否をスパイク。


---

## 2026-10-23（3回目）: Phase 1 着手 — SQLiteドライバのスパイク

### 完了（済）
- 隔離ディレクトリで better-sqlite3 13.0.3 を試行 → プリビルド導入4秒、動作OK(プロジェクトへの依存追加なし)
- `node:sqlite` でWAL・外部キー・ROLLBACK・2万件INSERT(104ms)を確認
- 決定: **`node:sqlite` を採用**(ネイティブ依存を増やさない)。詳細は `docs/audit/DECISIONS.md` D-11

### 不具合・要確認
- 配布用Node 22.13.0(bat内MSI)での `node:sqlite` は実機未検証
- `package.json` に `engines` 未指定(Phase 1最初に追加)

### 次にやること
Phase 1 本体: スキーマ(12テーブル)とリポジトリ層、Project分離テスト、旧workflow.jsonの読み取り専用インポータ。


---

## 2026-10-23（4回目）: Phase 1 本体 — Core State(SQLite)・リポジトリ層・旧データ読み取り専用インポータ

### 完了（済）
- `server/core/schema.ts` 仕様§44の12テーブル+`task_edges`。**Project分離をDBで強制**: 子テーブルの親参照は複合外部キー(id, project_id)。別プロジェクトのMissionにTaskを付ける・Artifact/Validation/Runを他プロジェクトのTaskに付ける・依存を跨ぐ、は全てDBが拒否。`retry_count`は0〜5のCHECK(仕様§32)、project idはGLOBで英数_-のみ
- `server/core/db.ts` `node:sqlite`(WAL・外部キーON)、`PRAGMA user_version`による番号付きマイグレーション、再入可能トランザクション(SAVEPOINT)
- `server/core/store.ts` リポジトリ層(projects/missions/tasks+依存/ai_services+capabilities/ai_runs/artifacts(自動version)/validations/decisions/events/settings/locks(期限付き排他))。全プロジェクト系メソッドがprojectIdを必須にして絞り込み
- `server/core/paths.ts` `resolveInProject`: 絶対パス・ドライブ文字・`..`・NUL・ジャンクション/シンボリックリンク経由の逸脱を拒否(監査の未確認事項を解消)
- `server/core/legacyImport.ts` + `cli.ts` 旧 workflow.json/ai_services.json/workspace を**読み取り専用**で解析→新DBへ変換。ドライラン既定、`--apply` 時は先に `backups/<日時>/` へ config/ と workspace/ をコピー、冪等(既存IDはスキップ・上書きなし)、ファイルは移動でなくコピー。`npm run migrate:legacy`
- `package.json` に `engines: node >=22.13`、`.gitignore` に `/data/ /projects/ /backups/`
- テスト: 新規40件(スキーマ制約、Project分離7種、リポジトリ、ロック、パス逸脱、インポータ・冪等性・バックアップ)。合計66件合格、build成功、lint エラー0
- テストが捕捉した不具合を修正: 入れ子トランザクション(SAVEPOINT化)、「設計レビュー」が「設計」に先に一致する役割分類の順序
- 実データのドライラン(config 不変をハッシュで確認): 4プロジェクト・AIサービス37件・警告3件。`data/migration-report.md`

### 不具合・要確認
- 実データへの `--apply` は未実施(バックアップ→取込。ユーザー確認後)
- `project_1788063824457` `project_1788064243370` は実プロジェクトと判明(以前の「テスト残骸」推定を訂正)
- ウェブAIの capabilities は未分類(Phase 4で付与)。旧 `workflow.json` の status は ready/completed に写像(仮定)
- Node 22.13.0 での `node:sqlite` 実機検証は未実施(開発機は24.22.1)
- 新DBは現行サーバー(`server/index.ts`)にはまだ接続していない(Phase 2)

### 次にやること
Phase 2 — Orchestrator(Mission Engine、Task Graph、状態機械、Scheduler、Pause/Resume)。先に実データへの `--apply` の可否を決める。

---

## 2026-10-23（5回目）: 実データへ `migrate:legacy --apply` を実行

### 完了（済）
- バックアップ: `backups/2026-10-23T13-59-57-077Z/`(config/ と workspace/、26ファイル)
- 取込 4プロジェクト・スキップ0・AIサービス37件。新DB `data/orchestrator.db`: projects 4 / missions 4 / tasks 11 / task_edges 8 / artifacts 8 / ai_services 37 / ai_capabilities 5 / events 31
- `projects/` へコピー: sample-project 20ファイル、soccer-japan-team 3ファイル、他2件は空(元から0ファイル)
- 旧 `config/` と `workspace/` は変更なし(config はハッシュで不変を確認)。旧ファイルは移行検証が済むまで残す

### 不具合・要確認
- 新DBの内容を新UIで確認する手段はまだ無い(Phase 2/7)
- 取込を再実行しても既存プロジェクトはスキップされる(冪等)

---

## 2026-10-23(6回目): Phase 2 — Orchestrator(Mission Engine・Task Graph・状態機械・Scheduler・Pause/Resume・Retry・Replan)

### 完了(済)
- `server/core/taskStateMachine.ts` Task/Mission の合法遷移表。不正遷移は `IllegalTransitionError`。`retryTask` は failed→ready で `retry_count`+1、**最大5回**(DBのCHECKも二重の歯止め)。completed/cancelled は終端
- `server/core/taskGraph.ts` 動的Task Graph。Zodスキーマ(最大50タスク)、重複キー/存在しない依存/自己依存/循環の検出、`applyPlan`(トランザクションで原子的)、`refreshReadiness`(依存完了でready化、再試行不能な依存先があれば下流を推移的にblocked、回復すれば戻す)
- `server/core/planner.ts` `Planner` インターフェース(差し替え可能)+ `ClaudeCodePlanner`。**`claude --help` を実行して存在するフラグだけ**使う(`--print` 必須、`--permission-mode plan` が無ければ安全のため実行拒否、`--output-format json`/`--json-schema`/`--no-session-persistence` は検出時のみ)。プロンプトは stdin 渡し。出力はZod+グラフ検証。Windowsの `.cmd` 経由(シェル使用)時は JSON 引数が安全にクォートできないため `--json-schema` を付けない
- `server/core/scheduler.ts` 最大並列2(設定可)、コード編集ロール(coding等)はプロジェクトごとに1系統。`locks` テーブルの `code:<projectId>` を Write Lock として使用(TTL付き、所有者は task:<id>)
- `server/core/missionEngine.ts` 計画提案→**ユーザー承認ゲート**(承認前はタスク未作成・未実行)→実行ループ→completed/failed。reject(フィードバック付き再提案)、pause(実行中をabort→paused、失敗扱いにしない)、resume、cancel、クラッシュ復旧(running等→ready)、replan(完了済み/失敗をPlannerへ渡し、旧未完了タスクは**承認後に**cancelled。失敗時は旧グラフ無傷)
- テスト新規54件(状態機械、グラフ、Scheduler、Planner、Engine)。全体 120件合格、`npm run build` 成功、`npm run lint` エラー0(既存warningのみ)

### 失敗・誤り・修正した点
- 当初 `heredoc` でのテスト作成が構文エラーで失敗 → ファイル作成ツールに切替。Windowsパスのエスケープ崩れ(TS1125)を修正
- 設計上の見落としを自己発見して修正: 他ミッションが並列枠を埋めていると「書込みロック不可」と誤判定して失敗にする恐れ → 他ミッションの完了待ちに変更

### 誤っている/未検証の仮定
- **実際の `claude -p` によるプラン生成は未実行**(サブスク消費と、モデル出力形式の実測が必要)。`--output-format json` の `result`/`structured_output` 解釈は想定で、テストはフェイク出力のみ。Phase 3 の実機検証で確認する
- コード編集ロールの判定は役割名の固定リスト(coding/fix/refactor 等)。Plannerが別名を使うと読み取り扱いになる → Phase 3 でPermission Policyと統合して見直し
- 並列上限2はエンジン単位(プロジェクト横断)。仕様の意図(プロジェクト単位かもしれない)は未確認
- プロセス再起動後の復旧は `run()` 時に行うが、起動時の自動再開フックはまだ無い
- 失敗ミッションの扱い: リトライ上限到達でミッション failed → ユーザーが replan か手動対応(自動Replanはしない)

### 残り(未着手)
- 現行サーバー `server/index.ts` へのAPI接続(新DBは依然未接続)、UI(Phase 7)
- 実Executor(ClaudeCodeExecutor、Phase 3)、Validation L1〜L3、Permission Policy
- AI Broker/Registry(Phase 4)。現状 `selected_ai` は未設定のまま
- コミットは未実施(指示どおり)

### 追記(Phase 2 続き): 新オーケストレーターAPIを現行サーバーへ接続
- `server/core/api.ts` `/api/v2` ルーター: ミッション一覧/詳細/イベント(GET)、作成・approve・reject(feedback必須)・replan・pause・cancel・run・resume(POST、`x-orchestrator-token` 必須)。入力はZod、projectId/missionIdはDB存在確認(他プロジェクトのミッションは404)
- `server/index.ts` に配線(`data/orchestrator.db`)。実Executorが無いため `canExecute: false` で run/resume は **501**(計画・承認・一時停止・取消のみ動作)。実サーバー起動で移行済みの実データのGETを確認
- テスト +6(計126件合格)、build成功、lint エラー0
- 残り: 実Executor(Phase 3)、UI(Phase 7)、起動時の自動復旧フック(Executor実装後)

---

## 2026-10-23(7回目): Phase 3 — Claude Code実行基盤(Executor・Permission Policy・CommandRunner・Validation・自己修復)

### 完了(済)
- `server/core/commandRunner.ts` 子プロセス起動の一本化。タイムアウト/中断で**プロセスツリーごとkill**(Windowsは `taskkill /T /F`)、出力上限2MB、`env`指定、`timedOut`報告。`planner.ts` はここから再エクスポート(互換維持)
- `server/core/permissionPolicy.ts` READ/WORKSPACE_WRITE/NETWORK/DEPLOY/DESTRUCTIVE。既定は READ+WRITE。CLIには必ず `--disallowed-tools`(WebFetch/curl/git push/rm 等)を付与、コード系タスクのみ npm/npx/node を許可。タスク文面にデプロイ・削除があれば `ApprovalGate` に確認(既定は拒否=実行しない)。`classifyCommand` でコマンドの必要レベルを判定
- `server/core/claudeCodeExecutor.ts` `claude --print` を `projects/<id>/` をcwdに実行。`--help` で存在を確認したフラグのみ使用(`acceptEdits`/`--permission-prompts none` が無ければ**実行拒否**)。`bypassPermissions` は使わない。プロンプトはstdin、依存タスクの成果物を渡す。実行前後のスナップショット差分を artifacts に登録。ログイン切れ・タイムアウト・異常終了を日本語で報告。20分上限(書込みロックTTL30分より短い)
- `server/core/taskValidator.ts` L1 宣言された成果物の存在/非空(コード作業で変更0件も失敗) → L2 JSON/JS構文 → L3 `npm test`(テストスクリプトがあるコードタスクのみ、`CI=true`)。判定は到達レベルで `validations` に記録
- **自己修復**: 検証/実行の失敗内容を次の試行のプロンプトに渡して再実行(エンジンの再試行は最大5回、無限ループなし)
- `missionEngine.ts` に `ExecutionResult.artifacts` と検証 `level` を追加。`server/index.ts` を実Executor+Validatorに接続し `canExecute: true`(run/resume が有効に)
- テスト +26(全体146件合格)、`npm run build` 成功、lint エラー0。実際の `claude --help` に対しフラグ検出と引数生成を確認(トークン消費なし)

### 未検証・既知の問題
- **実際の `claude --print` でのタスク実行は未実施**(サブスク消費のため)。`--output-format json` の `result`/`is_error` の解釈は想定。Test 3/4(実機E2E)は未実施
- 承認フローは `ApprovalGate` までで、承認UIは Phase 7。それまで DEPLOY/DESTRUCTIVE は常に拒否
- リトライ上限(5回)到達は task `failed` のまま(仕様の `blocked` 表示・ユーザー報告は未対応)
- ログイン切れでも5回リトライする(即時失敗なので実害は小さい)
- コード編集ロールの判定は依然として役割名の固定リスト(Scheduler)
- Windowsでは `claude` が `.cmd` のためシェル経由。ツール指定は空白を含むため引用符で囲んで渡している(実機未確認)
- 起動時の自動復旧フックは未実装

### 次にやること
Phase 4 — AI Registry / Broker。その前に、使い捨てプロジェクトで実機の `claude --print` による1タスク実行(Test 3/4)を確認したい。

### 追記(Phase 3 実機検証、2026-10-23)
- 使い捨てプロジェクトで実機 `claude --print` により「hello.js を作る」を実行 → mission completed(約50秒)。`hello.js` が生成され `Hello, World!` を出力
- 1回目は `code/hello.js` に作成 → L1検証が「hello.js なし」で失敗 → 失敗内容を次の試行に渡して再実行 → ルートに作成し L2 合格。**自己修復ループが実機で動作**。artifacts/validations/ai_runs も記録された
- 原因はプロンプトの食い違い(「コードはcode/」と期待パス「hello.js」)。期待パス優先の一文を追加
- 未確認: `npm test`(L3)の実機、並列実行、Pause中の実プロセスkill

### 追記2(Phase 3 実機検証の残り3点、2026-10-23)— すべて確認済み
- **L3 `npm test`**: 実機で add.js/test.js/package.json を生成 → Windowsで `npm test` が走り L3 合格(検証レベル3で記録)
- **並列+書込みロック**: research2本+coding2本で、同時実行の最大2、同時コーディング最大1(c1完了後にc2開始)を確認
- **Pause**: 実行中の子プロセス(node)が1→0。pause 197ms、タスクpaused、run()はpausedで返る
- 発見・修正: 同一プロジェクトで並列実行すると互いの生成ファイルを自分のartifactとして二重登録 → (path,署名)で重複排除。**帰属は並列時にベストエフォート**(先に終わったタスクに付く)
- Phase 3 完了。次は Phase 4


---

## 2026-10-23(8回目): Phase 4 — AI Registry / Broker(Health Check・Cost Guard)

### 完了(済)
- `server/core/aiRegistry.ts` 既定プロファイル(claude-code / claude-web / chatgpt / gemini / perplexity / copilot / deepseek の能力0-5・品質・信頼性・自動化レベル・無料区分)。`seedRegistryProfiles` は**スコア未設定のサービスにだけ**適用し、手で調整した値は上書きしない(冪等)。適用時に仮定として `decisions` に記録。起動時に `server/index.ts` から実行
- `store.ts` に `patchAiService` / `setTaskSelectedAi` を追加、`setCapabilities` が能力スコアを保存可能に。`AiService` に capabilityScores / qualityScore / reliabilityScore / freeLimit / limitations を追加(スキーマ変更なし)
- `server/core/aiBroker.ts` §18の重み 能力適合4・品質3・自動化2・安全性1(最大50、÷5で10点換算)。役割→能力の対応(Planner役割名の別名表+旧分類にフォールバック)。**Cost Guard**: 有料/APIキー必須は `free_only` で除外、`allow_paid` のみ許可。利用不可・廃止は除外。実行基盤が走らせられない `adapter_type` も除外(`executableAdapters`)。信頼度 0-1(得点・データの揃い具合・次点との差)、0.7未満は `needsReview`。§19のA(品質)/B(自動化)/C(無料・安全)の代替案を返す
- `server/core/aiHealth.ts` 到達性(URL: 5xx/無応答のみ失敗、403は稼働扱い)とCLI(`claude --version`)を確認し、`status` / `last_verified_at` を更新。**ログイン状態・無料条件・UI利用可否は「未確認(unverified)」と明示**し推測しない。2件以上のネット確認が全滅した場合はオフラインとみなしステータスを変更しない
- `missionEngine.ts` タスク開始時に Broker が `selected_ai` を設定し、`AI_SELECTED` イベントと `decisions`(次点・除外理由つき)を記録。Broker の例外/候補なしでもタスクは従来どおり実行(助言のみ)。`TaskExecutor.adapterTypes` を追加(ClaudeCodeExecutor は `["claude-code"]`)
- API: `GET /api/v2/ai-services`、`POST /api/v2/ai-services/health-check`(トークン必須)、`GET /api/v2/broker/preview?role=&budget=`(読み取り専用の試算)
- テスト +21(`phase4.test.ts`)。全体167件合格、`tsc -b` クリーン、サーバー側lint警告0。実DBのコピーで seed→選定を確認(coding→Claude Code 信頼度0.81、ux_review は Claude Code のみ実行可のため候補なし=従来どおり実行)

### 未検証・既知の問題・仮定
- **スコア値はすべて仮定**(実測ではない)。実運用の成否で調整する前提。信頼度の式(0.55×得点+0.30×データ充足+0.15×次点との差)も仮定
- 実際のネットワークでのヘルスチェック(`POST /ai-services/health-check`)は未実行(テストはフェイクのみ)
- `selected_ai` は現状**記録のみ**。実行は常に Claude Code(Web AI の実行は Phase 6)。旧データ取込済みタスクの `selected_ai` は上書きしない
- 「重要タスクだけ別AIで追加レビュー」(§57)は未実装。Broker側の材料(次点・A/B/C)までを用意
- 新DBを見るUIは未着手(Phase 7)。**未コミット**(指示待ち)

### 次にやること
Phase 5 — AI Discovery(必要時のみ発見、無料条件判定、`free_status` / `last_verified_at` 保存)。


---

## 2026-10-23(9回目): Phase 5 — AI Discovery

### 完了(済)
- `server/core/aiDiscovery.ts` On-Demand方式(§5)。①Registryに必要能力を満たす利用可能なAIがあれば**何も探さず**それを返す(`force`で上書き可) ②無ければ `DiscoverySource` から候補取得(同梱カタログ `BUNDLED_CATALOG`、差し替え/追加可能。常時クロールなし) ③登録済み(id/ホスト一致)を除外 ④候補ごとにURL到達性と公開料金ページの無料条件を確認 ⑤合格した上位3件(候補A/B/C)を返し、`save:true` のときだけRegistryに保存
- 無料条件判定 `judgeFreeStatus`(§7): ページ文面から free_tier / trial / paid / unknown。**「free」とは断定しない**(上限の有無は公開ページから分からないため free_tier 止まり)。読めない・曖昧なページは `unknown`。APIキー/従量課金が主体なら `paid`+`requiresApiKey`
- 不合格理由を候補ごとに返す(到達不可・能力不足・APIキー必須(Cost Guard)・無料条件未確認・言語/自動化レベル不一致)。`free_required`(既定true)では無料確認できない候補は保存しない。APIキー必須は `freeRequired:false` でも通さない
- 保存内容: adapter_type=`manual`/Level 1(Brokerは推薦できるが実行基盤は自動実行しない)、free_status、free_limit(根拠の抜粋)、`last_verified_at`、limitations、decisions に仮定として記録。品質/信頼性スコアは未設定(中立値)
- API: `POST /api/v2/ai-discovery`(トークン必須、Zod検証、未接続は501)。`server/index.ts` に接続
- テスト +12(`phase5.test.ts`)。全体179件合格、`tsc -b` クリーン、oxlint警告0

### 未検証・既知の問題・仮定
- **実ネットワークでの探索は未実行**(テストはfetchのフェイクのみ)。同梱カタログの料金ページURL・能力スコアは私の仮定で、実在の料金ページ文面に対する判定精度は未確認
- 無料条件の判定は単純なキーワード法。誤判定しうるため、結果は根拠の抜粋つきで提示し、`unknown`/不合格に倒す設計
- Web検索エンジン由来の候補探索(検索APIはキー/課金が絡む)は未実装。`DiscoverySource` を足せば対応可能
- Brokerが必要能力の欠落時に自動でDiscoveryを呼ぶ配線は未実装(現状はAPI手動呼び出し)。ログイン状態・UI可否は引き続き未確認(Phase 6)
- 未コミット(指示待ち)

### 次にやること
Phase 6 — Web AI 自動化(Level 1 → 2 → 3)。


---

## 2026-10-24(10回目): Phase 6 — Web AI 自動化(Level 1 → 2 → 3)

### 完了(済)
- **Level 1(手動)** `webHandoff.ts` / `webAiExecutor.ts`: Brokerが Web AI を選んだタスクは `waiting` になり、プロンプトと AI の URL を持つ「ハンドオフ」が作られる。ユーザーが回答を `POST /api/v2/web-handoffs/:id/result` で貼り付けると、`期待する成果物` のパス(複数ある場合は `=== FILE: パス ===` 区切り、無ければ `web-ai/…md`)に保存し、Artifact(source_ai / source_url つき)と ai_runs(executor=web-ai, ai_id, automation_level)を記録。ハンドオフは settings に永続化され、一時停止/再起動後も同じものを待ち直す。キャンセルで閉じ、12時間で期限切れ。`POST …/skip` で「Web AIに任せず Claude Code で実行」に切替。前のタスクの成果物は(Web AIはフォルダを見られないため)抜粋してプロンプトに入れる
- **Level 2(半自動)/ Level 3(完全自動)** `browserDriver.ts`: **追加依存なし**。既存の `ws` で、ユーザー自身の Edge/Chrome を専用プロファイル(`data/browser-profile`)で起動し DevTools Protocol で操作(可視ウィンドウ)。入力欄に入力 → 実マウスクリックで送信(無ければ Enter)→ 回答が増え・安定(3秒不変)・停止ボタンが見えなくなるまで待って取得。Level 2 は入力までして、送信はユーザー。回答はページから自動取得、または貼り付け
- **自動降格(§10)**: Level 3 が壊れる(入力欄なし/回答取得失敗など)と、その回の実行は Level 2 → Level 1 に落ちて続行(ミッションは止めない)。**2回連続**で壊れるとレジストリの `automation_level` を1つ下げ、decisions と `AUTOMATION_DOWNGRADED` イベントに理由を記録。成功で連続回数はリセット。**自動で上げることはしない**
- **禁止事項(§11)**: ログイン画面・ボット確認(CAPTCHA/Turnstile等)を検出したら突破せず、理由を添えて Level 1 に落とす(降格カウントにも数えない=ユーザーが解消できるため)。パスワード/Cookie は一切扱わない。ログインはユーザーが開いたウィンドウで通常どおり行う
- **ルーティング** `RoutingExecutor`: Claude Code が既定かつ唯一のコード書込み役。Web AI へ渡るのは「マスタースイッチON」かつ「Brokerが選んだ」かつ「コード編集タスクではない」場合のみ。スイッチOFF(既定)では Broker の候補に Web AI を含めず、従来と完全に同じ動作
- API: `GET/PUT /web-ai/settings`(スイッチ)、`PUT /web-ai/sites/:aiId`(セレクタ上書き)、`PUT /ai-services/:aiId/automation-level`(Level 2/3 への引き上げ。サイト設定とブラウザが無ければ拒否。引き下げは常に可)、`GET /web-handoffs`、`POST /web-handoffs/:id/{result,skip}`
- `missionEngine`: `ExecutionResult` に executor / aiId / automationLevel を追加し、ai_runs に「実際に誰がどのLevelで実行したか」を記録
- テスト +29(`phase6.test.ts`)。うち4件は**実ブラウザ(Edge headless)+ローカルのモックチャットサイト**で、入力→送信→ストリーミング回答の取得、2回目の質問で新しい回答が返ること、ログイン/ボット確認/UI変更ページで突破せず止まること、`WebAiExecutor` の Level 3 実行と Level 1 への降格を確認。全体208件合格、`tsc -b` クリーン、oxlint警告0

### 未検証・既知の問題・仮定
- **実在のサイト(ChatGPT/Gemini/Claude/Perplexity)では未検証**。同梱セレクタ(`webAiSites.ts`)は私の記憶に基づく仮定で、ログインが要るため実機確認していない。各AIの Level は既定のまま 1(手動)。Level 2/3 に上げるには、実サイトでセレクタを確かめてから API で引き上げる前提
- 多くの Web AI は利用規約で自動操作を制限している可能性がある。Level 3 は**ユーザーが明示的に引き上げた場合のみ**動く(既定は Level 1)。規約の確認はユーザー側
- 待機中のタスクは並列枠(既定2)を占有する。人の返答待ちが2件あると他のタスクが進まない
- ハンドオフの承認UIは未着手(Phase 7)。現状はAPIのみ
- ブラウザは終了時に明示的に閉じていない(サーバー終了時のshutdown未配線)。専用プロファイルが別のブラウザに使われていると起動に失敗し、Level 1 に落ちる
- 同一プロンプトを Level 2 で送らずに放置すると、ページ側の監視は12時間まで続く

### 次にやること
Phase 7 — UI(Mission中心。ハンドオフの回答貼り付け/スキップ、Web AIスイッチ、Levelの表示と引き上げ)。


---

## 2026-10-24(11回目): Phase 7 — UI(Mission中心の5画面)

### 完了(済)
- `src/v2/`: 新UI。既定で表示。旧3ペインUIは `/?legacy` で残置(Phase 9で削除)。追加依存なし(React + Tailwind + 既存の react-markdown)
- 画面5つ(§43): **ミッション**(1欄+「開発を開始」、詳細は折りたたみ / 進捗バー・現在の担当・チェックリスト / 計画の承認・修正依頼 / 一時停止・再開・中止・計画やり直し / 最近の成果物)、**開発**(タスク一覧。AIの詳細・実行履歴・検証結果は折りたたみ)、**履歴**(ミッション履歴、操作ログは折りたたみ)、**成果物**(最新版の一覧と本文、md表示、検証状態、取得元AI)、**設定**(Web AIスイッチ、AI一覧、Level変更、接続状況確認)
- **Web AIハンドオフのUI**: 待機中は「ミッション」画面に手順つきカードを出し、指示文コピー・AIを開く・回答の貼り付け送信・「Claude Codeで実行」(スキップ)ができる。タブに待機件数バッジ
- 2.5秒ポーリングで進捗反映(新しいWebSocketは追加していない)。トークンは既存の `/api/session-token`
- API追加(`/api/v2`): `GET/POST /projects`、`GET /projects/:id/overview`、`GET /projects/:id/artifact-content?path=`(DB登録済みの成果物のみ・1MB上限・プロジェクト外は不可)。テスト+3
- `vite.config.ts`: `API_PORT` でプロキシ先を切替可能に(既定4173のまま)

### 未検証・既知の問題
- ブラウザ確認は**実DB(進行中ミッション0件・タスク/成果物なし)**で5画面の表示とコンソールエラーなしまで。計画承認・進捗バー・ハンドオフカード・成果物ビューアの実表示は、データが無かったため未確認(コードとAPIテストのみ)
- 「開発を開始」は実Claude Codeで計画を作るため数十秒かかる(ボタン文言で表示)。実機の通し確認は Phase 10
- Discovery(AI探索)のUIは未実装(APIのみ)。旧DBから移行した draft ミッションは計画が無く「中止」しかできない
- 未コミット(指示待ち)

### 次にやること
Phase 8 — 総合検証(Unit/Integration/E2E、Test 1〜7)。UIの実データ表示確認も含める。


---

## 2026-10-24(12回目): Phase 8 — 総合検証

### 完了(済)
- `server/core/phase8.test.ts`(+8件): 仕様 §62 の Test 1〜7 を、実エンジン・実Store・実ClaudeCodeExecutor・実Validatorで通す。外部は `claude`/`npm` プロセスとWebだけをフェイクにした
  - Test 1 簡単サイト: 計画→承認→design→coding→検証→completed、成果物登録
  - Test 2 調査: Discovery(レジストリに無い能力だけ探索し、無料条件を通ったものだけ保存)→ Brokerが research を Web AI に→ハンドオフ回答がArtifact(source_ai付き)に
  - Test 3 AI失敗: **検証で実装の穴を発見・修正**(下記)
  - Test 4 テスト失敗: npm test の失敗出力が次の試行のプロンプトに入り、修正→L3再検証で通過
  - Test 5 再起動: ファイルDBを開き直し、状態・成果物が復元され、完了済みタスクはやり直さない
  - Test 6 複数Project: A/B同時実行でファイルが混ざらない
  - Test 7 無料制約: APIキー環境変数なしで完走、APIキー必須/有料AIはCost Guardが除外
- **修正した不具合(Test 3)**: タスクが失敗してもリトライは失敗したAIに固定されたままで、仕様の「Failure → Fallback → Retry」が成立していなかった。`BrokerOptions.excludeAiIds` を追加し、`missionEngine.assignAi` が「そのタスクで失敗したAIは除外して次点を選び直す」ようにした(`AI_FALLBACK` イベント記録)。候補が他に無ければ従来どおり同じAIで再試行。`ai_runs.ai_id` は executor が返さない場合 `selected_ai` で補完
- UI実データ確認(Phase 7の持ち越し): 一時ディレクトリに進行中ミッション(2/4完了・実装中・成果物1件)をseedして実サーバーで確認。進捗バー(50%)、現在の担当、チェックリスト、最近の成果物、成果物画面のmd本文表示を確認、コンソールエラーなし。本物の `data/` には触れていない
- 全体 219 件中、既知のタイミング系フレーク以外すべて合格、`tsc -b` クリーン

### 未検証・既知の問題
- **フレーク**: 全件並列実行時に、プロセス強制終了/実ブラウザ(Edge)終了を待つテストが5秒/10秒のタイムアウトで毎回別の1件落ちる(phase3 `spawnRunner` / phase6 `ChromiumDriver`)。単体実行では合格。負荷依存で、今回の変更とは無関係
- 計画承認ボタン・ハンドオフカードのUI実表示は今回も未クリック確認(APIテストのみ)
- Test 2 の「実ネットワークでの Discovery」「実在AIサイト」は未実施(フェイクfetch・フェイクWebのみ)。実機の通し確認は Phase 10
- oxlint は旧UI `src/App.tsx` の警告(set-state-in-effect)が残る。今回の変更前から存在
- 未コミット(指示待ち)

### 次にやること
Phase 9 — 移行・掃除(旧データ変換の完了確認後に REMOVE候補を削除)。

---

## 2026-10-24: Phase 9 — 移行・掃除(コード側)

### 完了(済)
- 移行の完了確認: `data/orchestrator.db` に4プロジェクト・37 AIサービスを取込済み(5回目の記録)。`backups/` にバックアップあり
- 旧UI削除: `src/App.tsx` `src/components/` `src/lib/`(旧テスト含む)。`main.tsx` は新UIのみ(`/?legacy` 廃止)
- 旧API削除: `/api/workflow` `/api/ai-services` `/api/ollama*` `/api/projects/:id/{history,execute,artifacts}` と WebSocket/ファイル監視(`server/index.ts`)。任意シェル実行の `/execute` も消えた
- 未使用依存の削除: `chokidar` `shiki`(`ws` は browserDriver が使うので残す)
- ルート直下の空ディレクトリ8個を削除(中身0を確認済み)
- `tsc -b` / `npm run build` 成功、全198件合格(旧libテスト分が減少)

### 残している物(ユーザー判断待ち)
- `config/` `workspace/`: `migrate:legacy` と `npm run package` がまだ参照
- `legacy-ai-manager/`(D-6): 旧Electron版。未移行データの有無は `data/logs.jsonl` のみ
- `backups/` `src/types/{workflow,aiService}.ts`(legacyImport が使用)

---

## 2026-10-29: 1.5.32〜1.5.46 — 利用枠の上限対応・資料選びの検証・画面の整理

### 完了(済)
- Claude の5時間枠が90%以上で警告、上限到達で「リセットまで待つ / ほかのAIに回す」を選ぶバナー(`LimitBanner`、`claudeQuota.ts` の `claudeLimitUntil` など)。選ぶと上限で止まった作業が自動で再開(`limitStoppedTasks`)。選ぶ前は `retryable: false` で止め、自動やり直しの回数を使い切らない
- ChatGPT・Gemini など: 回答が短い「上限に達しました」系なら、そのAIを数時間休ませてほかのAIへ(`usageLimit.ts`)。「使うAI」に「いま休んでいるAI」
- 資料選び(`projectContext.ts`): Gage 以外の3プロジェクト(Rust+TS / Python / Next.js)で、関数名を名指しした課題45件を検証。ChatGPT の小容量で外れていた30/45 → 45/45。コード優先・メモは容量の3割まで・定義側を優先
- 計画づくり(`planner.ts`): 既存プロジェクトは20分まで待つ(Gage は約11分・約1.7ドル。5分で打ち切られ、理由が空の「異常終了」になっていた)。時間切れは理由に出す
- 失敗理由を原因別の案内に(上限 / ログイン切れ / 時間切れ)
- ロボット確認(`browserDriver.ts`): 見えない枠・隠れた窓は確認と数えない。自動で消える確認は最大45秒待つ。休止は10分
- Copilot: 確認は本物で、メッセージ送信時に毎回出る。半自動(Level 2)で使う。Level 2 は確認で選択から外さない(`aiBroker.ts`)
- 画面: 「設定」を「使うAI」と「設定」に分割、「半自動で使えるAI」の見出し、はじめの画面を短縮、取り込みの説明を折りたたみ、移行プロジェクトの表示整形、リントエラー0件

### 要確認
- [優先度: 中] ChatGPT・Gemini の上限文言の実機確認(外れたら `usageLimit.ts` の正規表現に足す)
- [優先度: 中] Copilot 半自動の実作業(入力欄への入力と返事の読み取り)
- [優先度: 低] テスト `phase6.test.ts` が、まれに「bad port」(fetch の禁止ポート)で落ちる(Copilot などとは無関係の揺らぎ)
- [優先度: 低] `browserDriver.ts` のテンプレート文字列内の `\.` が `.` になる(確認用の枠のURL判定が少しゆるい)

---

## 2026-10-30: 1.5.57 — Gage の調査・設計、運用の整理、インストーラ

### 完了(済)
- Gage(`projects/gage_df3cd6e6`)の調査・比較・設計を18作業で完了(調査14・設計3・レビュー1)。成果は `research/` `design/` `review/`。結論: ファイル移動は**案B(管理情報のみ変更・実ファイルは動かさない)**を採用、Portal境界をまたぐ移動はブロック。Z-order・自動整理の再設計は《暫定方針》(実機検証が前提)。サムネイルは1本化設計で合格
- 案Bの最初の1作業(FenceItem に安定ID `Id`(Guid)を追加し、`FenceManagerService.LoadAll` で旧データに自動で付与・冪等・バックアップ前)を6作業で実行中/完了(コード変更は `FenceItem.cs` と `FenceManagerService.cs` の2か所のみ)
- Perplexity: 「クエリが上限を○文字超えています」は**文字数の上限**。超過の文字数から上限を覚え、抜粋を削って送り直す(`WebAiPromptTooLongError`、`web_prompt_cap:<aiId>`)。画面のお知らせ(ダイアログ・トースト・バナー)の「上限」文言は即座に検知(`usageLimit.ts` と `noticeText`)
- 完了検証レポート: 「一部未確認」と「答えが出ていない(確認できず)」を区別し、「次にすること」を追加。「未確認事項一覧」を作る作業は、「未確認」の言葉の数で判定しない
- デスクトップ版の窓: 先に動いている別版のサーバーを、実行中でなければ自動で止めて同データで自版を起動、実行中なら終わってから自動で切り替え。窓の版を画面に出す(`AIOrchestratorDesktop/<版>`)。新しいサーバーは古い版に戻さない。疑似サーバーで確認済み
- `scripts/restart-server.ps1`: vite の遅いビルドの警告(stderr)で再起動が中断し、古いサーバーが残る不具合を修正
- 運用: **版は、リリース(インストーラを作るとき)にだけ上げる。画面の版 = 最新インストーラの版**(今は 1.5.57)。インストーラは `npm run dist:win`(約5分・約128MB)
- 文書: `docs/gage-manual-verification.md`(実機検証の手順書)、`docs/pending-real-checks.md`(本物のサイトでの確認待ち)

### 要確認
- [優先度: 高] Gage の実機検証(Z-order など)。`docs/gage-manual-verification.md` の A を最優先で
- [優先度: 中] `docs/pending-real-checks.md` の7項目
- [優先度: 低] テスト `phase6.test.ts` が、まれに「bad port」で落ちる(無関係の揺らぎ)

## 2026-11-04: 1.5.84〜1.5.85 — 待機状態の実機確認、プロジェクトのアーカイブ、Ideogram の設定
(1.5.58〜1.5.84 の変更は `src/v2/changelog.ts` にある。)

### 完了(済)
- `npm run typecheck`(サーバー用+画面用)。ルートの `tsc -p .` は何もチェックしない。
- 古いTo-doの自動整理: 完了・中止済みの作業に残った「貼り付け待ち」を自動で閉じる(`WebHandoffHub.closeStale`)。
- プロジェクトの「しまう/もとに戻す」(`POST /projects/:id/archive`)。しまっても更新日時は変えない(動きではない)。動いていない完了・中止・失敗・下書きのプロジェクトは「まとめてしまう」。止まったままの「実行中/計画中」の依頼は、一覧の行に出して、その場で中止できる。
- 全AI休憩中の待機状態を、使い捨てサーバー(別ポート・別データ)で実機確認。「AIが作業しています」と出る矛盾を直し、待機の開始・終了の通知を追加。Claude の選択待ちのときは、赤い枠で選ぶよう案内。
- 専用ブラウザを閉じた直後にプロファイルが「使用中」のままになるのを、空くまで待つように修正。サーバーのログは再起動で `server.prev.log` に残し、終了の理由を記録。
- Ideogram のサイト設定(送信後の確認ボタン `confirmButton`、リンク内の画像 `imagesInLinks`、過去画像との区別 `historyUrl`)。実サイトで画像の取り出しまで確認。

- ヘッダーの整理(「その他」メニュー、Claude の枠の表示)。サイト確認用の道具 `npm run probe:site -- <aiId>`(見るだけ。`--send "…" --yes` で送信=無料枠を使う。後始末つき)。デスクトップ版のサーバー見張り(`electron/main.cjs` の `watchServer`。**実機では未確認**)。
- 容量の目安(消していない): `backups` 892MB、`projects` 502MB、`snapshots` 228MB、`dist-installer` の古いインストーラー(1.5.81〜1.5.84)約516MB と `win-unpacked` 391MB、専用ブラウザのプロファイル 1GB超。

### 要確認
- [優先度: 中] `docs/pending-real-checks.md` の #8(Ideogram の最終確認。無料クレジットが尽きたため未確認)と #9(Windows の通知)
- [優先度: 低] Leonardo・Playground・Recraft のサイト設定は未作成。ChatGPT をデザイン担当にしたときの « » SVG の読み取りは未確認

### 2026-11-04 (後半) レビュー修正・見張りの関数化
- コードレビューの指摘のうち、見張りの二重再起動、しまったプロジェクトの取り込み、通知の誤表示、画像の重複判定キー(historyUrlのあるサイトだけ)、二段階サイトでのEnter、再起動スクリプトのログ退避失敗を修正。残り(Ideogramのセレクタ、止まり警告の基準、待機フラグの範囲、GET内のcloseStale)は見送り。
- 見張りの判定を electron/watchdog.cjs の純関数 `decide` に切り出し、server/core/watchdog.test.ts で検査(実機のElectronでの動作は未確認)。
- backups(892MB)の内訳: 861MBは backups/sync/gage_*/_pull の5世代(1世代約171MB、保持数5で頭打ち)。増え続ける不具合ではない。減らすなら syncBackupKeep を下げる。
- lint は警告のみ(エラー0)。正規表現のエスケープ警告は動作確認なしに変えないため放置。
- 見張りの実機確認(インストール版1.5.85): 開発サーバーを止めると52秒で自動復帰した。ただし復帰したのはアプリ同梱のサーバーで、AppData側の別データ(23件)を表示した。アプリが自分で起動していないサーバー(リポジトリ版)の場合は再起動しないよう修正済み(electron/main.cjs)。この修正はインストーラー再作成まで実機に入らない。

### 2026-11-05 点検で見つけた不具合
- projectContext.ts: テンプレート文字列内の `\b` `\s` が効かず、「定義されている場所」の加点が常に0だった。String.raw にして修正。
- browserDriver.ts: ボタン文言の空白整理が `\s+` ではなく `s+`(文字sの連続)になっていた。ページに渡す文字列内なので `\s+` に修正。
- 「ブラウザ自身に閉じてもらう」終了処理は、終了が遅くなって実ブラウザのテストが時間切れになり、残る問題も直らなかったので取り消した。残る原因は未特定(docs/pending-real-checks.md)。
- 実ブラウザを使うテスト(phase6・appSmokeTest)は、機械が重いと全体実行で時間切れになることがある。単独実行では通る。
- タスク一覧の長い指示文を90字で短縮し、「全文を見る」で開くようにした。

### 2026-11-07 トークン節約(server/core/tokenSaver.ts)
- Claude Code の呼び出しごとに、役割で軽いモデルと考える量を選ぶ: document/ideation/test は haiku・low、coding/design/review/analysis は sonnet・medium、research は sonnet・low。計画づくりも sonnet・medium。
- 失敗して再試行するときだけ1段上げる(haiku→sonnet→opus、effort も上げる)。重いモデルは「軽いモデルで足りなかった作業」にだけ使う。
- 毎回送られる MCP ツール一覧とスキル一覧は読み込まない(--strict-mcp-config / --disable-slash-commands)。`claude --help` に載っているフラグだけ使う。
- 再試行に渡す前回の失敗内容を末尾3000字→1800字に短縮。
- 全部を既定モデルで動かしたいときは環境変数 AI_ORCH_FULL_POWER=1。
- 未確認: 実機で1つ依頼を流して、使用量(inputTokens/コスト)が実際に下がるか、sonnet/haiku で品質が落ちないかの比較はまだ。サーバー再起動までは反映されない。
- 2026-11-07 実測(同じ小さな coding 作業を1回ずつ): 既定 = コスト$0.240・入力約110k トークン相当 / saver(sonnet・medium・MCPとスキル省略) = $0.147・約70k。コスト約39%減、入力約36%減。どちらも fizzbuzz.js を作成。大きな作業・複数回の平均は未測定。サーバーは再起動済み。
- 2026-11-07 実測2(文書作業・README作成): 既定 $0.140 / haiku・low・省略フラグ $0.008(約94%減)。内容は正しかった。`--exclude-dynamic-system-prompt-sections` も追加(キャッシュ再利用。単独の効果は未分離)。サーバー再起動で反映。
- 2026-11-07 比較用: `npx tsx scripts/cost-by-role.ts` で役割別の平均コスト・入力トークンを節約前後で表示(境界は再起動時刻)。節約前の実績(成功した実行の平均): coding 34件 $0.54・入力約100万、design 22件 $0.74、research 4件 $1.00、document 7件 $0.41。節約後の実績はまだ無いので、実依頼が溜まったら再実行して比べる。
- 2026-11-07 実比較(Gage、節約前34件 vs 節約後の実行。コスト記録のある成功分): document 7→7件 $0.412→$0.025(約94%減)、test 2→3件 $0.362→$0.019(約95%減)、design 1件 $0.739→$0.389。**coding は 12件 $0.834 で節約前 $0.538 より高い**(件数が少なく、$0.3〜$2.4とばらつく。同じ作業の対比ではない)。実際に組み立てられる引数は確認済み(--model sonnet --effort medium など)。coding の差が作業の重さによるのか sonnet・medium が回数を増やしているのかは未特定。research/review は費用記録なし(別AI経由)。
- 2026-11-07 coding が安くならない原因: 初回の試行は $0.41(節約前 $0.45)でほぼ同じ。平均を押し上げたのは3回目の試行(12件中6件、1件 $1.26)で、きっかけは実際のビルド失敗と、別AI(Mistral/Qwen)のレビューの「コードが確認できない」という指摘。対策: 再試行の1回目は同じモデルのまま、2回目から1段上げる。別AIのレビュー指摘による再試行は上げない(tokenSaver.chooseModel)。効果は次の実作業が溜まってから `scripts/cost-by-role.ts` で確認(再起動後の集計は境界を更新すること)。未対応の候補: レビューAIにコードが届いていない問題(再試行を生む元)。
- 2026-11-07 レビューAIに「コードが確認できない」と言われる原因: aiReview.ts の TEXT_EXTENSIONS に .cs / .xaml / .csproj が無く、C#(Gage)では報告書の .md しか渡っていなかった。修正: プロジェクト文脈と同じソース拡張子の一覧を使い、ソースを先・メモを後に並べ、コードの作業でコードが1つも渡せないときはレビューを頼まない(再試行を生まない)。テスト追加(aiReview.test.ts)。効果の確認は次の実作業から(review の指摘による再試行が減るはず)。
- 2026-11-07 画面の読みやすさと「伝え方」(ユーザーの指摘: 調査・計画の文字が小さく読む気にならない / AIオーケストラへの伝え方が分からず毎回 Claude Code に聞くのでは意味がない):
  - ヘッダーに「文字 標準/大/特大」(既定は大=1.2倍)。CSS zoom で画面全体を拡大し、PCに記憶(src/v2/textSize.ts, TextSizeControl.tsx)。
  - AIのメモ・調査・計画の文書(.prose-artifact)を 12.5px → 15px、行間も広げ、見出しも大きくした。
  - 「伝え方の例」(src/v2/SayItHelper.tsx): 最初の依頼・計画の修正・途中で依頼を変える・やり直しの入力欄の上に、押すと文の型(◯◯を書き換える形)が入るボタンを付けた。計画画面には「この計画で合っていますか?」と「合っていれば何も書かず開始」の案内。
  - 確認: 画面で文字サイズ切替・例ボタンの入力を確認。AIメモの実画面での読み心地は未確認(文書を選ぶ操作が空振り)。「できたもの」の一覧に _archive の古いファイルが大量に並ぶ点は未対応(要整理)。
- 2026-11-07 「できたもの」一覧の整理(src/v2/artifactGroups.ts + テスト): 作ったファイルはトップのフォルダごとに折りたたみ(バラのファイルを先頭に)、AIのメモ(_ai-records / web-ai / docs/ai-notes)と、古いファイル・自動生成(_archive・bin・obj・dll/exe/pdb/zip・.unused/.old)は別の折りたたみへ。Gage で確認: PLAN.md を開いて15pxで読めた。実際の整理(古いファイルをフォルダから消す等)はしていない=表示を分けただけ。
- 2026-11-11 不具合: 案件が「実行中」のまま20分以上止まり、一時停止もできない(HyperPlayer 作り直し案件の調査タスク。Gemini のタブは開かず、実行記録・イベントとも無し):
  - 原因: ブラウザ操作(browserDriver.ts)の fetch・WebSocket 接続・CDP 命令に時間切れが無く、ブラウザが応答しないと永久に待つ。さらに missionEngine.execute が中断の合図(signal)を実行側任せにしており、合図を無視する実行側がいると pause が終わらず、resume も動いていたループを返すだけで何も起きなかった。
  - 修正: (1) CdpClient.connect を15秒、send を120秒、/json/new・/json/version の fetch を15秒・5秒で時間切れに(失敗として扱われ、通常の再試行・切替えに乗る)。(2) missionEngine.execute に raceAbort を入れ、中断の合図で必ず実行側を待たずに止まる(タスクは paused になり、再開で ready に戻る)。
  - テスト: missionEngine.test.ts に「合図を無視して返らない実行側でも pause→resume できる」を追加。server/core 全体 528件合格。
  - 未確認/未対応: 実際にどの呼び出しで止まったかは未特定(ログ無し)。動いているサーバーには未反映(再起動が必要)。画面に「実行中なのに動きが無い」警告は無い=別途、無動作の時間を表示する案(未実装)。

- 2026-11-12 追加機能: 案件が完了し、達成度チェックで足りない点(未達・一部・得点80未満)が出たら、オーケストラ自身が次の依頼(提案の「おすすめ」)を作る(server/core/autoFollowUp.ts、server/index.ts の onMissionCompleted から呼ぶ)。人が手で依頼を作って投げる運用をやめるため。
  - 歯止め: 計画の承認は従来どおり必要(承認なしでは何も動かない)/ 1つの依頼につき続きは1回 / 続きの連鎖は最大3回 / 終わっていない依頼が他にあれば作らない / 設定 autoFollowUp=false で切れる。失敗しても完了処理は止めず、イベント AUTO_FOLLOW_UP_CREATED / _SKIPPED / _FAILED に残す。失敗時は「作成済み」の印を消して再試行できる。
  - テスト: autoFollowUp.test.ts 7件追加。server/core 全体 535件中、phase6 の実ブラウザのテストが負荷で1回だけ30秒の準備待ちで落ちたが、単独では34件合格(環境負荷による一過性と推定)。tsc エラーなし。
  - 未確認/未対応: 動いているサーバーに未反映(再起動が必要)。実際に完了した案件で続きが作られるかは未確認。画面に「自動で作られた続きの依頼」の表示・切替スイッチは無い(設定は API/DB のみ)。

- 2026-11-12 不具合: 案件(mis_744a7e41)が途中で「失敗」になり、後続17タスクが全部ブロックされた(実機撮影その1が「許可したあとも、承認の要るコマンドが続いたため止めました」で失敗)。
  - 原因: (1) claudeCodeExecutor の承認ループが固定4回で、毎回「新しい」コマンドを許可していて作業は進んでいる(撮影が1枚ずつ増えていた)のに打ち切った。(2) powershell は「その1行だけ」許可なので、capture.ps1 の Start / Shot -Name a / Shot -Name b / Keys … が1行ずつ別の承認になり、4回では足りない。(3) 打ち切りが再試行不可(retryable:false)で、依存する17タスクが blocked、案件が failed になった。
  - 修正: (a) 承認の回数を 12 回に(MAX_APPROVAL_PASSES、暴走止めの天井を60回に)。回数でなく「新しいコマンドを求めているか」で続け、これまでに求めたものだけをまた断られたら止める。(b) permissionPolicy.approvableCommands: `powershell … -File x.ps1 <引数>` は、そのスクリプトファイルの許可として1回で引数違いも通す(`$`・`>`・`&`・バッククォートを含む行は従来どおり対象外、-Command などの直書きコードも対象外)。
  - テスト: phase3.test.ts に3件(4回を超えても新しいコマンドなら完了/回数切れは再試行可/スクリプト単位の許可)。server/core 536件合格、tsc エラーなし。
  - 未確認/未対応: 動いているサーバーに未反映(再起動が必要)。失敗した案件を再開できるかは未確認(失敗タスクの再試行は task retry API)。「1つの失敗で依存17タスクが全部ブロックされ案件が失敗になる」設計自体は変えていない(撮影のような確認作業が落ちても残りを止めない方針は未実装)。

- 2026-11-12 不具合(同じ案件の2回目の失敗): 承認の修正後は作業が最後まで進み、実機撮影その1・その2は完了したが、「拡大率125%・150%の撮影」(Windows の表示倍率を変えないと撮れない)が成果物が作れず失敗(再試行を使い切り)、後続10作業が全部ブロックされ、案件が再び「失敗」になった。
  - 原因: taskGraph.refreshReadiness が「失敗で終わった作業は、後ろの作業を必ず止める」仕様だった。確認だけの作業(test/review/document)の失敗でも、あとに続く確認・記録まで止まり、案件全体が failed になった。
  - 修正: (a) taskGraph.ts に CHECK_ROLES(test/review/document)と failedCheckDoesNotBlock を追加。失敗が確定した確認作業は、後ろの確認・記録の作業を止めない(コードを作る作業は従来どおり止める)。(b) missionEngine.ts: 失敗が確定した確認作業だけが残った場合は案件を「完了」にし、イベント CHECKS_NOT_DONE に未確認の作業を残す(完了時の達成度チェックと続きの提案はそのまま動く)。
  - テスト: missionEngine.test.ts に2件(確認の失敗が後続の確認・記録を止めず案件が完了する/コードを作る作業は止まる)。
  - 未確認/未対応: 動いているサーバーに未反映。失敗中の案件 mis_744a7e41 を再開したときの動きは未確認。「作れない確認を計画段階で作らない」(拡大率の撮影のように環境で不可能なもの)は未対応。

## 2026-11-12 Explorer クラッシュ監視
- `server/core/explorerWatch.ts`: 60秒ごとに Windows のアプリケーションログから Explorer.EXE のクラッシュを読み、`EXPLORER_CRASH` イベントとして記録(障害モジュール・オフセット・直前2分間の ui-probe コマンド・実行中タスク)。初回は過去7日分を取り込み、`data/explorer-watch.json` で重複を防ぐ。
- `tools/ui-probe.mjs`: コマンドの開始/終了を `data/ui-probe-log.jsonl` に1行ずつ記録(失敗しても検査は止めない)。
- 目的: 画面撮影とクラッシュの関係を、推測でなく記録から判定する。反映にはサーバー再起動が必要。

## 2026-11-13 確認タスクの「承認されなかったコマンド」が見逃されていた不具合
- 症状: 実機撮影の確認タスクが `capture.ps1 -Action Start` を断られ、「未確認」と正直に報告して完了扱いになるため、承認が一度も求められず、3件続けて画面が撮られないまま終わった(受け入れ38点)。
- 原因: `claudeCodeExecutor.attempt` が、断られたコマンドを「失敗した/期待ファイルが無い」ときだけ拾っていた。
- 修正: role が `test`(確認)のタスクは、正常終了でも断られたコマンドを拾って承認を求める(phase3.test.ts に追加)。他の作業は従来どおり。
- 反映済み: サーバー再起動。続きの案件 mis_5d264b3b(撮影のやり直し)を作成。

## 2026-11-14 見張り役(停滞の自動検知と再試行)
- `server/core/watchdog.ts`: 1分ごとに実行中の依頼を見て、(1)「実行中なのに動かす処理がない」依頼を再び動かす(WATCHDOG_RESTARTED)、(2) 35分間イベントが1つも出ない実行中タスクを中断する(WATCHDOG_STOPPED_TASK)。中断したタスクは失敗扱いになり、通常の自動やり直し(上限あり)で再実行される。
- 触らないもの: 承認待ち・全AIお休み待ちのタスク、同じタスクを3回止めたあと、案件の新規作成(しない)。
- `missionEngine.ts`: `isDriving` / `inFlightTaskIds` / `abortStalled` を追加。見張り役の中断だけ「paused」でなく「failed」で終える。
- テスト: watchdog.test.ts(純関数2、エンジン結合3)。反映にはサーバー再起動が必要。

## 2026-11-14 見張り役の拡張(承認待ち・止まった依頼の検知)
- watchdog.ts: 承認が10分以上返事待ちなら `WATCHDOG_APPROVAL_WAITING` を記録(以後30分ごと)。実行中の依頼で、残りの作業がすべて pending/blocked のまま5分続くと `WATCHDOG_NO_PROGRESS` を1回記録。
- 画面: 承認を10分以上待っていると「次にやること」が赤で「◯分待っています」になり、デスクトップ通知を10分後と以後30分ごとに再通知(notify.ts `staleApprovalNotices`)。進み具合の記録に WATCHDOG_* の日本語ラベルを追加。
- 未検証: NO_PROGRESS が実機の案件で出ること。
- 再起動で計画づくり中の依頼が「計画を作っています」のまま取り残される不具合を修正: 起動時に、計画中で提案が無い依頼はもう一度計画を作る(`engine.resumePlanning`、PLANNING_RESUMED を記録)。
- 再起動の取りこぼし2件を修正: (1)「画面の自動再起動」と手動の再起動がぶつかり、計画づくり中の依頼が失敗した。起動時に、直前に計画エラーで失敗した依頼(作業なし・5分以内)も計画をやり直す。(2) 再起動API(/system/restart)が「計画づくり中(提案なし)」の依頼を実行中と数えず、計画を途中で切っていた。数えるようにした。
- 2026-11-14 画面確認タスクの振り分け不具合: 「capture.ps1 -Action Start で 1000x600 に起動し…」などの確認タスクが、実機を動かせない Web AI(DeepSeek)に回っていた。`looksAtRunningApp`(scheduler.ts)が「1000x600で」「実機で」等の言い回ししか見ておらず、capture.ps1 / -Action / 「1000x600に」/ サイト・動画モードの撮影を見落としていた。語を追加し、実際の3つの文言をテストに追加。サーバー未反映(実行中の案件が終わってから)。
- 2026-11-14 画面の見やすさの直し(まとめて): (1) 作業の一覧に人向けの短い名前(`taskTitle`)と「くわしく」、(2) 作業ログは会話だけを既定で表示し「操作の記録も見る」で全件、英語の承認エラーは日本語に(`plainLogText`)、(3)「サーバーが古い」黄色い帯を1行の目立たない表示に、(4) タブのバッジを「反映待ち N件」(灰色)に、(5) 上部ボタンを整理(引き継ぎ・通知を「その他」へ)。再起動API: 受け付けた直後60秒は2回目を断る(forceは除く)。画面は dist をビルド済みで反映済み、サーバー側(再起動API・振り分け)は案件完了後の再起動で反映。
- 2026-11-14 自動の続きを「区切る」機能: 同じ確認(`CHECKS_NOT_DONE`)が、この依頼と、その元の依頼の両方で未確認のままなら、自動の続きを作らず人の判断を待つ(`repeatedUnverified` / `sameCheck`: 識別語=ファイル名・パス・プログラム名が3つ以上同じ)。実データ(mis_f232f168 と mis_4d688150 の動画モード確認)で同一と判定、別件(mis_744a7e41)は別と判定。反映は再起動後。
- 2026-11-14 AI自身の許可設定を書き換える作業の禁止: 続きの案件 mis_f9bc0aa1 が「.claude/settings.local.json に許可リストを追加する」作業を含み、AIが(正しく)断って失敗した。(1) 計画の検査(`validatePlan`)で、そうした作業を含む計画を不正にする。(2) 自動の続きは、提案がそうした内容なら作らず人の判断を待つ。許可の範囲を決めるのは人。
- 2026-11-27 会話画面: 今の依頼の上に過去のやり取り(依頼と結果の吹き出し)を表示。直前の1件を表示し、「もっと前」で5件ずつ追加、「中身を見る」で作業と回答。承認待ち・計画確認・依頼の入力中は1行に畳む。試験用データで画面確認(広い幅/375px)。インストーラー未反映。
- 2026-11-27 会話画面: 終わった依頼の画面を開くと、AIの返答が入力欄の上に見える位置まで自動で移動(自分で操作したら止める。人の作業や承認待ちがあるときは移動しない)。試験用データで確認。インストーラー未反映。
- 2026-11-27 会話画面: 終わっていない依頼は、作業を会話の吹き出しで順に表示(終わった順→いま進めている作業と作業ログ→「このあとN件」→進み具合と状況の1行)。新しい作業が終わるたびに状況の行まで追従(自分で操作したら止め、完了時は返答へ移動)。試験用データ(一時停止状態)で画面確認(広い幅/375px)。実際に動いている依頼では未確認。インストーラー未反映。
- 2026-11-27 比較測定(shop-change)と速度の改善: Orchestra は G1〜G11 すべて隠しテスト 22/22(結果は `benchmark/shop-change/RESULTS.md`)。直した点: 承認が出る判定の抜け、AI が書いたテストを完了前に自動実行、`projects/` に止め用の package.json(親の全テストを拾って数分かかる原因)、小さい依頼は計画の AI を呼ばず 1 つの作業にする(「作業を分けて計画し直す」ボタン付き)。時間のばらつきは大きく、1 回の測定では短縮と言えない。
- 2026-11-27 新しい依頼の画面の案内を実際のボタンに合わせた(「送る」、画面にある入口を案内、依頼が無いときの戻るボタン、確認質問中の「次にやること」)。1.5.88 に含まれ、本番の画面で確認(確認質問中の画面は試験用サーバーのみ)。
- 2026-11-27 [優先度: 低] 確認質問の画面で、下の入力欄の説明が、開いているフォームではなく「くわしく依頼する」を案内する。未修正。
- 2026-11-27 [優先度: 低] スマホ幅で下の入力欄の説明文が長く、固定欄が画面の約 3 分の 1 になる。未修正。
- 2026-11-27 [優先度: 中] ほかの AI の画面操作: DeepSeek はログインが必要、Gemini の時間切れ、Grok の入力欄の無反応、ChatGPT の入力欄が見つからないことがある(11/20 以降の記録より)。実サイトでの確認は未実施(利用者の許可が必要)。
- 2026-11-27 ほかの AI の画面操作を実サイトで確認(ChatGPT・Gemini・Grok に短い試験文と長いダミー文を各 1 回送り、3 つとも応答を取得)。直した点: (1) Grok は長い文の入力が遅い(9 千字で 32 秒)ため貼り付けに変更(1〜2 秒、記号や字下げは入力と同じ)。(2) Gemini は約 3 万 2 千字で黙って切り捨てるため上限 31,000 字(超える分は参考の抜粋を減らして送る)、Grok は 40,000 字(95,000 字は添付ファイルに化ける)。(3) 先頭 20 字に改行があると「入力できなかった」と誤判定する不具合。入力は実サイトで確認(送信なし)。貼り付けた長文(約 2 万 1 千字)を Grok に実際に送り、末尾を読んだ正しい応答を取得(開いてから送信まで 16 秒、変更前は 60 秒)。過去の「入力欄が見つからない」「時間切れ」は再現せず。DeepSeek はログインが必要で未確認。
- 2026-11-27 まとめて圧縮した古い AI の記録(`_ai-records/`)が画面で 404 になり、昔の回答が消えて見える不具合を修正: ファイルが無いときは圧縮ファイルから本文を読んで返す(展開して戻すことはしない。`readArchivedRecord`)。全テスト 681 件成功、本番データの複写を使った試験用サーバーで本文の表示を確認。インストーラー未反映。
- 2026-11-27 下の入力欄の案内を修正(上の低優先の 2 件): フォームを開いている間はそのフォームを案内し、確認質問中は「ここから送ると別の依頼になる」と出す。計画づくり中は条件の案内を出さない。スマホ幅は短い入力例にしてキー操作の説明を省き、固定欄は 375x812 で約 124px。テスト 682 件成功、試験用サーバーで確認(確認質問は画面内で差し替えた応答、AI は呼んでいない)。インストーラー未反映。
- 2026-11-27 インストール版 1.5.91 から確認機能で 1 通ずつ実送信: ChatGPT 成功(43 秒)、Grok 成功(50 秒)、Gemini 失敗(「回答を取得できませんでした(90秒待機)」、ボット確認は検出されず)。原因は未調査。使えるAIには画面に確認ボタンが無い。
- 2026-11-27 Gemini の「回答を取得できませんでした」の原因を特定(1 通送って観察): 回答は約 30 秒で出ていたが、停止ボタンの指定 `aria-label*="停止"` が、サイドバーの履歴(題名に「停止」を含む会話)の「その他のオプション」ボタンに一致し、生成中と判断し続けて時間切れ。送信ボタンの指定(`*="送信"`)も同じ弱点。直し方の案: 停止・送信ボタンを探すとき、サイドバー(ナビゲーション)内のものを除く。未修正。
- 2026-11-27 会話画面を実際の依頼で確認(独立したテスト用サーバー、小さな依頼2件)。直した点: (1)「3つに分けて」と頼んでも小さい依頼として1作業にまとめていた (2) 作業の見出しからファイル名が落ち「に node」のようになった (3) 計画の承認ボタンを押した位置によって追いかけが始まらず、作業ログが伸びると状況の行が入力欄の下に隠れた (4)「README に2行追記」を「全体で2行以内」と読み、作業が3回失敗した (5) 失敗した作業がある完了で「やることはありません」と出た。(1)(2)(3)は2件目の依頼で確認、(5)は画面の文で確認、(4)は自動テストのみ。未リリース。未対応: 依頼カードの「出した人」が読み込み前に一瞬「画面から出された」と出る。
- 2026-11-27 上の Gemini の取り違えを修正: 送信・停止ボタンは履歴のサイドバー内のものを除いて探す(`pageButtons`、browserDriver.ts)。追加テストは修正なしだと同じ時間切れで失敗し、修正後は成功。全テスト 686 件成功(別の作業中の変更を含む状態)。インストール版のブラウザで前回の試験の会話を送信なしで読み、3 秒で回答を取得。新しい送信での確認とインストーラーへの反映はまだ。
- 2026-11-27 インストール版 1.5.92 の確認機能で Gemini に 1 通送り成功(58 秒)。修正前は同じ操作が時間切れ。これで ChatGPT・Gemini・Grok はインストール版から送れることを確認。
- 2026-11-27 依頼カードの「出した人」が読み込み前に「画面から出された依頼」と出る不具合を修正(上の未対応の 1 件): 読み込むまでは「確認しています…」。別の依頼用に読んだ一覧は使わず、読み込み失敗では内容を消さない。テスト 687 件成功、本番データの複写の試験用サーバーで確認。インストーラー未反映。
- 2026-11-27 インストール版 1.5.92 の確認: Gemini の自動の試し(1通)が19秒で成功。新しいプロジェクト「動作確認1592」で依頼1件: 分割の計画(4作業)、実行中の追いかけ(状況の行は常に入力欄の上)、完了時の返答への移動、4作業すべて成功。追記の行数の誤判定は、今回の条件では再現の場面にならず自動テストのみ。新しく見つけた点: README に使い方を追記する作業の見出しが「記録に結果を書き足す」になる(指示文の後半の「末尾に追記」に反応)。同日修正(「へ追記・に追記」は、記録・履歴・メモ・CHANGELOG・PROGRESS の語に続くときだけ記録の作業とする)。型チェックと画面テスト 74 件成功。同日、版 1.5.93 のインストーラーを作成(型チェックと全テスト 688 件成功、同梱の版と server が一致)。インストールは未実施。
- 2026-11-27 インストール版 1.5.93 の確認(表示の操作のみ、AI への送信なし): 版は 1.5.93 で、server と dist は作成したインストーラーと一致。README に追記する作業の見出しは直り、記録の作業の見出しは変わらない。依頼カードは「確認しています…」の後に「画面から出された依頼」の表示(中止した過去の依頼で確認。アプリが作った続きの依頼の表示は画面では未確認)。更新履歴に 1.5.93 の項目あり、画面のエラー記録なし。
- 2026-11-27 インストール版 1.5.93 の確認機能で DeepSeek に 1 通送り成功(29 秒)。上の「ログインが必要で未確認」は解消。ChatGPT・Gemini・Grok・DeepSeek の 4 つはインストール版から送れることを確認。
- 2026-11-27 1.5.93 で追記の行数の確認(小さな依頼1件、プロジェクト「動作確認1592」): README.md に2行追記する依頼は成功(2行→4行、11秒)。ただし小さな依頼の作業は成果物の指定が空で、大きさの検査自体が走らないため、この依頼は修正の確認にならない。代わりに、インストール版の判定を保存済みの作業の指示文2件に当てて、どちらも大きさの指定なし(null)を確認。分割した依頼で検査が走る場面は実機未確認(自動テストのみ)。完了後にアプリが自動の続きの依頼(mis_8166f26c)を作り、承認待ちになった(2026-11-28 に利用者の指示で中止。画面で「中止」を確認)。そのカードに「アプリが自動で作った続き」と出ることを画面で確認。
- 2026-11-28 「使うAI」の「自動で使えるAI」に「送って確認」ボタンを追加(準備済みのAIは、画面から試せなかった)。短い文を1通送って返事を確かめる。失敗したときは「ブラウザで開く」「もう一度送って確認」を出す。「ブラウザ上のAIも使う」がオフの間はボタンを出さない(成功するとオンになるため)。型チェックと全テスト 688 件成功。テスト用サーバーで送信を偽装して、確認中・成功・ログイン切れ・スマホ幅を確認(実際の送信なし)。未リリース。
- 2026-11-28 1.5.93 で追記の行数の修正を実依頼で確認(分割した依頼1件 mis_b39f6593、3作業すべて成功、やり直し0回): 成果物の指定が README.md の1件で、指示に「2行だけを追記」がある作業が、README 6行のまま合格。修正前の判定なら「2行以内という指定なのに、6行あります」で不合格になる条件。完了後の自動の続き(mis_e26eff9a)は承認待ち。
- 2026-11-28 [優先度: 中] 依頼に「ほかのファイルは変えないでください」と書いても、記録の作業が追加されて CHANGELOG.md が変わり、確認の作業は `_ai-records/…/verify.md` を作る。直後の自動の続きは、その変更を戻す内容だった。同日修正(`server/core/fileScope.ts`): 依頼・条件・指摘に「ほかのファイルは変えない」「○○以外は変更しない」があるとき、記録の作業を足さず、依頼で名指ししていない `_ai-records/` の成果物を外し、各作業と計画の説明にその旨を書く。型チェックと全テスト 706 件成功。実依頼とインストール版は未確認。別の AI の追加レビューの記録(`_ai-records/reviews/`)は対象外で、有効なら従来どおり作られる。
- 2026-11-28 [優先度: 低] 指示が「docs/status-report.md と docs/previous-conversation.md があれば先に読み、…」で始まる作業の見出しが「docs/status-report.md と docs…」になり、何の作業か分からない。同日修正: 書き出しの準備の一文(「…があれば先に読み、」「…を確認したうえで、」)を飛ばし、「README.md の末尾に…」はファイル名を残す。型チェックと画面テスト 75 件成功。保存済みの作業 234 件で見出しが変わるのは 2 件だけ。インストール版は未反映。
- 2026-11-28 版 1.5.94 のインストーラーを作成(型チェックと全テスト 706 件成功、同梱の版・dist・テスト以外の server が一致)。内容: 「ほかのファイルは変えない」の指定の修正、「使うAI」の「送って確認」ボタン。インストールは未実施。
- 2026-11-28 インストール版 1.5.94 の確認(AI への送信なし): 版は 1.5.94 で、server と dist は作成したインストーラーと一致。「使うAI」の 13 件に「送って確認」ボタンと説明文が表示(押していない)。インストール版の計画の関数に指定ありの依頼文を与え、記録の作業と記録ファイルが外れることを確認(実依頼は未確認)。画面のエラー記録なし。
- 2026-11-28 [優先度: 低] 「使うAI」の「新しいAIの候補」に、11/22 の探索が「FOREIGN KEY constraint failed」で止まった表示が残っている。原因を特定(インストール版のコードで、メモリ上の試験データを使い再現): 探索は実在しないプロジェクト(`projectId: ""`)の仮の作業で AI に聞くため(`aiScout.ts`)、AI の画面操作が失敗すると `WebAiExecutor.recordFailure` の記録の保存が外部キー違反になり、本当の失敗理由が隠れる。聞くのに成功した場合は起きない。11/22 の本当の失敗理由は残っていない。同日修正: プロジェクトの無い仮の作業の失敗は、プロジェクトに紐づけずに記録する(`webAiExecutor.ts`)。型チェックと全テスト 707 件成功。インストール版は未反映。
- 2026-11-28 版 1.5.95 のインストーラーを作成(型チェックと全テスト 707 件成功、同梱の版・dist・テスト以外の server が一致)。内容: 新しい AI の探索の外部キー違反の修正(74e46d7)。インストールは未実施。
- 2026-11-28 インストール版 1.5.95 の確認(AI への送信なし): 版は 1.5.95 で、server と dist は作成したインストーラーと一致。インストール版のコードをメモリ上の試験データで動かし、探索で AI の操作が失敗すると本当の理由が出ることを確認。「使うAI」の画面には 11/22 の古い表示が残る(次の探索で上書きされる。実際の探索は未実行)。画面のエラー記録なし。
- 2026-11-28 1.5.95 で「いま探す」を 1 回実行(11/28 03:01): 成功。Gemini から 8 件、新しい提案は 2 件(Kimi、Google Antigravity。Google ログインと無料枠はどちらも AI の回答のみで未確認)。5 件は登録済みか既出、1 件は除外。「追加する」「見送る」は押していない。
- 2026-11-28 利用者の指示で候補の Kimi を追加: 自動化待ち(Level 1)として登録され、再読み込み後の一覧に表示(25 件)。Google Antigravity は未決定。
- 2026-11-28 [優先度: 低] 「追加する」を押した直後は「自動化待ちのAI」の件数が変わらず(24 件のまま)、画面を読み込み直すと 25 件になる。同日修正: 原因は AI の一覧が約 20 秒ごとの再読み込みだったこと(コードで確認)。候補の追加と「戻す」の直後に一覧を読み直す(`ScoutCard`・`RosterCard`)。試験用サーバーで追加後 0.2 秒で件数が増えるのを確認(「戻す」は画面では未確認)。型チェックと全テスト 707 件成功。インストール版は未反映。
- 2026-11-28 版 1.5.96 のインストーラーを作成(型チェックと全テスト 707 件成功、同梱の版・dist・テスト以外の server が一致)。内容: AI の追加と「戻す」の直後に一覧を読み直す修正。インストールは未実施。
- 2026-11-28 インストール版 1.5.96 の確認(表示のみ): 版は 1.5.96 で、server と dist は作成したインストーラーと一致。「使うAI」は表示され、自動化待ち 25 件、画面のエラー記録なし。追加直後の読み直しは実データを変えるためインストール版では試していない(試験用サーバーで確認済み)。
- 2026-11-28 版 1.5.97 のインストーラーを作成(型チェック成功、同梱の版・dist・テスト以外の server が一致)。内容: 作業の見出しの修正。インストールは未実施。
- 2026-11-28 [優先度: 低] 全テストで 1 回だけ 1 件失敗(708 件中)。直後の再実行は 708 件すべて成功。失敗したテストの名前は記録できず、原因は未調査。
- 2026-11-28 インストール版 1.5.97 の確認(表示のみ): 版は 1.5.97 で、server と dist は作成したインストーラーと一致。過去の依頼の追記の作業の見出しが「README.md の末尾に「分割確認1行目」…」になることを画面で確認。画面のエラー記録なし。
- 2026-11-28 [優先度: 低] 「README.md を読み、…」で始まる確認の作業の見出しが「読み」だけになる不具合を修正(1ファイルを読むことから始まる指示は、その後の内容を見出しにする。「末尾に…」の場合はファイル名を残す)。保存済み234件で見出しの変化は1.5.96比7件(この修正と1.5.97の分)、型チェックと画面テスト76件が成功。版には1.5.98で反映。
- 2026-11-28 1.5.98: 「package.jsonを作成し、…」で始まる作業の見出しが「作成し」だけになる不具合も修正(「package.jsonを作成」にする)。保存済み234件で見出しの変化は1.5.96比11件。型チェックと全テスト710件が成功。インストーラー作成済み(dist-installer/AIオーケストラ Setup 1.5.98.exe)、インストール後の確認はまだ。
- 2026-11-28 インストール版 1.5.98 の確認(表示のみ): 版は 1.5.98 で、server と dist は作成したインストーラーと一致。「README.md の末尾に「分割確認1行目」…」(以前は「読み」)と「package.jsonを作成」(以前は「作成し」)の見出しを画面で確認。画面のエラー記録なし。「ファイル監視の仕組み」の画面は未確認。
- 2026-11-28 [優先度: 低] 「npm testを実行し」のように、見出しが「し」で終わる作業が保存済み234件中12件。修正済み(1.5.98比で見出しの変化は14件、「し」で終わるものは0件。型チェックと画面テスト78件が成功)。版には1.5.99で反映。
- 2026-11-28 版 1.5.99 のインストーラーを作成(型チェックと全テスト 711 件成功、同梱の版・dist・テスト以外の server が一致)。内容: 「し」で終わる作業の見出しの修正。インストール後の確認はまだ。
- 2026-11-28 インストール版 1.5.99 の確認(表示のみ): 版は 1.5.99 で、server と dist は作成したインストーラーと一致。「npm startでサーバーを起動」(以前は「起動し」)の見出しを画面で確認。画面のエラー記録なし。
- 2026-11-28 「動作確認1592」の承認待ちの自動の続き(mis_e26eff9a)を、ユーザーの指示で画面から中止。承認待ちは残っていない。
- 2026-11-28 [優先度: 低] アプリが自動で作った続きの依頼が、中止後の画面で「あなたの依頼」と表示される。修正済み(会話の画面と「これまでのやり取り」で「アプリが自動で作った続きの依頼」と表示する。型チェックと画面テスト79件が成功、試験用サーバーの画面で2種類の表示を確認)。版には1.5.100で反映。
- 2026-11-28 版 1.5.100 のインストーラーを作成(型チェックと全テスト 712 件成功、同梱の版・dist・テスト以外の server が一致)。内容: 自動で作った続きの依頼の表示の修正。インストール後の確認はまだ。
- 2026-11-28 版 1.5.100 の最初の全テストで version.test.ts が 1 件失敗。同じ 1 ミリ秒内の 2 回の呼び出しが前の答えを使い回すテスト側の不安定さで、テストを修正(製品側は変更なし)。再実行は 712 件すべて成功。以前の「1 回だけ 1 件失敗」が同じものかは不明。
- 2026-11-28 インストール版 1.5.100 の確認(表示のみ): 版は 1.5.100 で、server と dist は作成したインストーラーと一致。「動作確認1592」の自動の続き 2 件(現在の依頼とこれまでのやり取り)が「アプリが自動で作った続きの依頼」、自分で出した依頼が「あなたの依頼」と表示されることを画面で確認。画面のエラー記録なし。
- 2026-11-28 インストール版 1.5.100 の画面確認(全タブ・その他メニュー・使い方・新しいプロジェクト、AI への送信なし、画面のエラー記録なし)。見つけた問題は次の 3 件、いずれも未修正。
- 2026-11-28 [優先度: 中] 中止した依頼の「進み具合」に「理由は上の「いまの依頼」に出ています」「「ホーム」で「計画をやり直す」」と出るが、理由の表示もそのボタンも無い(DevelopmentScreen.tsx の失敗と中止で同じ文)。
- 2026-11-28 [優先度: 中] 中止済みの依頼にも「止めて構いません」「必要なければ却下してください」が出る(missionBrief.ts が状態を見ていない)。
- 2026-11-28 [優先度: 低] 「その他」メニューが、外側を押しても Esc でも閉じず、画面の上に開いたまま残る(V2App.tsx)。
- 2026-11-28 上の 3 件(中止した依頼の「進み具合」の案内、終わった依頼に出る中止・却下のすすめ、閉じない「その他」メニュー)を修正。型チェックと画面テスト 80 件が成功。試験用サーバーの画面で、案内文、すすめが消えること、メニューが Esc・外側のクリック・項目の選択で閉じることを確認。版には1.5.101で反映。
- 2026-11-28 版 1.5.101 のインストーラーを作成(型チェックと全テスト 713 件成功、同梱の版・dist・テスト以外の server が一致)。内容: 画面確認で見つけた 3 件の修正。インストール後の確認はまだ。
- 2026-11-28 インストール版 1.5.101 の確認(表示のみ): 版は 1.5.101 で、server と dist は作成したインストーラーと一致。「動作確認1592」で、中止した依頼の「進み具合」の案内、記録に中止・却下のすすめが出ないこと、「その他」メニューが Esc と外側のクリックで閉じることを画面で確認。画面のエラー記録なし。
- 2026-11-28 承認の画面と作業中の画面を確認(試験用サーバー、仮の計画係と仮の AI、AI への送信なし)。計画の承認、許可、一時停止、中止の操作は動いた。見つけた問題は次の 5 件、いずれも未修正。
- 2026-11-28 [優先度: 中] 許可待ちのとき「進み具合」に「画面の上の「許可して続ける」か「拒否する」を押してください」と出るが、その画面にボタンは無い(summaryLine.ts)。
- 2026-11-28 [優先度: 中] 途中で中止した依頼の進み具合が「100%(1/1)」と出て、同じ行の「残り2件は行っていません」と食い違う。
- 2026-11-28 [優先度: 低] 一時停止中なのに進み具合の文が「次の作業の開始を待っています。」になる(summaryLine.ts)。
- 2026-11-28 [優先度: 低] 許可を待っている作業が、ホームで「進めています」、進み具合で「実行中」と出る。
- 2026-11-28 [優先度: 低] 「npm install を実行して、…」で始まる作業の見出しが「npm install を実行して」で切れる。
- 2026-11-28 上の 5 件(許可の案内と「ホームを開いて許可する」ボタン、中止した依頼の割合と件数、一時停止中の文、許可待ちの作業の表示、「実行して」で切れる見出し)を修正。型チェックと全テスト 717 件が成功。試験用サーバーの画面(仮の AI、AI への送信なし)で 5 件とも表示を確認。まだインストーラーには入っていない(次の版で反映)。
- 2026-11-28 版 1.5.102 のインストーラーを作成(型チェックと全テスト 717 件成功、同梱の版・dist・テスト以外の server が一致)。内容: 承認と作業中の画面で見つけた 5 件の修正。インストール後の確認はまだ。
- 2026-11-28 インストール版 1.5.102 の確認(表示のみ、AI への送信なし): 版は 1.5.102 で、server と dist は作成したインストーラーと一致。ホーム・進み具合・これまでの記録を 2 プロジェクトで表示し、画面のエラー記録なし。今回の 5 件は、許可待ち・一時停止・作業のある中止の依頼が表示中のプロジェクトに無いため、インストール版の画面では未確認(修正時に試験用サーバーで確認済み)。
