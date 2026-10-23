# MIGRATION(移行方針)

## 原則(仕様§50-51)
backup → migration → validation → old data cleanup の順。旧 `workflow.json` は変換と確認が済むまで削除しない。

## 対応表
| 旧 | 新 | 難易度 | 注意 |
|---|---|---|---|
| Project(id,name) | projects 行+`projects/<id>/` | LOW | 旧 `workspace/<id>/` の中身はコピー(移動しない) |
| (なし) | Mission | LOW | 旧Projectには目標文が無いため `name` から仮Missionを生成【仮定】 |
| WorkflowStep(index順) | Task(直列の依存) | MEDIUM | `index`→依存リンク。`status` active/done→ready/completed |
| `ai_name` | Task.selected_ai(Registry参照) | MEDIUM | 名前→Registry id を照合。不一致は null+要確認 |
| `role` | Task.role(能力へ対応づけ) | MEDIUM | Ideator/Architect/Reviewer/Lead Developer/QA→research/architecture/ux_review/coding/testing 等【仮定】 |
| `prompt_template`/`command_template` | Task.contract の入力/制約 | MEDIUM | commandは実行しない参考情報として保存 |
| `input_files`/`output_files` | Task.inputs / expected_outputs、Artifact行 | LOW | `workspace/<id>/` 接頭辞を除去 |
| `attempts` | ai_runs(手動実行)として記録 | MEDIUM | 利用実態UNKNOWN |
| 実行履歴JSON | events/ai_runs | LOW | 成功率は参考値 |
| ai_services.json | ai_services(+capabilities空) | LOW | free_status = unknown |

## 手順
1. `config/` と `workspace/` を `backups/<日時>/` へコピー(未コミット差分ごと保全)
2. 読み取り専用インポータで変換、ドライラン結果を `migration-report.md` に出力
3. 件数・パス存在・projectId混在なしを検証
4. ユーザー確認後に新DBへ適用。旧ファイルは当面保持
5. 新UIで1プロジェクトを開いて確認後、Phase 9で旧データ・旧機能を掃除

## リスク
- 旧 `workflow.json` に手編集のゆらぎがあると変換に失敗(Zod検証で検出可能)
- 2つのconfigが未コミット → コミット/バックアップ前に実施しない
- soccer-japan-team は実利用データ(変更禁止、コピーのみ)

## 未確認
- 変換できない step の発生有無(実データでのドライランは未実施)
- 旧版 `legacy-ai-manager/data` の取り込み要否

## 判断(仮定)
- 未コミットconfigは Phase 1 前にバックアップしたうえで**そのまま保持**(コミットも破棄もしない)【仮定、ロードマップ§6-2】
