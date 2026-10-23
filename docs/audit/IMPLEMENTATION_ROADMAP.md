# 新AIオーケストラ 実装ロードマップ

作成日: 2026-10-23
基準文書: `新AIオーケストラ — ゼロベース再構築・完全実装仕様書.md`(以下「仕様書」)
補助文書: `新AIオーケストラ — 現行プロジェクト完全監査プロンプト.md`(以下「監査プロンプト」)

> **Phase 0(完全監査)は 2026-10-23 に完了**。詳細は同フォルダの AUDIT_*.md / REUSE / MIGRATION / DECISIONS / GAP_ANALYSIS / EXECUTIVE_SUMMARY を参照。本書はその結果を反映済み。残る `UNKNOWN` は EXECUTIVE_SUMMARY §14 に列挙。
>
> **監査で判明した重要事項**: APIサーバーが認証なしの任意コマンド実行を全インターフェース(`::`)で待ち受けていた(S-1/S-2)。**Phase 0.5 で解決済み。**

## 0. Phase 0 で確定したこと
- 空ディレクトリ8個(`.exe` `a` `actually` `expects` `install` `on` `Japanese` `Windows`)は中身なし。事故産物と推定、Phase 9 で削除(参照grep後)
- 移行方式は B(段階的リビルド)を推奨(合計20/25)
- 未コミット `config/*.json` はバックアップ後に保持【仮定】
- §6 の4点は全て仮定のまま進行(DECISIONS.md D-5〜D-9)

---

## 1. 2つの文書の関係

| 文書 | 役割 |
|---|---|
| 仕様書 | 目標アーキテクチャ(Mission → 動的Task Graph → AI Discovery/Broker/Executor → Artifact → Validation → Retry/Resume)と Phase 0〜10 |
| 監査プロンプト | 仕様書 Phase 0 の詳細手順。**実装禁止**、成果物は AUDIT_*.md など11文書+EXECUTIVE_SUMMARY.md。監査後に勝手にPhase 1へ進まない |

仕様書側の Phase 0 成果物は4文書(AUDIT/REUSE/MIGRATION/DECISIONS)、監査プロンプト側は11文書。**監査プロンプト側を採用**(上位互換)。

## 2. 現行システムの実測(2026-10-23)

| 項目 | 結果 |
|---|---|
| `npm test` | 5ファイル / 26テスト **全合格** |
| `npm run lint` | エラーなし、`set-state-in-effect` 警告多数(App.tsx 他) |
| `npm run build` | **失敗**: `src/components/AddStepModal.tsx(75,13) TS18047 'rec' is possibly 'null'` |
| Claude Code CLI | 2.1.309。`claude --help` で現行オプションを確認済み(Phase 3 で再検証) |
| git | `config/ai_services.json` `config/workflow.json` が未コミット変更(実行時データ) |
| SQLite / Mission / Task Graph / Broker / Discovery | **NOT_IMPLEMENTED**(依存関係にも無し) |

### 現行構成(証拠)
- `server/index.ts`(403行): Express + ws + chokidar。API は workflow/ai-services/ollama/execute/artifacts/history。
- `src/`: React 19 + Vite + Tailwind。`PromptPane.tsx`(47KB)が肥大化。`AddStepModal` / `WorkflowPane` / `ideaRecommendation.ts` / `imageRecommendation.ts` / `keywordRules.ts` / `taskCategories.ts` が固定Workflow+名前ベース推薦。
- データ: `config/workflow.json`(Project→steps→ai_name固定)、`config/ai_services.json`、`workspace/<projectId>/`、`workspace/<id>/logs/execution_history.json`。
- `legacy-ai-manager/`: 旧Electron版。node_modules込みで巨大。

### 仕様書チェックリストとの現状対比
| 仕様項目 | 現状 |
|---|---|
| Project分離 | **一部あり**: projectIdを `^[a-zA-Z0-9_-]+$` で制限、artifactsは `isPathInsideDir` で検査。シンボリックリンクは未確認 |
| Artifact保存/監視 | あり(chokidar+REST)。Provenance(§28)は無し |
| Claude Code実行 | あり(`exec` に文字列連結)。**仕様 §53 違反**(spawn+args でない)、権限段階(§24)無し、write lock無し |
| Manual fallback | あり(プロンプトコピー→返信貼り付け→保存)。**Level 1 として再利用価値高** |
| Ollama(ローカルLLM) | あり。無料・ローカルでCost Guard適合。Executor の1実装に昇格可能 |
| 実行履歴 | あり(JSON、直近200件)。events/ai_runs テーブルの種 |
| Retry上限/Resume/Pause | 無し |
| 認証・CORS | 無し(localhost単一ユーザー前提)。`PUT /api/workflow` はサーバー側でZod検証なし |

## 3. 再利用 / 再設計 / 廃止(暫定。Phase 0 で証拠付き確定)

### REUSE / KEEP
- Vite・React・TS・Tailwind・vitest・oxlint の基盤、`start-ai-orchestrator.bat` と package スクリプト(`concurrently`)
- Express+ws+chokidar の骨格、projectId検証・パス検査ロジック(§52)
- Artifact一覧/表示(`ArtifactsPane`、react-markdown、shiki)
- ManualフォールバックUI(PromptPane内の「コピー→貼り付け→保存」部分を抽出)
- Ollama連携(→ `CLIExecutor`/`LocalExecutor` 候補)
- 実行履歴ログ(→ `events` / `ai_runs`)
- Windows文字化け対策(`chcp 65001`)知見

### REWRITE / REPLACE
- `exec(string)` → `spawn(cmd, args)`+Permission Policy(§53, §24)
- `claudeCommand.ts` → `ClaudeCodeExecutor`(`-p`/`--permission-mode` を無条件適用しない)
- `PromptPane.tsx`(47KB)→ Mission/Development 画面へ分割再構築
- `workflow.json` 中心の状態管理 → SQLite + ファイルシステム(§44-45)
- 推薦ロジック(`ideaRecommendation` ほか)→ Capability-based Broker。キーワード→能力のマッピング表だけは移植価値あり

### REMOVE候補(参照元確認後に削除。§49-50)
- `AddStepModal`、固定Workflow編集UI、`builtinTemplates`/`workflowTemplate`(→ Task Graphテンプレートへ変換できる部分のみ移植)
- `ai_name` 固定の推薦ルール、`renameAiReferences`
- `legacy-ai-manager/`(退避済みの旧版。ユーザー確認の上で削除/アーカイブ)
- ルート直下の謎ディレクトリ `.exe` `a` `actually` `expects` `install` `on` `Japanese` `Windows`(8/30作成、用途UNKNOWN。Phase 0 で中身確認後に処分)
- `start.log` `server.log` `dist-release`(生成物。.gitignore化)

## 4. ロードマップ

規模: S=<2h / M=2-8h / L=1-2日 / XL=3-5日。各Phase完了条件は仕様書 §67/§74(実装+テスト+build+lint+動作確認+自己レビュー)。

### Phase 0 — 監査(**実装禁止**) 【済 2026-10-23】
- 成果物は `docs/audit/` の12文書(下記リストは当初計画。実施結果は EXECUTIVE_SUMMARY.md)
- 次の「Phase 0.5」(任意・推奨)を挟むかをユーザーが判断する

### Phase 0.5 — 緊急修正 【済 2026-10-23。ユーザー承認の上で実施】
- S-1: `listen(PORT, "127.0.0.1")` / S-2: `/execute` にHost・Origin検査と起動時トークン / S-4: PUTにZod検証
- build失敗(`AddStepModal.tsx:75` TS18047)の修正
- 結果: build成功、test 26件合格、実機で127.0.0.1限定・Host/Origin検査・トークン・PUT検証を確認(AUDIT_SECURITY.md)
- 現行を使い続ける間のみ意味がある修正。新設計で置き換わる部分は最小限にとどめた

#### Phase 0 当初の手順(参考)
- 先に build 失敗(TS18047)と未コミット config の扱いを決める(監査対象を安定させるため。修正は1行で可)
- 監査プロンプトの成果物を `docs/audit/` に作成: AUDIT_PROJECT_STRUCTURE / FEATURES / ARCHITECTURE / SECURITY / TESTS / DATA / REUSE / MIGRATION / DECISIONS / GAP_ANALYSIS / IMPLEMENTATION_ROADMAP / EXECUTIVE_SUMMARY
- 確認必須の未確認事項: 画面の実機UI評価、Claude Code実機の自動実行到達度、謎ディレクトリ、シンボリックリンク経由のパス逸脱、`PROGRESS.md`(62KB)の有効範囲、旧データ移行可否
- **ゲート**: ユーザーが EXECUTIVE_SUMMARY を承認するまで Phase 1 に進まない
- 推奨アーキテクチャ案: **B 段階的リビルド**(A既存最大活用は固定Workflow依存が残る、C完全新規は動作資産を捨てすぎる)。Phase 0 で最終確定

### Phase 1 — Core State 【済 2026-10-23(実データ適用 `--apply` のみ未実施・ユーザー確認待ち)】
実装: `server/core/`(schema/db/paths/store/legacyImport/cli)、テスト3ファイル(40件)。詳細は PROGRESS.md 2026-10-23(4回目)。

#### 当初計画
- SQLiteは **`node:sqlite`**(組み込み)を採用。スパイク済み: better-sqlite3 も動くが配布の安全性で劣後(DECISIONS D-11)。リポジトリ層で隔離し差し替え可能にする
- テーブル: projects/missions/tasks/ai_services/ai_capabilities/ai_runs/artifacts/validations/decisions/events/settings/locks
- 実データは `projects/<id>/` ファイル、DBはメタデータのみ(§45)
- Project分離テスト(Test 6)を先に書く
- 旧 workflow.json の **読み取り専用** インポータ(バックアップ→変換→検証、§51)

### Phase 2 — Orchestrator 【XL】
- Mission Engine、Planner、動的Task Graph、状態機械(§17)、Scheduler(並列2、コード編集1系統)
- Pause/Resume/Replan、Retry最大5、Write Lock
- Planner は A案(Claude Code が計画兼実行)で開始【仮定】

### Phase 3 — Claude Code / 実行基盤 【L】【実装済 2026-10-23(実機の claude 実行 Test 3/4 のみ未実施)、PROGRESS 7回目】
- `claude --help` 再確認、`ClaudeCodeExecutor`(spawn、timeout、kill、stdout/stderr/exit code)
- Permission Policy(READ / WORKSPACE_WRITE / NETWORK / DEPLOY / DESTRUCTIVE)、CommandRunner、承認フロー
- Validation L1〜L3(存在・構文・unit)、自己修復ループ
- Test 3/4 実施

### Phase 4 — AI Registry / Broker 【L】
- `ai_services.json` → レジストリ移行(名前→capabilities)、Health Check、Broker(重み4/3/2/1、confidence、A/B/C フォールバック)、Cost Guard(paid API = BLOCK)

### Phase 5 — AI Discovery 【L】
- 必要時のみ発見、無料条件判定、`free_status`/`last_verified_at` 保存(§5-7)
- 常時クロールはしない(MVP除外)

### Phase 6 — Web AI 自動化 【XL】
- Level 1(既存Manualを移植)→ Level 2 → Level 3、劣化時の自動降格
- CAPTCHA/認証回避は禁止(§11)。Level 3 は安定確認後のみ

### Phase 7 — UI 【L〜XL】(Phase 2 以降と並行可)
- 画面5つ: Mission / Development / Project History / Artifact Viewer / Settings
- Mission入力は1欄+「開発を開始」、詳細は折りたたみ(§13, §42)
- 現行 `PromptPane` の流用は最小限

### Phase 8 — 総合検証 【L】
- Unit/Integration/E2E(Browser)、Test 1〜7 全実施

### Phase 9 — 移行・掃除 【M】
- 旧データ変換完了を確認してから REMOVE候補を削除(代替機能が新側にあることを確認、§83)

### Phase 10 — 実環境E2E 【L】
- 「商品管理ができるシンプルなWebアプリを作って」を投入し最初から最後まで実行(§63)
- 最終報告(実装済み/未実装/既知問題/未確認/テスト/E2E/再利用/廃止/リスク)

## 5. 最大ボトルネックとリスク(暫定)

| # | ボトルネック | 影響 | 回避策 |
|---|---|---|---|
| 1 | 動的Task Graphの計画品質(Planner) | 不良グラフで全体が迷走 | 計画の検証(スキーマ+ユーザー承認ゲート)、Replan、最初は保守的な固定骨格+差分生成 |
| 2 | Web AI自動操作 | UI変更で頻繁に壊れる | Level 1 を常に動作保証、自動降格 |
| 3 | Claude Code CLI 非対話実行 | 権限/ログイン状態/長時間実行 | Phase 3 で実機検証、timeout・kill・再ログイン検知 |
| 4 | `better-sqlite3` のWindowsビルド | Phase 1 が詰まる | 先にスパイク。代替 `node:sqlite` |

## 6. 判断が必要な点(Phase 0 開始前)
1. `legacy-ai-manager/` と謎ディレクトリ(`.exe` `a` `actually` 他)の扱い
2. 未コミットの `config/*.json` はコミット / 破棄 / 保持のどれか
3. Phase 0 は私が単独で進めるか(推奨)、別セッションに切り出すか
4. 仕様書と違い、現行の「ローカル実行」はユーザー承認ボタン方式。Phase 3 までは現行方式を維持してよいか【仮定: 維持】
