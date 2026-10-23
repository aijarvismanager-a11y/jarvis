# AUDIT_PROJECT_STRUCTURE

監査日: 2026-10-23 / 監査者: Claude Code(Phase 0・実装なし)
範囲: node_modules・.git・dist・dist-release・legacy-ai-manager内部(別項)を除く。

## 結論
現行は「Vite+React(src 約4,200行)+単一ファイルExpressサーバー(403行)+JSON設定」の小規模ローカルアプリ。DB・Mission・Task Graphに相当する層は存在しない。ルート直下に用途不明の空ディレクトリが8個ある。

## 構成(実測)
| パス | 内容 | 備考 |
|---|---|---|
| `server/index.ts` | 403行。全APIとファイル監視 | 分割なし |
| `src/App.tsx` | 690行 | 状態管理が集中 |
| `src/components/` | 11ファイル。`PromptPane.tsx` 1,065行 | 肥大 |
| `src/lib/` | 推薦・テンプレート・コマンド生成・API。テスト付き4本 | |
| `src/types/` | `workflow.ts` `aiService.ts`(Zod) | |
| `config/` | `workflow.json` `ai_services.json` `ollama.json` | 実行時データ。git追跡+未コミット差分あり |
| `workspace/` | プロジェクト別成果物。`sample-project` `soccer-japan-team` `project_1788063824457` `project_1788064243370` | 後ろ2つはテスト由来(下記) |
| `scripts/` | `package-dist.ps1` `say.ps1` `make_icon.py` | ZIP配布・起動メッセージ |
| `start-ai-orchestrator.bat` | Node自動導入+`npm run start` | ASCIIのみ(文字化け対策) |
| `legacy-ai-manager/` | 旧Electron版。git追跡69ファイル+node_modules | 退避済み |
| `PLAN.md` `PROGRESS.md`(62KB) `README.md` `MANUAL.html` | 文書 | PLAN/READMEは旧設計の記述(本監査で追記) |
| `新AIオーケストラ — …仕様書.md` / `…監査プロンプト.md` | 新仕様 | 未追跡 |

## 用途不明だったディレクトリ(確認済み)
`.exe` `a` `actually` `expects` `install` `on` `Japanese` `Windows`(いずれも 2026-08-30 19:04 作成)。
- 証拠: 8個とも中身が空(再帰列挙で0ファイル)、git未追跡(空のため追跡不可)。名前が英文の断片(「…expects a Windows .exe install…」型)に見えることから、引用符のないシェルのリダイレクトで生成された事故の産物と**推定**。生成コマンドは**未確認**。
- 影響: なし。削除しても参照元がない(grepで参照0件は未実施 → 削除前に実施)。
- 判定: REMOVE候補(Phase 9で削除。監査中は削除しない)。

## テスト由来データ
`config/workflow.json` のプロジェクト4件: `sample-project`(5ステップ)、`soccer-japan-team`(5)、`project_1788063824457`(1)、`project_1788064243370`(0)。後ろ2件はIDが生成タイムスタンプ形式だが、**【訂正 2026-10-23】実際のユーザープロジェクト**(「キン肉マンのサイト作りたい」1ステップ、「カラフルな動画作りたい」0ステップ)。テスト残骸ではない。削除対象にしない。

## 未確認
- `PROGRESS.md` のうち現行コードと食い違う記述の範囲
- `workspace/sample-project/src/*`(別サンプルアプリ。メモリ記録では新システムとは無関係) の参照元
- `MANUAL.html`/`public/MANUAL.html` の内容差

## 仮定
- ルート直下の空ディレクトリ8個は事故産物で不要【仮定】

## リスク
- 空ディレクトリはGit管理外のため、ZIP配布(`package-dist.ps1`)に混入する可能性(除外ルールは未確認)
