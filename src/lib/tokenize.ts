// Word-boundary-aware keyword matching for the AI-recommendation heuristics,
// using the browser's built-in Intl.Segmenter (ja, word granularity) —
// no dictionary download, no API, fully local.
//
// Plain `text.includes(keyword)` (the previous approach) can false-positive
// when a keyword's characters happen to appear as a substring split across
// two unrelated words (e.g. "実装" matching inside "充実装置", which has
// nothing to do with implementation). This checks that a keyword match
// starts and ends exactly on a real word boundary rather than mid-word.
//
// Note this is intentionally *not* "the keyword must equal one token":
// ICU's segmenter routinely splits compound nouns and loanwords more finely
// than a curated keyword list expects (e.g. "表計算" -> "表" + "計算",
// "アイコン" -> "アイコ" + "ン"). Requiring only that the match's start/end
// land on token boundaries — not that it be a single token — lets a keyword
// span multiple consecutive tokens, which covers those compounds, verb
// stems followed by inflection ("調べ" + "たい"), and full-phrase keywords
// alike, while still rejecting a match buried inside an unrelated token.

let segmenter: Intl.Segmenter | null | undefined;

function getSegmenter(): Intl.Segmenter | null {
  if (segmenter !== undefined) return segmenter;
  segmenter =
    typeof Intl !== "undefined" && typeof Intl.Segmenter === "function"
      ? new Intl.Segmenter("ja", { granularity: "word" })
      : null;
  return segmenter;
}

export function tokenize(text: string): string[] {
  const seg = getSegmenter();
  if (!seg) return [];
  const tokens: string[] = [];
  for (const part of seg.segment(text)) {
    if (part.isWordLike) tokens.push(part.segment);
  }
  return tokens;
}

function wordBoundaries(text: string): Set<number> {
  const seg = getSegmenter();
  const boundaries = new Set<number>([0, text.length]);
  if (!seg) return boundaries;
  for (const part of seg.segment(text)) {
    boundaries.add(part.index);
    boundaries.add(part.index + part.segment.length);
  }
  return boundaries;
}

export function matchesKeyword(text: string, keyword: string): boolean {
  if (!keyword) return false;
  const seg = getSegmenter();
  if (!seg) return text.includes(keyword); // Intl.Segmenter unavailable — behave like before
  const boundaries = wordBoundaries(text);
  let fromIndex = 0;
  for (;;) {
    const idx = text.indexOf(keyword, fromIndex);
    if (idx === -1) return false;
    if (boundaries.has(idx) && boundaries.has(idx + keyword.length)) return true;
    fromIndex = idx + 1;
  }
}
