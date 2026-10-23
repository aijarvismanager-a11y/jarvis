# AUDIT_DATA

## 結論
重要データは (1) `config/workflow.json` (2) `config/ai_services.json` (3) `workspace/<projectId>/` の成果物 (4) 実行履歴 の4つ。いずれも単純なJSON/ファイルで、新DBへ変換可能。ただし `workflow.json` と `ai_services.json` は未コミットの差分があり、移行前にバックアップが必須。

## 資産一覧
| データ | 場所 | 内容 | 重要度 |
|---|---|---|---|
| ワークフロー | `config/workflow.json` | `current_project_id`+`projects[4]`。各stepに id/index/ai_name/role/status/input_files/output_files/prompt_template/command_template/attempts | 高 |
| AIサービス | `config/ai_services.json` | `{id,name,url}` 約35件(Web AI中心、Claude Code(CLI)は url null) | 中 |
| Ollama設定 | `config/ollama.json` | baseUrl+model | 低 |
| 成果物 | `workspace/sample-project`(docs/src/logs)、`workspace/soccer-japan-team`(docs 3件 約25KB) | ユーザーの実作業の成果物 | **高**(soccer-japan-team) |
| 実行履歴 | `workspace/<id>/logs/execution_history.json` | 直近200件 | 低 |
| ログ | `start.log`(67KB)、`server.log` | gitignore済み | 低 |
| 旧版データ | `legacy-ai-manager/data` `projects` `docs` | 旧Electron版 | 要確認 |

## 状態
- `config/workflow.json` `config/ai_services.json`: `git status` で **変更あり**(行末LF→CRLF警告も表示)。差分の中身は監査では**未精査**(ユーザー操作による実行時更新と推定)。
- `workspace/project_1788063824457`(「キン肉マンのサイト作りたい」1ステップ)、`project_1788064243370`(「カラフルな動画作りたい」0ステップ)は**【訂正】ユーザーの実プロジェクト**。移行対象(ドライラン済み)。

## 移行可能性(→ MIGRATION.md)
可能。ただし以下は変換不能または損失あり: `status: active/done` の履歴は実行ログではなくUI進行状態のため Task の実行履歴にはならない / `ai_name` は自由文字列で Registry との照合に手作業が要る。

## 未確認
- 2つのconfigの未コミット差分の内容
- `workflow.json` がUI以外(手編集)で壊れた場合の復旧手順
- `legacy-ai-manager/data` に未移行の価値あるデータがあるか

## 仮定
- soccer-japan-team は実利用データとして扱い、移行時に絶対に変更しない【仮定】
