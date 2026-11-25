# 依頼: 買い物かごライブラリの修正と機能追加

このフォルダには、すでに動いている小さなライブラリ(`src/` の4ファイルと `test/existing.test.mjs`)があります。次の変更をしてください。Node.js(ESM、`.mjs`)だけを使い、外部ライブラリは使いません。**既存のテスト(`test/existing.test.mjs`)は、そのまま通り続けること。**

## 1. money.mjs の不具合修正
- `toCents(x)` は、四捨五入して整数のセントを返す。`toCents(19.99)` は `1999`、`toCents(0.1 + 0.2)` は `30`。
- `x` が数値でない(文字列など)なら `TypeError`、負の数・`NaN`・`Infinity` なら `RangeError` を投げる。

## 2. discount.mjs の不具合修正
- `percent`: 値引き額は `subtotalCents * value / 100` を**四捨五入**(.5 は切り上げ)した整数。`value` が 0 以上 100 以下でなければ `RangeError`。
- `fixed`: 値引き額は `value`(セント)だが、`subtotalCents` を超えない(超えるなら `subtotalCents`)。`value` が 0 以上の整数でなければ `RangeError`。
- ルールが無ければ 0、種類が不明なら `Error`(今まで通り)。

## 3. 在庫の追加(catalog.mjs・cart.mjs)
- `catalog.add(sku, { name, price, stock })`: `stock` は 0 以上の整数。省略したら無制限(`Infinity`)。それ以外の値は `RangeError`。
- `catalog.get(sku)` と `catalog.list()` の各商品に `stock` を含める。
- `catalog.reduceStock(sku, qty)`: 在庫を `qty` 減らす。足りなければ `Error`(メッセージは `在庫が足りません: <sku>`)で、在庫は変えない。無い sku は `Error("unknown sku: <sku>")`。
- `cart.add(sku, qty)`: カートにすでにある数との合計が在庫を超えるなら、`Error("在庫が足りません: <sku>")` を投げ、カートは変えない。

## 4. 注文モジュール(新規 `src/orders.mjs`)
- `export function createOrders(catalog)` が `{ checkout(cart, { discount } = {}), get(id), list() }` を返す。
- `checkout`: カートが空なら `Error("カートが空です")`。そうでなければ、在庫を減らし(1つでも足りなければ何も変えず `Error("在庫が足りません: <sku>")`)、カートを空にして、次の注文を返す:
  `{ id, lines: [{ sku, qty, unitCents, lineCents }], subtotalCents, discountCents, totalCents }`
  - `id` は `ORD-0001`、`ORD-0002`、… (`createOrders` ごとに 1 から数える)。
  - `lines` は sku の昇順。`lineCents = unitCents * qty`。
  - `discountCents` は `applyDiscount(subtotalCents, discount)`。`totalCents = subtotalCents - discountCents`。
- `get(id)` は注文(なければ `undefined`)、`list()` は作った順の配列。

## 5. 提出するもの
- 変更したコードと、新しい動きを確かめるテスト(`test/` に追加。`node --test` で動く形)。
- `README.md` に、在庫・値引き・注文の使い方を追記。
