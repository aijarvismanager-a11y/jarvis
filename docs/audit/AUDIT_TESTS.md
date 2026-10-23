# AUDIT_TESTS

## 結論
実行した結果: test 26件合格、lint エラー0(警告あり)、**build 失敗**。テストは純粋関数とZodスキーマのみ。サーバー・UI・実行系・再開・分離は未テスト。

## 実測(2026-10-23、過去記録に依存せず再実行)
| コマンド | 結果 |
|---|---|
| `npm test` | 5ファイル/26テスト合格(3.3秒) |
| `npm run lint` | エラー0。`react(set-state-in-effect)` 警告(`App.tsx` 127/145/158/187/215行、`ArtifactsPane.tsx` 23行 ほか。総数は出力末尾のみ確認) |
| `npm run build` | **失敗** `src/components/AddStepModal.tsx(75,13): TS18047 'rec' is possibly 'null'` → `vite build` に到達せず |
| `claude --version` / `--help` | 2.1.309。オプション一覧を取得済み(Phase 3で精査) |

## テスト一覧
| ファイル | 種別 | 保証すること | 保証しないこと |
|---|---|---|---|
| `src/lib/claudeCommand.test.ts` | Unit | コマンド文字列生成(パス処理) | 実行・権限・実CLIとの互換 |
| `src/lib/renameAiReferences.test.ts` | Unit | AI名変更の参照追従 | 永続化 |
| `src/lib/tokenize.test.ts` | Unit | 日本語/英語キーワード一致 | 推薦の正しさ(文脈は読めない) |
| `src/lib/workflowTemplate.test.ts` | Unit | テンプレートのExport/Import形式 | 実データ移行 |
| `src/types/workflow.test.ts` | Unit(スキーマ) | Zod検証 | サーバー側検証(サーバーは使っていない) |

種別別: Unit 5 / Integration 0 / E2E 0 / UI 0 / API 0 / Security 0 / Migration 0。

## 未テスト領域の判定
| 領域 | 判定 |
|---|---|
| restart / resume | 未テスト(機能自体なし) |
| project isolation | 未テスト(実装は`projectDir`/`isPathInsideDir`にあるがテストなし) |
| AI failure / command failure | 未テスト |
| file corruption(JSON破損) | 未テスト。`readHistory`は握りつぶして空配列、workflowは500応答 |
| concurrent execution | 未テスト |
| retry | 未テスト(機能なし) |
| migration | 未テスト |
| パス逸脱(symlink等) | 未テスト |

## 新設計への含意
Test 1〜7(仕様§62)は全て新規。既存のvitest/oxlint基盤は流用。サーバーをテスト可能にするため、`server/index.ts` をルータ・サービスへ分割する(Phase 1〜2)。

## 未確認
- lint警告の総数と、`set-state-in-effect` が実害(再レンダー連鎖)を起こすか
- build失敗が生じた時期(直近コミット `f6f9975` で発生したか。`git bisect` 未実施)

## 仮定
- build失敗は `AddStepModal` 内の1箇所の型エラーのみ【仮定。tscは最初のエラーで他を隠さないため追加エラーは出力上なし】
