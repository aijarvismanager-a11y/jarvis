import test from "node:test";
import assert from "node:assert/strict";
import { createCatalog } from "../src/catalog.mjs";
import { createCart } from "../src/cart.mjs";
import { applyDiscount } from "../src/discount.mjs";

test("catalog: add and get", () => {
  const c = createCatalog();
  c.add("A1", { name: "pen", price: 2 });
  assert.equal(c.get("A1").priceCents, 200);
  assert.equal(c.get("zz"), undefined);
});
test("cart: subtotal", () => {
  const c = createCatalog();
  c.add("A1", { name: "pen", price: 2 });
  c.add("B2", { name: "ink", price: 5 });
  const cart = createCart(c);
  cart.add("A1", 3);
  cart.add("B2");
  assert.equal(cart.subtotalCents(), 1100);
});
test("discount: percent", () => assert.equal(applyDiscount(1000, { type: "percent", value: 10 }), 100));
