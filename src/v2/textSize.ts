// Screen text size: the whole window is scaled (CSS zoom, which the desktop app's Chromium supports), so every small caption grows too.
export const TEXT_SIZES = [
  { id: "normal", label: "標準", zoom: 1 },
  { id: "large", label: "大", zoom: 1.2 },
  { id: "xlarge", label: "特大", zoom: 1.4 },
] as const;
export type TextSizeId = (typeof TEXT_SIZES)[number]["id"];

const KEY = "orchestrator.textSize";
export const DEFAULT_TEXT_SIZE: TextSizeId = "large";

export function readTextSize(): TextSizeId {
  try {
    const v = localStorage.getItem(KEY);
    if (TEXT_SIZES.some((s) => s.id === v)) return v as TextSizeId;
  } catch {
    /* storage unavailable: the default is used */
  }
  return DEFAULT_TEXT_SIZE;
}

export function applyTextSize(id: TextSizeId): void {
  const zoom = TEXT_SIZES.find((s) => s.id === id)?.zoom ?? 1;
  (document.documentElement.style as CSSStyleDeclaration & { zoom: string }).zoom = String(zoom);
  try {
    localStorage.setItem(KEY, id);
  } catch {
    /* the choice just won't be remembered */
  }
}
