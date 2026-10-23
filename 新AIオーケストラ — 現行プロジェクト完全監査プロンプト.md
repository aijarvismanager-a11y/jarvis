# 新AIオーケストラ
## 現行プロジェクト完全監査プロンプト

あなたは本プロジェクトのシニアソフトウェアアーキテクト兼コード監査責任者です。

現在開発中の「新AIオーケストラ」を、今後ゼロベースで再設計・再構築します。

ただし、いきなり実装・削除・大規模改修を行ってはいけません。

今回の作業目的は、

> **現在のプロジェクトを完全に調査し、何を残し、何を作り直し、何を捨て、何を追加すべきかを確定すること**

です。

---

# 1. 今回の絶対ルール

## 実装禁止

今回の監査では原則として以下を行わない。

- 大規模なコード変更
- ファイル削除
- データ削除
- アーキテクチャ変更
- UI全面改修
- 依存関係の大量変更
- workflowの廃止
- 既存機能の破壊

必要な場合でも、まず監査結果へ記録する。

---

# 2. 最初にやること

リポジトリ全体を調査する。

対象：

```text
/
├─ package.json
├─ README
├─ PLAN
├─ PROGRESS
├─ CLAUDE.md
├─ config/
├─ server/
├─ src/
├─ workspace/
├─ tests/
├─ scripts/
└─ その他すべて
```

存在するものだけ調査する。

ディレクトリ名を決め打ちしない。

---

# 3. プロジェクト構成を把握

まず、

```text
tree
```

相当の情報を取得する。

ただし、

- node_modules
- .git
- ビルド成果物
- キャッシュ
- 巨大な生成ファイル

などは除外してよい。

結果を、

`AUDIT_PROJECT_STRUCTURE.md`

へ保存する。

---

# 4. 技術スタック監査

以下を確認。

- OS想定
- Node.js
- npm
- TypeScript
- React
- Vite
- Tailwind
- Express
- SQLite
- Electron
- Tauri
- Claude Code
- その他依存関係

package.jsonだけを信用しない。

実際のコードから使用状況も確認する。

---

# 5. 実際の実行方法を確認

以下を確認する。

```powershell
npm install
npm run start
npm run dev
npm run server
npm run test
npm run build
npm run lint
```

存在するコマンドだけ実行する。

また、

```powershell
claude --help
```

を実行し、現在インストールされているClaude Code CLIの実際の仕様を確認する。

現在の仕様書や過去の記録に書かれているCLIオプションを、そのまま信用してはいけない。

---

# 6. 現在の機能一覧

現在存在する機能を全部洗い出す。

最低限、

```text
Project管理
Workflow
Task
AI Service
AI推薦
Artifact
File Watcher
Claude Code
Prompt
Command
Browser
ログ
設定
```

について確認する。

ただしこれ以外も発見したら追加する。

---

# 7. 各機能を分類

すべての主要機能を以下へ分類する。

```text
KEEP
REUSE
REWRITE
REPLACE
REMOVE
UNKNOWN
```

意味：

### KEEP
そのまま残せる。

### REUSE
コード・ロジック・UIなどを新設計へ流用できる。

### REWRITE
考え方は使えるが実装を作り直す。

### REPLACE
新しい仕組みに置き換える。

### REMOVE
新システムでは不要。

### UNKNOWN
調査不足で判断できない。

---

# 8. 判断には必ず証拠を付ける

例えば、

```text
File:
src/components/AddStepModal.tsx

Classification:
REPLACE

Reason:
旧Workflow中心設計に依存している。

Evidence:
AddStepModalからworkflow.stepsへ直接アクセスしている。

Impact:
Mission/Task Graph中心設計へ移行する場合、そのままでは使用できない。

Unknown:
既存UIの一部コンポーネントは再利用可能な可能性あり。
```

という形式にする。

---

# 9. 「不要そう」という推測だけで削除判定しない

以下を確認する。

```text
参照元
参照先
API
UI
データ
テスト
設定
```

どこからも使われていないことを確認してから、

`REMOVE候補`

とする。

---

# 10. 現在のWorkflow設計を完全調査

特に重要。

現在の、

```text
config/workflow.json
```

および関連コードを調査。

確認：

- schema
- project構造
- step構造
- status
- input
- output
- prompt
- command
- AI
- role
- next step
- persistence
- API
- UI依存

を全部把握する。

---

# 11. Workflowの問題点

現在の固定Workflow方式が、

新しい

```text
Mission
↓
Dynamic Task Graph
```

へ移行するときに、

- 何が利用できるか
- 何が障害になるか
- 何を変換できるか
- 何を捨てる必要があるか

を明確にする。

---

# 12. 現在のProject分離機能を監査

現在のProject単位の分離について、

```text
Project ID
Workspace
Artifacts
Commands
API
UI
File paths
```

を確認。

特に、

> Project AのファイルがProject Bへ混ざる可能性

がないか調査する。

---

# 13. Artifact管理を監査

以下を確認。

- 保存方法
- ファイルWatcher
- API
- UI
- パス処理
- project prefix
- 更新検知
- 同時更新
- 破損時
- 削除時
- 大容量ファイル

新設計のArtifact中心方式へ再利用できるか判断する。

---

# 14. Claude Code連携を完全監査

確認：

```text
起動方法
コマンド生成
引数
cwd
環境変数
権限
stdout
stderr
終了コード
timeout
process kill
retry
error handling
```

さらに、

> Claude Codeが実際にどこまで自動開発できる状態なのか

を確認する。

---

# 15. 危険な実装を確認

以下がないか確認する。

- 任意Shell実行
- ユーザー入力の直接Shell連結
- path traversal
- 危険な削除
- 無制限command
- 無制限process
- 無制限retry
- 外部通信の無制限許可
- 秘密情報のログ出力

発見したら、

`SECURITY_FINDINGS.md`

へ記録する。

---

# 16. 現在のAI管理機能

以下を完全調査。

```text
ai_services.json
AI登録
AI推薦
カテゴリー
キーワード
URL
prompt
AI link
```

特に、

> AIを名前で固定管理している箇所

を全部発見する。

---

# 17. AI推薦ロジック

現在のAI推薦について、

```text
入力
↓
判定
↓
キーワード
↓
カテゴリー
↓
推薦AI
```

を解析する。

現在の推薦ロジックを、

**新しいCapability-based Brokerへ移行できる部分**

と、

**廃止すべき部分**

に分ける。

---

# 18. AI Discoveryの有無

現在、

> 新しいAIを発見する仕組み

が存在するか確認。

存在しなければ、

`NOT_IMPLEMENTED`

と明記。

推測で「ある」としてはいけない。

---

# 19. Web AI自動化

現在のシステムが、

- AIサイトを開く
- プロンプト入力
- 送信
- 結果取得
- 貼り付け
- 保存

のどこまでできるか確認。

存在しないものは、

`NOT_IMPLEMENTED`

とする。

---

# 20. Manual fallback

現在、

```text
AIを開く
↓
プロンプトコピー
↓
ユーザーがAIへ入力
↓
結果を貼る
↓
保存
```

がどこまで実装されているか確認。

これは新システムでもFallbackとして利用価値があるため、詳細に評価する。

---

# 21. UI監査

現在の画面を実際に起動して確認する。

確認：

- Missionをどこで入力するか
- Project選択
- Step選択
- AI選択
- Prompt
- Artifact
- Logs
- Settings
- Error
- Progress

特に、

> 初心者が「何をすればいいか分からない」箇所

を記録する。

---

# 22. UI評価

各画面を、

```text
視認性
情報量
操作数
初心者理解度
自動化との整合性
```

で5点評価。

---

# 23. テスト監査

存在するテストを全部調査。

分類：

```text
Unit
Integration
E2E
UI
API
Security
Migration
```

各テストについて、

```text
何を保証しているか
何を保証していないか
```

を確認。

---

# 24. 実際にテストする

存在する場合：

```powershell
npm test
npm run build
npm run lint
```

等を実行。

実際の結果を記録。

過去の「テスト成功」という記録だけを信用しない。

---

# 25. 未テスト領域

以下について、

```text
未テスト
部分テスト
十分
```

を判定。

特に：

- restart
- resume
- project isolation
- AI failure
- command failure
- file corruption
- concurrent execution
- retry
- migration

---

# 26. データ監査

現在存在する、

- JSON
- DB
- workspace
- logs
- config
- artifacts

を調査。

重要データを列挙する。

---

# 27. 移行可能性

現在のデータを新設計へ移行できるか判定。

例：

```text
Old Project
↓
New Project

Old Step
↓
New Task

Old Artifact
↓
New Artifact

Old AI
↓
AI Registry
```

変換できない場合は理由を書く。

---

# 28. 既存コードの再利用価値

以下を5段階評価。

```text
再利用価値
保守性
品質
依存度
移行コスト
```

---

# 29. 新アーキテクチャとの差分

現在：

```text
Mission
?
Workflow
Step
AI
Artifact
```

目標：

```text
Mission
 ↓
Planner
 ↓
Task Graph
 ↓
AI Discovery
 ↓
AI Broker
 ↓
Executor
 ↓
Artifact
 ↓
Validator
 ↓
Retry/Replan
```

現在と目標の差分を明示する。

---

# 30. 新規実装項目

現在存在しないが、新システムに必要なものを列挙。

最低限：

```text
Mission Engine
Planner
Task Graph
Task Scheduler
AI Capability Registry
AI Discovery
AI Broker
AI Health Check
AI Executor abstraction
Claude Code Executor
Permission Policy
Artifact Provenance
Validator
Retry Manager
Resume Manager
Lock Manager
Cost Guard
Audit Log
```

---

# 31. 移行難易度

各項目を、

```text
LOW
MEDIUM
HIGH
```

で評価。

さらに、

```text
推定工数
依存関係
リスク
```

を記録。

時間は可能なら、

```text
<2h
2-8h
1-2days
3-5days
>5days
```

程度で分類する。

---

# 32. 最終アーキテクチャ案

監査結果を踏まえ、

> 現在のコードを最も安全に新設計へ移行するアーキテクチャ

を提案する。

ただし、現在の設計を無理に残す必要はない。

---

# 33. 3案を比較

必ず以下を比較する。

### A
既存資産最大活用

### B
段階的リビルド

### C
ほぼ完全新規

各5段階評価：

```text
効果
コスト
実装難度
リスク
保守性
```

最終推奨を1つ選ぶ。

---

# 34. Bottleneck分析

最大のボトルネックを最低3つ特定する。

例：

```text
1. Claude Code CLI制御
2. Web AI自動操作
3. Dynamic Task Graph
```

それぞれ、

```text
原因
影響
回避策
```

を書く。

---

# 35. 重要な代替案

少なくとも3つ提示。

例えば、

```text
A: Claude CodeをPlanner兼Executor
B: 専用Plannerを別AIにする
C: ユーザー承認型Planner
```

比較して推奨する。

---

# 36. 仮説

監査時に、

> このシステムで最も大きな問題は何か？

について仮説を立てる。

さらに、

```text
仮説
検証方法
結果
別仮説
```

を記録する。

---

# 37. 最終成果物

監査完了時、最低限以下を作成。

```text
AUDIT_PROJECT_STRUCTURE.md
AUDIT_FEATURES.md
AUDIT_ARCHITECTURE.md
AUDIT_SECURITY.md
AUDIT_TESTS.md
AUDIT_DATA.md
REUSE.md
MIGRATION.md
DECISIONS.md
GAP_ANALYSIS.md
IMPLEMENTATION_ROADMAP.md
```

---

# 38. 各文書に必ず含めるもの

```text
結論
根拠
証拠
影響
未確認事項
仮定
リスク
```

---

# 39. 監査結果の最終サマリー

最後に、

# EXECUTIVE_SUMMARY.md

を作る。

内容：

```text
現在何があるか

何が正常か

何が問題か

何が再利用できるか

何を捨てるべきか

何を新規実装するか

最大リスク

推奨アーキテクチャ

推奨移行方式

実装順序

未確認事項
```

---

# 40. 重要：まだ実装しない

今回の最終状態は、

> 「これで安全に再構築を始められる」

ところまで。

監査終了後に、

**勝手にPhase 1実装へ移行しない。**

---

# 41. 最終報告形式

最後のClaude Code報告は必ず以下の形式。

```text
# 監査完了

## 1. 現在の状態

## 2. 正常な部分

## 3. 問題点

## 4. 再利用するもの

## 5. 作り直すもの

## 6. 廃止候補

## 7. 新規実装が必要なもの

## 8. セキュリティ問題

## 9. テスト状況

## 10. 移行リスク

## 11. 推奨アーキテクチャ

## 12. 推奨移行方式

## 13. 最大ボトルネック

## 14. 未確認事項

## 15. 次の実装フェーズ
```

---

# 42. 監査成功条件

以下をすべて満たすこと。

- [ ] リポジトリ全体を確認
- [ ] 技術スタック確認
- [ ] 実行方法確認
- [ ] Claude Code CLI確認
- [ ] 現在機能一覧作成
- [ ] Workflow完全調査
- [ ] Project分離確認
- [ ] Artifact確認
- [ ] Claude Code連携確認
- [ ] AI推薦確認
- [ ] Web AI確認
- [ ] UI確認
- [ ] テスト確認
- [ ] データ確認
- [ ] セキュリティ確認
- [ ] 再利用判定
- [ ] 廃止判定
- [ ] 新規実装項目
- [ ] 移行方法
- [ ] ボトルネック
- [ ] 3案比較
- [ ] 未確認事項
- [ ] E2E可能性
- [ ] 最終推奨

---

# 43. 絶対禁止

以下は禁止。

```text
「たぶん」
「おそらく」
「問題なさそう」
「使えそう」
```

根拠を確認できない場合は、

```text
UNKNOWN
未確認
推定
```

と明示する。

---

# 44. 最終原則

今回の目的は、

> **現在のコードを褒めることでも、全部捨てることでもない。**

目的は、

> **新AIオーケストラを最短・安全・低コストで完成させるために、現在の資産を正しく評価すること。**

である。

監査結果に基づいてのみ、次の再構築フェーズへ進むこと。