# EXECUTIVE_SUMMARY(Phase 0 監査 / 2026-10-23)

## 監査完了(監査プロンプト§41形式)

### 1. 現在の状態
React+Vite のSPAと単一Expressサーバー。固定ステップのワークフローを人手で進める「手動バトンリレー」アプリ。約4,200行(src)+403行(server)。test 26件合格、lint エラー0、**build失敗**(`AddStepModal.tsx:75` TS18047)。Mission/Task Graph/DB/AI Discovery/Web AI自動操作/検証/再開は**NOT_IMPLEMENTED**。

### 2. 正常な部分
プロジェクト単位のworkspace分離(projectId検証・パス検査)、成果物の表示、ファイル監視、手動コピペ中継、Ollama連携、ZIP配布導線、既存vitest/oxlint基盤。

### 3. 問題点
固定Workflow+AI名固定の設計、`PromptPane.tsx` 1,065行、build失敗、workflow.jsonの無検証全置換、未コミットconfig、ルート直下の空ディレクトリ8個。

### 4. 再利用するもの
基盤一式、Express/chokidar骨格、パス検査、Artifact表示、手動中継(Level 1)、Ollama、ai_services.jsonのURL一覧、配布スクリプト。(REUSE.md)

### 5. 作り直すもの
実行基盤(`exec`→spawn+権限)、Claude Codeコマンド生成、状態管理(JSON→SQLite)、実行履歴、推薦ロジック、テンプレート、UI全体(Mission中心)。

### 6. 廃止候補
AddStepModal/IdeaIntakeModal/WorkflowPane、AI名固定推薦、`legacy-ai-manager/`、空ディレクトリ8個。(旧記載の「テスト残骸プロジェクト2件」は誤り=実プロジェクトと判明、移行対象)削除は代替確認後(Phase 9)。

### 7. 新規実装が必要なもの
GAP_ANALYSIS.md の24項目(Mission Engine、Planner、Task Graph、Registry/Broker/Discovery/Health、Executor抽象、Permission、Validator、Retry、Resume、Lock、Cost Guard、Audit Log ほか)。

### 8. セキュリティ問題
**【2026-10-23 Phase 0.5 で S-1/S-2/S-4 は解決済み。AUDIT_SECURITY.md 冒頭参照。build失敗も解消】** 以下は監査時点の記述。
**S-1/S-2(高)**: 認証なしの任意コマンド実行APIが全インターフェース(`::`)で待ち受け。LANから到達できる可能性(ファイアウォール実設定は未確認)。他: シェル文字列直結、PUT無検証、npm audit 4件(重大1)。(AUDIT_SECURITY.md)

### 9. テスト状況
Unit 5ファイルのみ。サーバー・UI・E2E・分離・再開・移行は未テスト。(AUDIT_TESTS.md)

### 10. 移行リスク
未コミットconfig、実利用データ(soccer-japan-team)、`ai_name`のRegistry照合。手順は backup→変換→検証→削除。(MIGRATION.md)

### 11. 推奨アーキテクチャ
ローカルWebアプリ(React+Node+SQLite)。移行方式は **B 段階的リビルド**(合計20/25、A 16、C 15)。

### 12. 推奨移行方式
新コアを並置して構築→旧workflow.jsonを読み取り変換→新UIで確認→旧機能を削除。

### 13. 最大ボトルネック
Claude Code非対話実行の制御 / 動的Task Graphの計画品質 / Web AI自動操作 / `PromptPane.tsx` 肥大。

### 14. 未確認事項
- 2つの未コミットconfigの差分内容
- 空ディレクトリ8個の生成元(推定のみ)とその参照有無のgrep
- symlink/Windows特殊パスでの逸脱、WebSocketのOrigin、DNSリバインディング
- Windowsファイアウォールによる4173番の実際の遮断状況
- npm audit の重大1件の対象パッケージ
- better-sqlite3 の Windows/Node 24 ビルド可否
- 他画面(設定・各モーダル)の実機操作、`attempts`/ImageGen の利用実態
- `legacy-ai-manager/data` の有用データ有無
- 工数見積の実測検証

### 15. 次の実装フェーズ
1. ~~セキュリティ緊急修正 S-1〜S-4 と build修正~~ → Phase 0.5 で実施済み(S-3はPhase 3で対応)。
2. Phase 1 — Core State(SQLite)。先に better-sqlite3 スパイク。
実装は本監査後も**自動では開始しない**。

## 仮定(ロードマップ§6、ユーザー許可済み)
D-5〜D-9(DECISIONS.md)。

## 監査成功条件の自己確認
全項目を実施。ただし次は**部分的**: UI確認(初期画面のみ)、Claude Code連携(コード確認+CLIバージョン確認。実機の自動開発は再実行せず記録参照)、セキュリティ(静的確認と1件の実機確認)、データ(未コミット差分未精査)。E2E可能性: 仕様§63のE2Eは Phase 2〜3 完了後に可能、現行では不可。
