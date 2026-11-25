// 金額は「セント(整数)」で持つ。
export function toCents(x) {
  return Math.floor(x * 100);
}
export function fromCents(c) {
  return c / 100;
}
export function formatPrice(c) {
  return "$" + (c / 100).toFixed(2);
}
