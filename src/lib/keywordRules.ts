import { matchesKeyword } from "./tokenize";

// Shared "first matching rule wins" lookup used by both the text-AI and
// image-AI recommendation heuristics (ideaRecommendation.ts /
// imageRecommendation.ts) — they had near-identical loops over their own
// rule lists, differing only in what each rule carries as its result.
export type KeywordRule<T> = { keywords: string[] } & T;

export function matchKeywordRules<T>(text: string, rules: KeywordRule<T>[]): T | null {
  return rules.find((r) => r.keywords.some((k) => matchesKeyword(text, k))) ?? null;
}
