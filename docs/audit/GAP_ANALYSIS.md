# GAP_ANALYSIS(新規実装項目)

難易度 LOW/MEDIUM/HIGH、工数 <2h / 2-8h / 1-2days / 3-5days / >5days(推定)。依存は先に必要な項目。

| 項目 | 現状 | 難易度 | 工数 | 依存 | リスク |
|---|---|---|---|---|---|
| Core State(SQLite、12テーブル) | なし | MEDIUM | 1-2days | Windowsでのsqliteビルド | ドライバ可否 |
| Mission Engine | なし | MEDIUM | 1-2days | Core State | |
| Planner(Claude Code兼任) | なし | HIGH | 3-5days | Mission, Executor | 計画品質 |
| Task Graph / State Machine | なし | HIGH | 3-5days | Core State | 状態遷移の網羅 |
| Task Scheduler(並列2、書込1) | なし | MEDIUM | 1-2days | Task Graph, Lock | |
| Lock Manager | なし | LOW | 2-8h | Core State | |
| Resume / Pause | なし | MEDIUM | 1-2days | State Machine | プロセス再接続 |
| Retry Manager(最大5) | なし | LOW | 2-8h | Validator | |
| Claude Code Executor | `exec`のみ | MEDIUM | 1-2days | Permission Policy | CLI仕様変更 |
| Permission Policy | なし | MEDIUM | 1-2days | CommandRunner | |
| CommandRunner(spawn) | `exec` | MEDIUM | 1-2days | | Windowsのquoting |
| Validator(L1〜L3→L6) | なし | MEDIUM | 3-5days | Executor | E2E部は重い |
| Artifact Provenance | なし | LOW | 2-8h | Core State | |
| AI Capability Registry | 名前+URLのみ | MEDIUM | 1-2days | Core State | |
| AI Broker(重み4/3/2/1、confidence) | UI内キーワード規則 | MEDIUM | 1-2days | Registry | |
| AI Health Check | なし | MEDIUM | 1-2days | Registry | 外部要因 |
| AI Discovery | **NOT_IMPLEMENTED** | HIGH | 3-5days | Registry, Browser | 無料条件の判定精度 |
| Cost Guard | なし | LOW | 2-8h | Registry | |
| Audit Log / Events | 履歴JSONのみ | LOW | 2-8h | Core State | |
| Web AI自動操作 L1/L2/L3 | **NOT_IMPLEMENTED**(L1相当は手動UIあり) | HIGH | >5days | Health Check | UI変更・規約 |
| Mission中心UI(5画面) | 3ペイン(Workflow中心) | HIGH | 3-5days | API | PromptPane流用困難 |
| API(仕様§46) | 別構成 | MEDIUM | 1-2days | Core State | |
| 旧データ移行 | なし | MEDIUM | 1-2days | Core State | |
| セキュリティ緊急修正(S-1〜S-4) | 該当 | LOW | <2h | なし | 実施は承認後 |
| build修正(TS18047) | 失敗中 | LOW | <2h | なし | |

## 未確認
- 工数はコード量とドライバ可否の推定であり、実測ではない
