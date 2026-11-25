import { toCents } from "./money.mjs";

export function createCatalog() {
  const items = new Map();
  return {
    add(sku, { name, price }) {
      if (items.has(sku)) throw new Error("duplicate sku: " + sku);
      items.set(sku, { sku, name, priceCents: toCents(price) });
    },
    get(sku) {
      const p = items.get(sku);
      return p ? { ...p } : undefined;
    },
    list() {
      return [...items.values()].map((p) => ({ ...p })).sort((a, b) => (a.sku < b.sku ? -1 : a.sku > b.sku ? 1 : 0));
    },
  };
}
