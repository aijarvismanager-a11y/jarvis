# AUDIT_SECURITY(= SECURITY_FINDINGS)

## 対応状況(Phase 0.5、2026-10-23 実施・検証済み)
| ID | 状態 | 対応 |
|---|---|---|
| S-1 | **解決** | `listen(PORT, "127.0.0.1")`。実測: 待受 `127.0.0.1:4199` のみ、LAN IP(172.18.112.1)への接続は拒否 |
| S-2 | **解決(主要経路)** | 全`/api`で Host(localhost/127.0.0.1/[::1])とOrigin検査(403)、`/execute` は起動ごとの32バイト乱数トークン必須(`x-orchestrator-token`、timingSafeEqual)。WebSocketも `verifyClient` でHost/Origin検査。実測: 偽Host 403、偽Origin 403、トークンなし/誤り 403、正トークン 200 |
| S-4 | **解決** | `PUT /api/workflow` `PUT /api/ai-services` をZod検証(不正は400)、`express.json` 上限2MB。実測: 不正ボディ 400 |
| S-3, S-5〜S-8 | 未対応 | Phase 3(spawn化・権限・同時数制限)以降 |
残る注意: トークンは `GET /api/session-token` で配布(同一オリジンのみ読める)。同一PC上の別プロセスは127.0.0.1に接続しトークンを取得できるため、**同一ユーザー内の悪意あるプロセスは防げない**(単一ユーザーのローカルツールとして許容)。

## 結論(監査時点)
最大の問題は **認証なしの任意コマンド実行APIが全ネットワークインターフェースで待ち受けている** こと。ローカル単一ユーザー前提の設計だが、サーバーが `localhost` に限定されていない。

## 指摘事項
| ID | 重大度 | 内容 | 証拠 | 影響 |
|---|---|---|---|---|
| S-1 | **高** | APIが全インターフェースで待ち受け | `server/index.ts` の `server.listen(PORT, cb)`(host指定なし)。実機で `Get-NetTCPConnection -LocalPort 4173` が `LocalAddress ::` を返した | 同一LAN上の端末から到達できる可能性。Windowsファイアウォールの実設定は**未確認** |
| S-2 | **高** | 任意コマンド実行に認証・Origin検査なし | `POST /api/projects/:id/execute` が `exec(\`chcp 65001>nul && ${command}\`)` を実行 | S-1と合わせ、到達できれば遠隔コード実行。ブラウザからのクロスオリジンは `application/json` のためCORS未設定で通常ブロックされるが、DNSリバインディングは**未検証** |
| S-3 | 中 | シェル文字列直結 | 同上。仕様§53違反 | ユーザー承認ボタン前提だが、コマンド文字列検査なし |
| S-4 | 中 | `PUT /api/workflow` `PUT /api/ai-services` が検証なしで全置換 | `writeFile(..., JSON.stringify(req.body))` | 不正JSONや巨大ボディで設定破損。`express.json()` の上限は既定100KB |
| S-5 | 中 | 無制限プロセス・並行実行 | `exec` に同時数制限なし。timeoutは10分 | 資源枯渇 |
| S-6 | 中 | 依存の既知脆弱性 | `npm audit --omit=dev`: 4件(中3・重大1)。判明分: express 4.22.2 経由の `qs`、`proxy-addr`。重大1件の対象は**未確認** | 内容・到達性は未精査 |
| S-7 | 低 | 実行履歴にコマンド全文を保存 | `appendHistory` が `command` を保存 | プロンプト内の秘密情報が残りうる(現在は秘密入力欄なし) |
| S-8 | 低 | Ollama URLがユーザー指定 | `baseUrl` をそのまま `fetch` | SSRF相当。ローカル単一ユーザー前提では低 |

## 良い点(証拠付き)
- projectIdを `^[a-zA-Z0-9_-]+$` で制限(`PROJECT_ID_RE`)→ID経由のパス逸脱を排除
- 成果物API: `isPathInsideDir`(resolve+`dir + path.sep` 前方一致)でパス逸脱を拒否
- 隠しファイルを一覧から除外
- 外部通信はOllama(ローカル)のみ。API課金系SDKなし(依存に該当なし)

## 未確認(「問題なし」と扱わない)
- シンボリックリンク/ジャンクション経由の `workspace/` 外アクセス(`resolve` はリンクを解決しない)
- Windows予約名・代替データストリーム・末尾ドット等でのパス検査すり抜け
- WebSocket(`/ws`)のOrigin検査(ブロードキャスト内容はパス名のみ。認証なし)
- 秘密情報のログ出力有無(`start.log` 67KB の内容は未精査)

## 推奨対応(Phase 1 より前の緊急修正候補)
1. `listen(PORT, "127.0.0.1")` に変更(1行、影響極小)
2. `/execute` に Host/Origin 検査と起動時ランダムトークンを導入
3. workflow/ai-services のPUTにZod検証
これらは実装作業のため本監査では**実施しない**。承認後、Phase 1 着手前の独立修正として行うことを提案。

## 仮定
- 運用はユーザーの単一PCで、ファイアウォール既定のため外部到達は限定的【仮定。未検証】
