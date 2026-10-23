# AUDIT_FEATURES

## 結論
現行機能は「手動バトンリレー+ローカル実行ボタン」が中核。AI選定は名前固定のキーワード規則で、AI発見・動的計画・検証・再開は存在しない。分類: KEEP / REUSE / REWRITE / REPLACE / REMOVE / UNKNOWN。

## 機能一覧と分類
| 機能 | 実装箇所(証拠) | 現状 | 分類 | 理由 |
|---|---|---|---|---|
| Project管理(タブ) | `ProjectTabs.tsx`、`NewProjectModal.tsx`、workflow.json `projects[]` | 複数Project、タブ切替 | REWRITE | 概念は新Projectへ移行。保存先をSQLiteに |
| Workflow(固定ステップ列) | `types/workflow.ts`、`WorkflowPane.tsx`、`App.tsx` | 順序+status(pending/active/done) | REPLACE | Task Graphへ置換。依存関係・分岐なし |
| ステップ追加 | `AddStepModal.tsx` 200行 | カテゴリ選択+AI推薦 | REMOVE候補 | 仕様§49で廃止指定。内部のbuild失敗(TS18047)あり |
| AIサービス管理 | `ai_services.json`(id/name/url のみ)、`SettingsModal.tsx` | 約35件の名前・URL | REWRITE | 能力・無料条件・検証日が無い。名前→Registry行へ移行可 |
| AI推薦(テキスト) | `ideaRecommendation.ts` 規則17件+既定ChatGPT | キーワード一致、先勝ち | REPLACE | AI名を直書き。語彙→能力の対応表のみ移植 |
| AI推薦(画像) | `imageRecommendation.ts` | 同上 | REPLACE | 同上 |
| タスクカテゴリ | `taskCategories.ts` | idea/requirements/review/coding/qa固定+推奨AI名 | REPLACE | 役割定義とプロンプト雛形は能力ベース雛形へ再利用 |
| プロンプト生成 | `PromptPane.tsx`、`prompt_template` | 入力ファイル本文を埋め込み | REUSE | 手動(Level 1)の中核。切り出して再利用 |
| 手動コピペ中継 | `PromptPane.tsx`(コピー→貼付→`PUT artifacts`保存) | 実装済み | KEEP/REUSE | 仕様の Level 1 フォールバックそのもの |
| Claude Codeコマンド生成 | `claudeCommand.ts`(37行、テスト有) | `-p --permission-mode acceptEdits` 固定付与 | REWRITE | 仕様§23。無条件付与をやめ権限別に |
| ローカル実行 | `POST /api/projects/:id/execute` | `exec(文字列)`、10分、20MB | REWRITE | 仕様§53 spawn化、権限段階 |
| 成果物一覧/表示 | `ArtifactsPane.tsx`、`GET artifacts[/*]` | 再帰一覧、Markdown/Shiki表示 | REUSE | ProvenanceとVersion無し |
| ファイル監視 | chokidar→WebSocket `fs-change` | workspace/とconfig監視 | KEEP | イベント層へ流用 |
| Ollama連携 | `/api/ollama/*`、`ollama.json`、PromptPane内ボタン | 非ストリーム生成、3分 | REUSE | 無料ローカルExecutorの種 |
| 実行履歴 | `logs/execution_history.json`(200件) | 成功率パネル | REWRITE | ai_runs/eventsテーブルへ |
| 複数AI試行 | `WorkflowStep.attempts` | 同一プロンプトを複数AIで比較 | UNKNOWN | 新設計のレビュー(§57)に相当する可能性。UX未精査 |
| ワークフローテンプレート | `workflowTemplate.ts`、`builtinTemplates.ts`(168行) | JSON出力/取込、テスト有 | REWRITE | Task Graphテンプレートへ変換 |
| アイデア入口 | `IdeaIntakeModal.tsx` | 「話す→AI提案」 | REPLACE | Mission入力に置換 |
| 画像生成補助 | `ImageGenModal.tsx` | AI推薦+プロンプト | UNKNOWN | 能力 image_generation の1事例。使用実態不明 |
| 設定/オンボーディング | `SettingsModal`、`WelcomeBanner` | | REWRITE | 設定は5画面構成へ |
| ZIP配布/起動bat | `package-dist.ps1`、`.bat`、`say.ps1` | Node自動導入 | KEEP | 配布導線として有用。配布対象に新構造を反映 |
| AI Discovery | 該当コード無し(`grep`で発見系なし) | **NOT_IMPLEMENTED** | 新規 | |
| Web AI自動操作 | 該当コード無し。リンクを開くだけ | **NOT_IMPLEMENTED** | 新規 | Playwright等も依存に無い |
| 検証/Retry/Resume/Pause/Lock/Cost Guard/Audit Log | 無し | **NOT_IMPLEMENTED** | 新規 | 履歴JSONのみ部分的に近い |

## 実機UI確認(2026-10-23、Viteで起動して画面確認)
- 初期画面は3ペイン(ワークフロー/プロンプト/成果物)。上部に説明バナー。**Mission入力欄は無く、最初に目に入るのは「Ideator」「ChatGPT (Web)」など固定ステップ**。
- 初心者が迷う点: AI名が最初から決まっている(「AIを選ばせない」仕様と逆)、手順が6ステップの案内文に依存、成果物の保存場所が相対パス表示。
- 評価(5点満点): 視認性 3 / 情報量 2(多い) / 操作数 2 / 初心者理解度 3 / 新設計との整合 1。※1回の起動確認による主観評価であり、他画面(設定・各モーダル)の操作は**未確認**。

## 未確認
- 各モーダル(アイデア・画像・追加)の個別操作
- Claude Code実機での自動開発到達度(PROGRESS記録では2026-08-27に実装まで完走。今回は再実行していない)
- `attempts` と ImageGen の利用実態

## 仮定
- ローカル実行方式は Phase 3 まで現行維持【仮定、ロードマップ§6】
