export function createCart(catalog) {
  const lines = new Map();
  const items = () =>
    [...lines]
      .map(([sku, qty]) => ({ sku, qty, unitCents: catalog.get(sku).priceCents }))
      .sort((a, b) => (a.sku < b.sku ? -1 : a.sku > b.sku ? 1 : 0));
  return {
    add(sku, qty = 1) {
      if (!catalog.get(sku)) throw new Error("unknown sku: " + sku);
      if (!Number.isInteger(qty) || qty < 1) throw new RangeError("bad qty: " + qty);
      lines.set(sku, (lines.get(sku) ?? 0) + qty);
    },
    remove(sku) {
      lines.delete(sku);
    },
    items,
    subtotalCents() {
      return items().reduce((s, l) => s + l.unitCents * l.qty, 0);
    },
    clear() {
      lines.clear();
    },
  };
}
