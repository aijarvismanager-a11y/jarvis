# REUSE(再利用判定)

評価は5点満点(再利用価値/保守性/品質/依存度(低いほど高)/移行コスト(低いほど高))。根拠は AUDIT_FEATURES と AUDIT_ARCHITECTURE を参照。

| 資産 | 判定 | 価/保/品/依/コ | 理由・証拠 | 影響 |
|---|---|---|---|---|
| Vite/React/TS/Tailwind/vitest/oxlint 基盤 | KEEP | 5/4/4/4/5 | 動作中。仕様§48 | 設定変更なし |
| Express+ws+chokidar 骨格 | REUSE | 4/3/3/3/4 | `server/index.ts` | ルータ分割とlisten修正が前提 |
| projectId検証・`isPathInsideDir` | REUSE | 4/4/3/4/5 | 実コード確認済み。symlink未確認 | 強化(realpath)して移植 |
| 成果物一覧/表示(ArtifactsPane、shiki、react-markdown) | REUSE | 4/3/4/3/4 | Artifact Viewer画面の母体 | Provenance表示を追加 |
| 手動コピペ中継(PromptPane内) | REUSE | 5/2/3/2/3 | 仕様のLevel 1そのもの | 1,065行から切り出し |
| Ollama連携 | REUSE | 3/3/3/4/4 | 無料ローカルExecutor候補 | Executorインターフェースに合わせる |
| 実行履歴 | REWRITE | 3/3/3/3/4 | JSON上限200 | events/ai_runsへ |
| `claudeCommand.ts` | REWRITE | 2/4/3/3/4 | 固定フラグ | ClaudeCodeExecutorへ |
| 推薦規則の語彙(ideaRecommendation/imageRecommendation/taskCategories) | REWRITE | 3/3/3/2/3 | AI名直書き。キーワード→能力の表だけ移植 | Capabilityマッピング初期値 |
| `ai_services.json`(約35件) | REUSE(データ) | 4/-/3/-/4 | URL一覧は新Registryの種 | capabilities・free_status等を追記 |
| テンプレート機能 | REWRITE | 2/3/3/3/3 | 固定ステップ形式 | Task Graphテンプレートへ変換 |
| ZIP配布/起動bat/say.ps1 | KEEP | 4/3/4/4/5 | 文字化け対策の経緯あり(コミット91350f3) | 新構造に合わせ除外リスト更新 |
| `PromptPane.tsx` 本体 | REPLACE | 2/1/2/1/2 | 肥大・workflow依存 | 切り出し後は廃止 |
| `AddStepModal` `IdeaIntakeModal` `WorkflowPane` | REPLACE/REMOVE候補 | 1/2/2/1/3 | 固定Workflow中心(仕様§49) | 代替(Mission入力・Task一覧)確認後に削除 |
| `legacy-ai-manager/` | REMOVE候補 | 1/1/2/5/5 | 旧Electron版、参考のみ(PLAN.md) | 削除前にデータ有無を確認 |
| 空ディレクトリ8個 | REMOVE候補 | - | AUDIT_PROJECT_STRUCTURE | なし |

## 未確認
- `attempts`(複数AI比較)と ImageGen の利用実態 → UNKNOWN
- 旧アプリ `legacy-ai-manager` の有用コード(監査対象外としていた)
