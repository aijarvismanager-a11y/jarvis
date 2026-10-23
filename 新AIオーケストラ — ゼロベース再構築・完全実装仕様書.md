# 新AIオーケストラ
## Zero-Based Autonomous AI Development Orchestrator
### Claude Code 実装用・マスター仕様書

**Version:** 1.0  
**作成日:** 2026-09-15  
**目的:** 「作りたいもの」を1回入力するだけで、AIの選定・調査・設計・実装・テスト・修正・レビューまでを可能な限り自動的に進行させる無料・ローカルファーストの開発オーケストレーターを構築する。

---

# 0. Claude Codeへの最重要指示

あなたはこの仕様書を実装する開発責任者である。

ただし、**現在存在するコードをそのまま正解として扱ってはいけない。**

現在の実装は、

- 再利用可能な資産
- 既存機能
- 既存テスト
- 既存UI
- 既存バグ
- 既存設計

を調査するための**参考資料**であり、新システムの設計そのものではない。

したがって最初に、

1. 現在のリポジトリを完全監査
2. 再利用するもの
3. 改修するもの
4. 廃止するもの
5. 新規作成するもの

を判断する。

**いきなり大量のコードを書き始めないこと。**

ただし、不要な確認質問をユーザーへ大量に投げて作業を停止してはいけない。

仕様から合理的に判断できるものは自分で判断する。

不明点は、

`【仮定】`

として記録し、実装を進める。

---

# 1. 要約

## 最終的にユーザーが行う操作

基本操作はこれだけ。

> 「○○を作って」

必要に応じて、

- 使用技術
- 予算
- 制約
- 公開方法

などを追加できる。

その後システムが、

```text
Mission
 ↓
要件分析
 ↓
開発計画
 ↓
必要AIの判断
 ↓
AI発見・選定
 ↓
調査
 ↓
設計
 ↓
Claude Code実装
 ↓
テスト
 ↓
問題発見
 ↓
Claude Code修正
 ↓
再テスト
 ↓
レビュー
 ↓
完成
```

まで進める。

---

# 2. 最重要設計原則

## 2.1 ユーザーにAIを選ばせない

現在の、

> この作業にはChatGPT  
> 次はClaude  
> 次はGemini

という方式を中心にしない。

ユーザーが指定するのは原則として、

**「何を作りたいか」**

だけ。

AI選定はオーケストレーターが行う。

---

## 2.2 AI名ではなく能力で管理する

AIを、

```text
ChatGPT
Gemini
Claude
Perplexity
Grok
Manus
```

のような名前だけで管理しない。

以下のような能力で管理する。

```text
research
architecture
coding
debugging
ui_design
ux_review
image_generation
seo
security
fact_check
data_analysis
translation
testing
documentation
marketing
```

例えば、

```text
Task:
最新のWeb技術を調査する
```

なら、

```text
必要能力:
research
web_search
technical_analysis
```

から候補AIを探す。

---

# 3. Claude Codeの役割

Claude Codeは単なる「コードを書くAI」ではない。

本システムでは、

## Lead Developer

として扱う。

担当範囲：

- リポジトリ調査
- 要件分析
- 技術選定
- アーキテクチャ設計
- タスク分解
- コード実装
- テスト実行
- バグ修正
- リファクタリング
- 統合
- 最終レビュー

つまり、

> **開発の中心脳＋実装エンジン**

とする。

---

# 4. AIの役割分担

Claude Codeだけですべてを行うのではなく、必要に応じて外部AIを利用する。

例：

| 能力 | 候補 |
|---|---|
| 実装 | Claude Code |
| 深い調査 | Web AI |
| 最新情報 | Web検索系AI |
| UIアイデア | UI特化AI |
| 画像生成 | 画像生成AI |
| SEO | SEO分析系AI |
| セキュリティ | Security系AI |
| 翻訳 | 翻訳系AI |
| ファクトチェック | Research系AI |

ただし、**固定割当は禁止。**

毎回、

```text
Task
↓
必要能力
↓
候補検索
↓
利用可能性確認
↓
品質評価
↓
最適AI選択
```

とする。

---

# 5. 「世界中のAIを探す」の現実的な実装

「世界中のAIを常時すべて把握する」という仕様にはしない。

これは技術的にも運用的にも非現実的。

代わりに、

## On-Demand AI Discovery

方式を採用する。

### 流れ

```text
必要能力が発生
↓
既存AI Registry検索
↓
適切なAIが存在
→ 使用

存在しない
↓
公開Web情報から候補探索
↓
候補評価
↓
無料利用条件確認
↓
対応能力登録
↓
AI Registryへ保存
↓
使用
```

これにより、

**必要なAIだけ増えていく。**

---

# 6. AI Registry

AI情報をSQLiteに保存する。

最低限以下を持つ。

```text
id
name
url
provider
capabilities
languages
access_mode
automation_level
free_status
free_limit
requires_login
requires_api_key
api_cost
quality_score
reliability_score
last_verified_at
adapter_type
limitations
status
```

---

# 7. 無料条件

「無料」と「無料無制限」を混同しない。

例えば、

```text
free_status:
free
free_tier
trial
paid
unknown
```

と分類する。

API課金が必要なサービスはデフォルトでは使用しない。

---

# 8. API課金禁止ポリシー

初期仕様では、

> **APIキーを要求する有料AI/APIは自動利用しない。**

特に、

- OpenAI API
- Anthropic API
- Gemini API
- その他従量課金API

などを勝手に使用しない。

ユーザーが明示的に許可した場合のみ将来的に拡張可能。

---

# 9. AIアクセス方式

AIへのアクセス方式を統一インターフェース化する。

```text
Web
CLI
Local
Browser
Manual
API
```

ただしAPIはデフォルト無効。

---

# 10. Web AI自動操作

Web AIはUI変更が頻繁に発生するため、3段階にする。

## Level 3 — Full Auto

```text
ページを開く
↓
入力
↓
送信
↓
待機
↓
結果取得
↓
保存
```

## Level 2 — Semi Auto

```text
ページを開く
↓
プロンプト入力
↓
ユーザーが送信
↓
結果取得/貼り付け
```

## Level 1 — Manual

```text
AIページを開く
↓
プロンプトを表示
↓
ユーザーが操作
↓
結果を保存
```

AI側UI変更によってLevel 3が壊れた場合、

**自動的にLevel 2 → Level 1へ降格可能**

とする。

オーケストレーター全体を停止させない。

---

# 11. 禁止事項

以下を自動化しない。

- CAPTCHA突破
- Bot対策突破
- パスワード取得
- Cookie窃取
- セッション情報窃取
- 認証回避
- 不正アクセス
- セキュリティ制限回避

ログインが必要なら、

> ユーザーが通常のブラウザ操作でログインする

方式を基本とする。

---

# 12. Mission

すべての開発はMissionから始まる。

例：

```text
Mission:
プロレスの歴史を検索・閲覧できるWebサイトを作って
```

Missionには、

```text
id
goal
constraints
budget_policy
technology_preferences
created_at
status
```

を持たせる。

---

# 13. Mission入力UI

最初の画面は極力シンプルにする。

```text
何を作りますか？

[ プロレスの歴史を検索できるWebサイトを作って       ]

[ 開発を開始 ]
```

詳細設定は折りたたみ。

初期画面に大量の、

- AI選択
- ワークフロー設定
- モデル設定
- API設定

を表示しない。

---

# 14. 自動計画

Missionを受け取ったらClaude Codeを中心に分析する。

出力：

```text
Project
Requirements
Architecture
Task Graph
Risks
Required Capabilities
```

---

# 15. Task Graph

固定Workflowではなく、

**動的Task Graph**

を使用する。

例：

```text
Mission
 ├─ Research
 │   ├─ Market Research
 │   └─ Technical Research
 │
 ├─ Requirements
 │
 ├─ Architecture
 │
 ├─ UI Design
 │
 ├─ Implementation
 │   ├─ Frontend
 │   ├─ Backend
 │   └─ Database
 │
 ├─ Testing
 │
 ├─ Debugging
 │
 └─ Final Review
```

プロジェクトによって内容は変化する。

---

# 16. Task Contract

各Taskは以下の形式で管理する。

```json
{
  "task_id": "task-001",
  "project_id": "project-001",
  "role": "research",
  "objective": "",
  "inputs": [],
  "expected_outputs": [],
  "constraints": [],
  "selected_ai": null,
  "automation_level": 1,
  "status": "pending",
  "retry_count": 0,
  "validation": null,
  "next_tasks": []
}
```

---

# 17. Task状態

```text
pending
ready
running
waiting
validation
completed
failed
blocked
cancelled
```

---

# 18. AI Broker

Taskに対して最適AIを決定する。

評価項目：

| 項目 | 重み |
|---|---:|
| 能力適合 | 4 |
| 品質・信頼性 | 3 |
| 自動化適合 | 2 |
| 安全性・リスク | 1 |

合計10点換算。

例えば、

```text
Capability Fit      5 × 4 = 20
Quality             4 × 3 = 12
Automation          3 × 2 = 6
Safety              5 × 1 = 5

Total = 43
```

候補を比較して最高点を採用。

---

# 19. AI選定の代替候補

最低3候補を比較可能にする。

### A：品質優先
- 効果：5
- コスト：1
- 実装難度：3
- リスク：2

### B：自動化優先
- 効果：4
- コスト：2
- 実装難度：4
- リスク：3

### C：完全無料・手動Fallback優先
- 効果：3
- コスト：5
- 実装難度：2
- リスク：1

初期方針：

**Aを基本、B/Cへ自動フォールバック。**

---

# 20. AI Discovery

Discoveryモジュールを独立させる。

```text
AIRegistry
AIDiscovery
AIHealthChecker
AIBroker
AIExecutor
```

を分離する。

### AIDiscovery

入力：

```text
required_capabilities
language
free_required
automation_required
```

出力：

```text
candidate A
candidate B
candidate C
```

---

# 21. AI Health Check

使用前に確認する。

```text
URLアクセス可能
無料条件
ログイン状態
UI利用可能
能力一致
自動操作可能性
```

異常なら候補から除外。

---

# 22. AI Executor

AI実行を抽象化する。

```typescript
interface AIExecutor {
  execute(task: TaskContract): Promise<TaskResult>
}
```

実装例：

```text
BrowserAIExecutor
CLIExecutor
ClaudeCodeExecutor
ManualExecutor
```

---

# 23. Claude Code Executor

Claude CodeのCLI仕様を固定値で決め打ちしない。

実装時に、

```powershell
claude --help
```

等で現在のCLI仕様を確認する。

使用可能なオプションを検証してから実装する。

特に現在の、

```text
-p
--permission-mode acceptEdits
```

などを無条件で全処理に適用しない。

---

# 24. Permission Policy

権限を段階化する。

```text
READ
WORKSPACE_WRITE
NETWORK
DEPLOY
DESTRUCTIVE
```

通常開発：

```text
READ
WORKSPACE_WRITE
```

必要な場合のみ：

```text
NETWORK
```

デプロイ：

```text
DEPLOY
```

削除・破壊的変更：

```text
DESTRUCTIVE
```

---

# 25. ユーザー承認が必要な操作

以下は原則として停止して確認する。

- 本番デプロイ
- 外部サービスへの公開
- 大量削除
- 課金発生
- APIキー登録
- 外部アカウント変更
- 不可逆操作

それ以外は可能な限り自動化。

---

# 26. Artifact中心設計

AI同士を直接大量に会話させない。

基本は、

```text
AI
 ↓
Artifact
 ↓
次Task
 ↓
AI
```

とする。

これにより、

- 再開
- 監査
- バージョン管理
- エラー復旧
- AI変更

が容易になる。

---

# 27. Project構造

基本構造：

```text
projects/
  project-001/
    mission.md
    requirements/
    research/
    architecture/
    design/
    code/
    assets/
    tests/
    reviews/
    handoffs/
    decisions/
    logs/
    final/
```

ただし、

**物理ディレクトリ構造をUIの中心にはしない。**

ユーザーには必要な成果物だけ分かりやすく表示する。

---

# 28. Provenance

すべての重要Artifactについて、

```text
created_by
created_at
source_task
source_ai
source_url
version
validation_status
```

を記録する。

これにより、

> この情報はどこから来たのか？

を追跡できる。

---

# 29. Decision Log

重要判断を記録する。

例：

```text
Decision:
React + TypeScriptを採用

Reason:
既存資産を再利用でき、保守性が高い

Alternatives:
Vue
Svelte

Rejected because:
既存コードとの互換性
```

---

# 30. Validation

AIが成果物を作っただけでは完了扱いにしない。

必ず、

```text
生成
↓
検証
↓
合格
```

とする。

---

# 31. 検証レイヤー

## Level 1

ファイル存在確認。

## Level 2

形式・構文確認。

## Level 3

Unit Test。

## Level 4

Integration Test。

## Level 5

Browser/E2E Test。

## Level 6

AI Review。

重要成果物ほど上位検証を行う。

---

# 32. 自己修復

テスト失敗時：

```text
Test
 ↓
Failure
 ↓
Claude Code解析
 ↓
修正
 ↓
Test
```

最大5回。

```text
retry_count >= 5
```

なら、

```text
blocked
```

としてユーザーへ報告。

**無限ループ禁止。**

---

# 33. 失敗時の情報

必ず、

```text
何が失敗したか
原因候補
実施した修正
再テスト結果
残っている問題
```

を保存。

---

# 34. Restart / Resume

アプリを閉じても開発状態を失わない。

再起動時：

```text
Project
↓
Mission
↓
Task Graph
↓
最後のTask
↓
状態復元
```

から再開する。

---

# 35. 中断

ユーザーが、

> 一旦止める

ことができる。

停止後、

```text
running → paused
```

として保存。

再開可能。

---

# 36. Mission変更

開発途中で、

> 「やっぱりスマホ対応も追加して」

などが発生した場合、

現在のTask Graphを破棄しない。

```text
現在状態
↓
Mission変更
↓
影響分析
↓
Task Graph再計画
↓
追加・変更Task生成
```

とする。

---

# 37. 並列処理

何でも並列化しない。

初期値：

```text
最大並列Task = 2
```

とする。

コード編集は原則1系統。

---

# 38. Code Write Lock

Claude Codeがコードを書いている間、

他AIは同じコードを直接変更しない。

```text
Claude Code
= write lock owner
```

他AI：

```text
read
review
suggest
```

のみ。

---

# 39. UI

UIの中心は、

**AI一覧ではない。**

中心は、

> 今何を作っているか

とする。

---

# 40. メイン画面

```text
┌────────────────────────────────────┐
│ 新AIオーケストラ                     │
├────────────────────────────────────┤
│                                    │
│ プロジェクト                        │
│ プロレス歴史サイトを作る             │
│                                    │
│ ━━━━━━━━━━━━━━━ 62%                │
│                                    │
│ 現在                                │
│ Claude Code が実装中                │
│                                    │
│ ✓ 要件分析                          │
│ ✓ 技術調査                          │
│ ✓ UI設計                            │
│ ● 実装                              │
│ ○ テスト                            │
│ ○ 最終レビュー                       │
│                                    │
├────────────────────────────────────┤
│ 最近の成果物                         │
│ requirements.md                     │
│ architecture.md                     │
│ design.md                           │
│                                    │
└────────────────────────────────────┘
```

---

# 41. AI表示

AI情報は必要なときだけ表示。

通常：

```text
現在の担当
Claude Code
```

詳細を開くと、

```text
使用AI
役割
能力
実行状態
自動化レベル
```

を表示。

---

# 42. 避けるUI

以下をメイン画面に大量表示しない。

- AIカード大量表示
- 全AI一覧
- 複雑なWorkflow図
- JSON
- 内部ログ
- 技術設定
- API設定
- 大量の統計

**見やすさを最優先。**

---

# 43. 必要な画面

初期版は以下で十分。

```text
1. Mission
2. Development
3. Project History
4. Artifact Viewer
5. Settings
```

AI RegistryなどはSettings/詳細画面に収納。

---

# 44. データベース

SQLiteを使用。

最低限：

```text
projects
missions
tasks
ai_services
ai_capabilities
ai_runs
artifacts
validations
decisions
events
settings
locks
```

---

# 45. ファイルシステム

SQLiteには巨大な成果物本文をすべて押し込まない。

原則：

```text
SQLite
= 状態・メタデータ

Filesystem
= 実データ
```

---

# 46. API

最低限：

```text
GET    /api/projects
POST   /api/projects

GET    /api/projects/:id
DELETE /api/projects/:id

GET    /api/projects/:id/tasks
GET    /api/projects/:id/artifacts

POST   /api/missions
POST   /api/missions/:id/start
POST   /api/missions/:id/pause
POST   /api/missions/:id/resume
POST   /api/missions/:id/replan

GET    /api/ai-services
POST   /api/ai-discovery

GET    /api/runs
GET    /api/events
```

必要以上にAPIを増やさない。

---

# 47. 推奨内部構造

```text
src/
  ui/
  mission/
  orchestration/
  tasks/
  ai/
    registry/
    discovery/
    broker/
    executors/
    health/
  artifacts/
  validation/
  permissions/
  projects/
  events/
  settings/

server/
  api/
  orchestration/
  ai/
  database/
  filesystem/
  execution/
  security/
```

実際の構造は既存コード監査後に最適化する。

---

# 48. 現在システムから再利用を検討するもの

既存実装のうち、

- React
- TypeScript
- Vite
- Tailwind
- Node/Express
- workspace管理
- project分離
- artifact監視
- ファイル保存
- Claude Code実行
- テスト基盤
- lint
- build

は再利用候補。

ただし、

**「存在するから残す」ではなく「新設計に適合するから残す」**

という基準にする。

---

# 49. 原則廃止・再設計するもの

以下は旧設計として扱う。

### 固定Workflow中心設計

廃止。

### AI固定推薦ルール

廃止。

### AddStepModal中心UX

廃止。

### ユーザーがAIを選ぶ設計

廃止。

### AIごとの固定手順

廃止。

### 手動コピー＆ペースト前提

Fallbackとして残す。

### `workflow.json`をシステムの中心にする設計

廃止。

---

# 50. 旧workflow.json

完全削除を最初から行わない。

まず、

```text
旧データを読み取り
↓
新Task Graphへ変換
↓
動作確認
↓
不要と確認
↓
削除
```

とする。

---

# 51. マイグレーション原則

既存ユーザーのデータを破壊しない。

必ず、

```text
backup
↓
migration
↓
validation
↓
old data cleanup
```

の順番。

---

# 52. セキュリティ

最低限、

- Path Traversal防止
- 任意コマンド実行制御
- プロジェクト境界チェック
- ファイルアクセス制限
- 外部URL検証
- Shell Injection対策
- 危険コマンド確認

を実装する。

---

# 53. Command Execution

文字列を直接Shellへ流し込む設計を避ける。

可能なら、

```typescript
spawn(command, args, options)
```

方式を使用。

ユーザー入力をコマンド文字列へ直接連結しない。

---

# 54. ログ

すべての重要イベントを記録。

例：

```text
MISSION_CREATED
PLAN_CREATED
TASK_STARTED
AI_SELECTED
AI_DISCOVERED
AI_EXECUTED
ARTIFACT_CREATED
VALIDATION_STARTED
VALIDATION_FAILED
RETRY_STARTED
TASK_COMPLETED
MISSION_COMPLETED
```

---

# 55. UIでのログ

通常ユーザーには簡潔に表示。

```text
Claude Code が実装しています
```

詳細ログは、

> 詳細を見る

で開く。

---

# 56. コストガード

実行前に、

```text
API課金が発生する可能性
外部サービス課金
利用制限
```

を検査。

デフォルト：

```text
paid API = BLOCK
```

---

# 57. AI品質低下への対応

1つのAIを絶対視しない。

例えば、

```text
AI A
 ↓
結果
 ↓
Validation
 ↓
不十分
 ↓
AI B Review
```

とする。

ただし全Taskを複数AIでレビューさせる必要はない。

**重要度の高いTaskだけ追加レビューする。**

---

# 58. AI選定の信頼度

各選択に、

```text
confidence
```

を持たせる。

```text
0.90〜1.00 = 高
0.70〜0.89 = 中
0.00〜0.69 = 低
```

低信頼なら別候補を検討する。

---

# 59. 重要なAI変更への耐性

AIサービスの、

- URL変更
- UI変更
- 無料枠変更
- ログイン仕様変更
- サービス終了

を前提とする。

したがって、

**AIそのものとOrchestrator本体を強く結合させない。**

Adapter方式を採用する。

---

# 60. Adapter

例：

```text
ClaudeCodeAdapter
BrowserAIAdapter
ManualAIAdapter
CLIAdapter
```

AIサービスごとに必要なら個別Adapterを追加する。

---

# 61. 「全部自動」にしない

自動化率を目的にしない。

目的は、

> **ユーザーが面倒な判断・転記・管理をしなくても開発が進むこと。**

そのため、

```text
完全自動が不安定
↓
半自動へ降格
```

できることが重要。

---

# 62. テスト計画

最低限以下を実施。

## Test 1

単純Webサイト生成。

```text
Mission:
簡単な自己紹介サイトを作って
```

確認：

- Mission生成
- Task Graph生成
- Claude Code実装
- Build
- 完了

---

## Test 2

調査が必要なサイト。

```text
Mission:
最新情報を調査して表示するサイトを作って
```

確認：

- Research Task生成
- AI Discovery
- AI選択
- Artifact保存

---

## Test 3

AI失敗。

AI Executorを意図的に失敗させる。

確認：

```text
Failure
↓
Fallback
↓
Retry
```

---

## Test 4

テスト失敗。

意図的にコードへバグを入れる。

確認：

```text
Test failure
↓
Claude Code diagnosis
↓
Fix
↓
Retest
```

---

## Test 5

アプリ再起動。

実行途中でアプリを終了。

再起動後、

```text
前回Task
状態
Artifact
```

が復元されること。

---

## Test 6

複数Project。

Project A / Bを同時作成。

AのファイルがBへ混ざらないこと。

---

## Test 7

無料制約。

APIキーなしで基本開発フローが成立すること。

---

# 63. E2E最終テスト

Unit Testだけで完成扱いにしない。

最低1つ、

**実際の開発目標を入力して最初から最後まで実行する。**

例：

```text
「商品管理ができるシンプルなWebアプリを作って」
```

から、

```text
Mission
→ Planning
→ AI Selection
→ Research
→ Design
→ Coding
→ Test
→ Fix
→ Final Review
```

まで確認する。

---

# 64. 成功基準

以下をすべて満たしたらMVP完成。

| 条件 | 必須 |
|---|---|
| 目標を1回入力 | YES |
| Project自動作成 | YES |
| Task Graph自動生成 | YES |
| AI自動選定 | YES |
| AI追加発見 | YES |
| Claude Code実装 | YES |
| API課金なし | YES |
| Web AI fallback | YES |
| Artifact保存 | YES |
| Validation | YES |
| 自己修復 | YES |
| 最大5Retry | YES |
| Restart/Resume | YES |
| Project分離 | YES |
| Audit Log | YES |
| E2E実証 | YES |

---

# 65. MVPから除外するもの

初期版では以下を作り込みすぎない。

- Electron化
- Tauri化
- 高度なアニメーション
- AIランキングSNS
- AIチャット専用画面
- 巨大なAI一覧
- 複雑なダッシュボード
- 無制限並列処理
- 独自LLM
- API課金統合
- 常時世界中のAIクロール

---

# 66. 将来拡張

MVP完成後に検討。

```text
AI評価履歴
AI自動学習
プロジェクトテンプレート
Git連携
GitHub連携
Cloudflare連携
Deploy自動化
より高度なBrowser Agent
チーム共有
Remote Worker
```

---

# 67. 開発フェーズ

## Phase 0 — Audit

既存コードを調査。

成果物：

```text
AUDIT.md
REUSE.md
MIGRATION.md
DECISIONS.md
```

---

## Phase 1 — Core State

実装：

- SQLite
- Project
- Mission
- Task
- Artifact
- Event
- Lock

---

## Phase 2 — Orchestrator

実装：

```text
Mission Engine
Task Graph
Scheduler
State Machine
Resume
Pause
```

---

## Phase 3 — Claude Code

実装：

```text
ClaudeCodeExecutor
PermissionPolicy
CommandRunner
Validation
Retry
```

---

## Phase 4 — AI Registry

実装：

```text
AI Registry
Capability Registry
Health Check
Broker
```

---

## Phase 5 — AI Discovery

実装：

```text
Web Discovery
Candidate Evaluation
Free Check
Registry Save
```

---

## Phase 6 — Browser Automation

まずLevel 1。

次にLevel 2。

安定性を確認後Level 3。

最初から完全自動化を目指さない。

---

## Phase 7 — UI

Mission中心UIを実装。

---

## Phase 8 — Validation

Unit / Integration / E2E。

---

## Phase 9 — Migration

旧データを新構造へ移行。

---

## Phase 10 — Real World Test

実際の開発目標を投入。

問題を修正。

---

# 68. 実装開始時のClaude Code手順

Claude Codeは以下を順番に実行する。

```text
1. Repository audit
2. Existing architecture map
3. Existing feature inventory
4. Existing test inventory
5. Existing dependency inventory
6. Security audit
7. Reuse / Rewrite / Remove classification
8. Migration strategy
9. Architecture decision
10. Implementation plan
11. Phase 1 implementation
12. Test
13. Phase 2...
```

---

# 69. 監査結果の形式

```markdown
# AUDIT.md

## Current Architecture

## Existing Features

## Reusable

## Rewrite

## Remove

## Risks

## Security Issues

## Migration Risks

## Test Coverage

## Unknowns

## Recommended Architecture

## Confidence
```

---

# 70. 監査で必ず証拠を残す

単に、

> このコードは不要

と判断してはいけない。

必ず、

```text
対象ファイル
該当箇所
現在の役割
判断理由
影響
```

を記録。

---

# 71. 未確認事項

監査時には必ず、

```text
未確認
```

を明示する。

確認できていないものを、

> 問題なし

として扱わない。

---

# 72. 自己レビュー

各Phase終了時にClaude Code自身が、

```text
What worked?
What failed?
What assumptions were wrong?
What remains?
```

をレビューする。

---

# 73. 3段階自己改善

各主要Phase終了時：

### Improvement 1
最も重大な問題を修正。

### Improvement 2
UXまたは保守性を改善。

### Improvement 3
将来の故障要因を削減。

その後再テスト。

---

# 74. 完了判定

「コードを書いた」ではなく、

```text
実装
+
テスト
+
検証
+
UI確認
+
エラー確認
+
再起動確認
+
実環境E2E
```

まで完了して初めてDone。

---

# 75. 3つの主要リスク

## リスクA：Web AIの仕様変更

対策：

```text
Adapter
+
Health Check
+
Automation Level fallback
```

---

## リスクB：無料サービス条件変更

対策：

```text
free_status
last_verified_at
cost_guard
```

---

## リスクC：自動化が複雑になりすぎる

対策：

```text
Claude Codeを中心にする
+
AI能力を抽象化
+
必要時だけDiscovery
+
不要なAIを使わない
```

---

# 76. 代替アーキテクチャ

## A：Local Web App

React + Node + SQLite

効果：5  
コスト：5  
実装難度：2  
リスク：2

**推奨。**

---

## B：Electron

効果：4  
コスト：4  
実装難度：4  
リスク：3

将来検討。

---

## C：Tauri

効果：4  
コスト：5  
実装難度：5  
リスク：3

将来検討。

---

# 77. 初期アーキテクチャ決定

**A：Local Web App**

を採用。

理由：

- 現在資産を利用できる
- Windowsで動かしやすい
- Nodeとの相性
- UI開発が容易
- Electron依存を避けられる
- 後からDesktop化可能

---

# 78. 初心者向け操作

ユーザーが理解する必要があるもの：

```text
1. 作りたいものを書く
2. 開発開始
3. 進捗を見る
4. 必要な場合だけ承認
5. 完成物を見る
```

これ以上の操作を要求しない。

---

# 79. 中級者向け

必要なら、

```text
Task
AI
Artifact
Log
Validation
```

を確認できる。

---

# 80. 上級者向け

必要なら、

```text
AI Registry
Task Graph
Execution Log
Permission Policy
Decision Log
Adapter
```

まで確認できる。

---

# 81. 最終UX

理想的には、

```text
ユーザー
  ↓
「○○を作って」
  ↓
新AIオーケストラ
  ↓
考える
  ↓
必要なAIを探す
  ↓
AIを組み合わせる
  ↓
Claude Codeが実装
  ↓
テスト
  ↓
問題発見
  ↓
修正
  ↓
再テスト
  ↓
完成
```

となる。

ユーザーが、

> 「次はどのAIを使えばいい？」

と考えなくてよい。

---

# 82. 絶対に守るべき制約

```text
1. API課金を勝手に発生させない
2. Claude Codeを実装エンジンとして使用
3. ユーザーに毎回AI選択を要求しない
4. AIを固定Workflowにしない
5. AIサービス変更を前提にする
6. CAPTCHA等の制限を突破しない
7. 無限Retryしない
8. プロジェクトを混ぜない
9. 成果物の出所を追跡可能にする
10. テストなしで完成扱いにしない
11. 本番・破壊的操作は承認制
12. UIを複雑にしない
13. 現在コードを盲目的に残さない
14. 既存データを無断で破壊しない
15. 不明点を事実として扱わない
```

---

# 83. Claude Codeへの実装指示

以下を最終命令として扱う。

```text
この仕様書を基準として、新AIオーケストラをゼロベースで再構築してください。

ただし、現在のコードを最初から全削除してはいけません。

まずRepository全体を監査してください。

監査結果を以下へ保存してください。

AUDIT.md
REUSE.md
MIGRATION.md
DECISIONS.md

各判断には必ず証拠・理由・影響・未確認事項を記録してください。

その後、新アーキテクチャを確定してください。

不要な確認質問で作業を停止しないでください。
仕様から合理的に判断できるものは判断してください。
判断したものには【仮定】を付けて記録してください。

実装はPhase単位で進めてください。

各Phaseごとに、

1. 実装
2. テスト
3. ビルド
4. lint
5. 動作確認
6. 自己レビュー
7. 問題修正

を実施してください。

既存機能を削除する場合は、代替機能が新システムに存在することを確認してから削除してください。

特に以下を最優先してください。

- Mission中心
- Dynamic Task Graph
- Claude Code中心
- AI Capability管理
- AI Discovery
- AI Broker
- AI Executor
- Artifact管理
- Validation
- Retry最大5回
- Resume
- Project Isolation
- Permission Policy
- Cost Guard
- Audit Log

固定Workflow中心の設計には戻さないでください。

ユーザーが毎回AIを選択する設計にも戻さないでください。

API課金を勝手に導入しないでください。

Claude Code CLIのオプションは現在の環境で `claude --help` 等を確認してから使用してください。

Web AI自動化は最初から完全自動化を前提にせず、Level 1 → Level 2 → Level 3の順で実装してください。

CAPTCHA突破、認証回避、Cookie窃取、Bot対策回避などは禁止です。

本番デプロイ・課金・破壊的操作はユーザー承認制にしてください。

無限Retryは禁止し、最大5回で停止してください。

コード編集はClaude Codeをwrite-lock ownerとし、他AIは原則レビュー・調査用途にしてください。

最後に、実際の開発目標を1件入力してE2Eテストしてください。

Unit Testだけで完成扱いにしないでください。

最終報告には必ず、

- 実装済み
- 未実装
- 既知の問題
- 未確認事項
- テスト結果
- E2E結果
- 再利用した旧資産
- 廃止した旧機能
- 今後のリスク

を含めてください。

「仕様上存在するが実際には動かない機能」を完成扱いにしてはいけません。
```

---

# 84. 最終チェックリスト

| 項目 | 判定 |
|---|---|
| Mission一回入力 | □ |
| 自動Task生成 | □ |
| AI自動選択 | □ |
| AI Discovery | □ |
| Claude Code実装 | □ |
| 無料優先 | □ |
| API課金防止 | □ |
| Browser fallback | □ |
| Artifact管理 | □ |
| Validation | □ |
| 自己修復 | □ |
| Retry上限5 | □ |
| Resume | □ |
| Pause | □ |
| Project Isolation | □ |
| Code Lock | □ |
| Permission | □ |
| Audit Log | □ |
| Cost Guard | □ |
| E2E | □ |

---

# 85. 最終目標

本システムの完成形は、

> **AIを管理するアプリではない。**

> **AIを使って「ものを完成させる」ための開発オーケストレーターである。**

ユーザーが、

```text
「○○を作って」
```

と言う。

システムが、

```text
何が必要か考える
↓
必要な能力を特定
↓
適切なAIを探す
↓
AIを組み合わせる
↓
成果物を蓄積
↓
Claude Codeが実装
↓
テスト
↓
問題修正
↓
再テスト
↓
レビュー
↓
完成
```

まで進める。

これを本プロジェクトの最終的な設計思想とする。

---

# 86. 自己評価

### A：設計完成度
**A**

Mission、Task Graph、AI Discovery、Broker、Executor、Validation、Resumeまで一貫した構造になっている。

### B：実装難度
**B**

特にWeb AI自動操作とAI Discoveryは外部環境に左右される。

### C：無料維持
**A−**

API課金なしを前提にできるが、無料Web AIの利用条件は将来変化する。

---

# 87. 不確実性

**中**

理由：

- AIサービスの仕様変更
- 無料枠変更
- Web UI変更
- Claude Code CLI変更
- Browser Automation制限

は外部要因で完全には固定できない。

そのため本仕様では、

**「壊れないAI連携」ではなく「壊れても別方式へ降格して開発を止めないAI連携」**

を設計目標とする。

---

# 88. 最終信頼度

**高**

ただし、実装前に現在リポジトリを監査し、

```text
現行資産
実際のClaude Code CLI
既存テスト
既存データ
```

を確認することを前提とする。