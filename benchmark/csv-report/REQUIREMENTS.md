# 依頼: CSVの集計コマンド

CSVファイルを読み、列ごとにグループ分けして数値を集計し、Markdownの表で出すコマンドを作ってください。Node.js(ESM、`.mjs`)だけで作り、外部ライブラリは使いません。

## ファイル構成(この名前・この場所で作る)
- `src/parse.mjs` … `export function parseCsv(text)`
- `src/stats.mjs` … `export function summarize(rows, { groupBy, valueKey })`
- `src/format.mjs` … `export function toMarkdownTable(groups, keyLabel = "key")`
- `src/cli.mjs` … コマンド本体

## parseCsv(text)
- 1行目は列名。以降の行を、列名をキーにしたオブジェクトの配列で返す(値は文字列のまま)。
- 区切りはカンマ。`"` で囲んだ値の中のカンマと改行は値の一部。囲みの中の `""` は `"` 1文字。
- 改行は `\n` と `\r\n` の両方を受ける。空行は読みとばす。最後の行の改行は有っても無くてもよい。
- 行の値が列名より少なければ、足りない分は空文字。多い分は捨てる。
- 空の文字列、または列名だけなら `[]` を返す。

## summarize(rows, { groupBy, valueKey })
- `groupBy` 列の値でグループ分けし、`valueKey` 列を数値として集計する。
- 戻り値は `{ groups, skipped }`。`groups` は `{ key, count, sum, avg, min, max }` の配列で、`key` を文字列の昇順(`<` での比較)に並べる。
- `valueKey` の値が数値として読めない行(空文字、`abc` など)は集計に入れず、`skipped` に数える。前後の空白は無視して読む。
- 数値が1件もないグループは出さない。
- `avg` は `sum / count` の計算値のまま(丸めない)。

## toMarkdownTable(groups, keyLabel)
- 先頭行は `| <keyLabel> | count | sum | avg | min | max |`、2行目は `|---|---|---|---|---|---|`、その後に1グループ1行。
- 各行は `| <key> | <count> | <sum> | <avg> | <min> | <max> |`。
- `avg` は小数第2位で四捨五入した数を、不要な末尾の0なしで出す(15 → `15`、10/3 → `3.33`、2.5 → `2.5`)。ほかの数はそのまま出す。
- 行はすべて `\n` でつなぎ、最後に改行は付けない。`groups` が空なら先頭の2行だけ。

## コマンド
`node src/cli.mjs <ファイル> --group <列名> --value <列名>`
- 読んだCSVを集計し、`toMarkdownTable`(`keyLabel` は `--group` の列名)の出力に改行を1つ付けて標準出力へ。`skipped` が1以上なら、その下に `skipped: <数>` の行を足す。
- ファイルが無い: 標準エラーに「ファイルが見つかりません: <パス>」を出して終了コード1。
- 指定した列がCSVに無い: 標準エラーに「列が見つかりません: <列名>」を出して終了コード1。
- 引数が足りない: 使い方を標準エラーに出して終了コード2。

## 提出するもの
- 上のファイルと、あなたが書いたテスト(`test/` に置き、`node --test` で動く形)。
- 使い方を書いた `README.md`。
