// 固定テスト。使い方: BENCH_APP_DIR=<完成品のフォルダ> node --test benchmark/shop-change/hidden-tests
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const appDir = process.env.BENCH_APP_DIR;
if (!appDir) throw new Error("BENCH_APP_DIR に完成品のフォルダを指定してください");
const imp = (f) => import(pathToFileURL(path.resolve(appDir, f)).href);
const { toCents } = await imp("src/money.mjs");
const { applyDiscount } = await imp("src/discount.mjs");
const { createCatalog } = await imp("src/catalog.mjs");
const { createCart } = await imp("src/cart.mjs");
const { createOrders } = await imp("src/orders.mjs");

test("01 money: 四捨五入", () => { assert.equal(toCents(19.99), 1999); assert.equal(toCents(0.1 + 0.2), 30); assert.equal(toCents(2), 200); assert.equal(toCents(0), 0); });
test("02 money: 数値でなければ TypeError", () => { assert.throws(() => toCents("1"), TypeError); assert.throws(() => toCents(null), TypeError); });
test("03 money: 負・NaN・Infinity は RangeError", () => { for (const v of [-1, NaN, Infinity]) assert.throws(() => toCents(v), RangeError); });

test("04 discount: percent は四捨五入", () => {
  assert.equal(applyDiscount(1005, { type: "percent", value: 10 }), 101);
  assert.equal(applyDiscount(999, { type: "percent", value: 10 }), 100);
  assert.equal(applyDiscount(1000, { type: "percent", value: 10 }), 100);
  assert.equal(applyDiscount(333, { type: "percent", value: 50 }), 167);
});
test("05 discount: percent の範囲", () => {
  assert.throws(() => applyDiscount(100, { type: "percent", value: 101 }), RangeError);
  assert.throws(() => applyDiscount(100, { type: "percent", value: -1 }), RangeError);
  assert.equal(applyDiscount(100, { type: "percent", value: 100 }), 100);
  assert.equal(applyDiscount(100, { type: "percent", value: 0 }), 0);
});
test("06 discount: fixed は小計を超えない", () => { assert.equal(applyDiscount(500, { type: "fixed", value: 300 }), 300); assert.equal(applyDiscount(500, { type: "fixed", value: 900 }), 500); });
test("07 discount: fixed の不正値は RangeError", () => { assert.throws(() => applyDiscount(500, { type: "fixed", value: -1 }), RangeError); assert.throws(() => applyDiscount(500, { type: "fixed", value: 1.5 }), RangeError); });
test("08 discount: ルール無しは0、不明は Error", () => { assert.equal(applyDiscount(500), 0); assert.equal(applyDiscount(500, null), 0); assert.throws(() => applyDiscount(500, { type: "x" }), Error); });

const make = () => { const c = createCatalog(); c.add("B2", { name: "ink", price: 5.5, stock: 3 }); c.add("A1", { name: "pen", price: 1.99 }); return c; };
test("09 catalog: stock を持つ・省略は無制限", () => {
  const c = make();
  assert.equal(c.get("B2").stock, 3); assert.equal(c.get("A1").stock, Infinity);
  assert.equal(c.list().map((p) => p.sku).join(), "A1,B2"); assert.equal(c.list()[1].stock, 3); assert.equal(c.get("A1").priceCents, 199);
});
test("10 catalog: stock の不正値は RangeError", () => { const c = createCatalog(); let i = 0; for (const s of [-1, 1.5, "3", NaN]) assert.throws(() => c.add("X" + i++, { name: "x", price: 1, stock: s }), RangeError); });
test("11 catalog: reduceStock", () => {
  const c = make(); c.reduceStock("B2", 2); assert.equal(c.get("B2").stock, 1);
  assert.throws(() => c.reduceStock("B2", 2), /在庫が足りません: B2/); assert.equal(c.get("B2").stock, 1);
  assert.throws(() => c.reduceStock("zz", 1), /unknown sku: zz/);
});
test("12 catalog: 同じ sku の重複は Error", () => { const c = make(); assert.throws(() => c.add("A1", { name: "p", price: 1 }), /duplicate sku/); });
test("13 cart: 在庫を超える追加は Error、カートは変わらない", () => {
  const c = make(); const cart = createCart(c);
  cart.add("B2", 2);
  assert.throws(() => cart.add("B2", 2), /在庫が足りません: B2/);
  assert.deepEqual(cart.items(), [{ sku: "B2", qty: 2, unitCents: 550 }]);
  cart.add("B2", 1);
  assert.equal(cart.items()[0].qty, 3);
});
test("14 cart: 在庫無制限は何個でも", () => { const cart = createCart(make()); cart.add("A1", 1000); assert.equal(cart.subtotalCents(), 199000); });
test("15 cart: 既存の動き(不明sku、数量の不正)", () => { const cart = createCart(make()); assert.throws(() => cart.add("zz"), /unknown sku/); assert.throws(() => cart.add("A1", 0), RangeError); assert.throws(() => cart.add("A1", 1.5), RangeError); });

test("16 orders: checkout の中身", () => {
  const c = make(); const cart = createCart(c); const o = createOrders(c);
  cart.add("B2", 2); cart.add("A1", 3);
  const r = o.checkout(cart, { discount: { type: "percent", value: 10 } });
  assert.deepEqual(r, { id: "ORD-0001", lines: [{ sku: "A1", qty: 3, unitCents: 199, lineCents: 597 }, { sku: "B2", qty: 2, unitCents: 550, lineCents: 1100 }], subtotalCents: 1697, discountCents: 170, totalCents: 1527 });
});
test("17 orders: 在庫が減り、カートが空になる", () => {
  const c = make(); const cart = createCart(c); const o = createOrders(c);
  cart.add("B2", 2); o.checkout(cart);
  assert.equal(c.get("B2").stock, 1); assert.deepEqual(cart.items(), []); assert.equal(c.get("A1").stock, Infinity);
});
test("18 orders: 空のカートは Error", () => { const c = make(); assert.throws(() => createOrders(c).checkout(createCart(c)), /カートが空です/); });
test("19 orders: 連番・get・list・作った順", () => {
  const c = make(); const cart = createCart(c); const o = createOrders(c);
  cart.add("A1"); const a = o.checkout(cart); cart.add("A1", 2); const b = o.checkout(cart, { discount: { type: "fixed", value: 100 } });
  assert.equal(a.id, "ORD-0001"); assert.equal(b.id, "ORD-0002"); assert.equal(b.totalCents, 298);
  assert.equal(o.get("ORD-0002").id, "ORD-0002"); assert.equal(o.get("nope"), undefined); assert.deepEqual(o.list().map((x) => x.id), ["ORD-0001", "ORD-0002"]);
});
test("20 orders: 別の createOrders は 1 から数え直す", () => { const c = make(); const cart = createCart(c); createOrders(c); const o2 = createOrders(c); cart.add("A1"); assert.equal(o2.checkout(cart).id, "ORD-0001"); });
test("21 orders: 在庫が足りないと何も変えない", () => {
  const c = make(); const cart = createCart(c); const o = createOrders(c);
  cart.add("B2", 3); c.reduceStock("B2", 2);
  assert.throws(() => o.checkout(cart), /在庫が足りません: B2/);
  assert.equal(c.get("B2").stock, 1); assert.equal(cart.items().length, 1); assert.deepEqual(o.list(), []);
});
test("22 orders: 値引きなしなら total = subtotal", () => { const c = make(); const cart = createCart(c); cart.add("A1", 2); const r = createOrders(c).checkout(cart); assert.equal(r.discountCents, 0); assert.equal(r.totalCents, r.subtotalCents); });
