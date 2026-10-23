# AUDIT_ARCHITECTURE

## 結論
現行アーキテクチャは「ブラウザSPA ⇄ 単一Expressサーバー ⇄ JSONファイル+workspace/」。状態の正は `config/workflow.json` で、DBも状態機械もない。新仕様(Mission→Task Graph→Broker→Executor→Validation)とは中間層が全て欠けている。

## 技術スタック(実使用で確認)
| 項目 | 結果 | 確認方法 |
|---|---|---|
| OS想定 | Windows(.bat、chcp 65001、PowerShell) | コード・スクリプト |
| Node/npm | Node 24系型定義、ESM(`type: module`) | package.json |
| TypeScript | 6.0系、`tsc -b` | package.json。**build失敗中** |
| React/Vite/Tailwind | 19.2 / 8.2 / 3.4 | package.json+src使用を確認 |
| Express/ws/chokidar/zod | 4.21 / 8 / 4 / 3 | server/index.ts と types |
| SQLite | **未使用**(依存なし) | package.json、grep |
| Electron/Tauri | **未使用**(旧版のみ。PLANで見送り) | |
| Claude Code | CLI 2.1.309 を `claude --version` で確認 | 実行 |

## データフロー
```
UI(React) ─fetch→ /api/workflow(GET/PUT: 全文置換)
                 /api/projects/:id/execute → exec(shell)
                 /api/projects/:id/artifacts[/*]
                 /api/ollama/*
UI ←ws── chokidar(workspace/, workflow.json, ai_services.json)
```
- 状態更新は「UIが workflow.json 全体を組み立てて PUT」。サーバーは検証せず書き込む(競合時は後勝ち・同時更新検知なし)。

## 現在 → 目標の差分
| 目標要素 | 現状 |
|---|---|
| Mission | なし(ProjectとWorkflowのみ) |
| Planner / Task Graph | なし。ステップは人手追加の直列リスト |
| AI Discovery / Broker / Health | なし。推薦はUI側のキーワード規則 |
| Executor抽象 | なし。`exec` 1経路+Ollama専用エンドポイント |
| Artifact+Provenance | ファイル有り・来歴なし |
| Validator / Retry / Replan | なし |
| Resume / Pause / Lock | なし(状態はファイルに残るが実行状態は持たない) |
| Permission / Cost Guard | なし |
| Audit Log | 実行履歴JSONのみ(Claude実行とOllama生成) |

## 3案比較(各5点満点、効果/コスト(安いほど高)/実装難度(易しいほど高)/リスク(低いほど高)/保守性)
| 案 | 効果 | コスト | 難度 | リスク | 保守性 | 合計 |
|---|---:|---:|---:|---:|---:|---:|
| A 既存資産最大活用(workflow.jsonにMission等を継ぎ足す) | 2 | 5 | 4 | 3 | 2 | 16 |
| **B 段階的リビルド**(新コアを並置、UI・基盤は流用、移行後に旧削除) | 5 | 3 | 3 | 4 | 5 | **20** |
| C ほぼ完全新規 | 5 | 1 | 2 | 2 | 5 | 15 |

**推奨: B**。理由: 仕様§48(新設計に適合するものだけ残す)・§50(旧データは変換してから削除)に一致。Aは固定Workflowを温存して§49違反、Cは動作する基盤(Express/chokidar/Artifact表示/配布)を捨てる。

## ボトルネック(3件以上)
1. **Claude Code非対話実行の制御**: 原因=`exec`文字列、固定フラグ、10分timeout、キル処理なし。影響=権限制御・再試行不能。回避=spawn+PermissionPolicy+プロセスキル(Phase 3)。
2. **動的Task Graph(Planner品質)**: 原因=LLM計画の揺れ。影響=誤った計画で全体停滞。回避=スキーマ検証、承認ゲート、Replan。
3. **Web AI自動操作**: 原因=外部UI変更。影響=Level 3破綻。回避=Level 1/2常設、自動降格。
4. **`PromptPane.tsx` 1,065行**: 原因=機能の継ぎ足し。影響=UI再構築時に流用困難。回避=Manual中継部のみ抽出。

## Planner案の比較
A: Claude CodeがPlanner兼Executor / B: 別AIがPlanner / C: ユーザー承認型。**推奨A+承認ゲート**(仕様§3、API課金なし制約と整合)。Bは無料枠・自動化の不安定さでリスク大【推定】。

## 仮説の検証記録
- 仮説: 「最大の問題は固定Workflowと名前固定のAI選定」。検証: `ai_name` が WorkflowStep必須(types/workflow.ts)、推薦規則がAI名直書き(ideaRecommendation.ts)。結果: **成立**。別仮説「Claude Code連携の安全性が最大の問題」→ AUDIT_SECURITY で**実害の大きさはこちらが上**と判明(LAN公開の任意コマンド実行)。

## 未確認
- better-sqlite3 のWindows(Node 24)ビルド可否(Phase 1スパイク)
- `claude -p` の現行CLIでの権限挙動(Phase 3で`claude --help`を精査し再検証)

## 仮定
- 新Projectは `projects/<id>/` に置き、旧 `workspace/` は移行完了まで併存【仮定】
