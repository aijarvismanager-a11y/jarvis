// 値引き額(セント)を返す。
export function applyDiscount(subtotalCents, rule) {
  if (!rule) return 0;
  if (rule.type === "percent") return Math.floor((subtotalCents * rule.value) / 100);
  if (rule.type === "fixed") return rule.value;
  throw new Error("unknown rule: " + rule.type);
}
