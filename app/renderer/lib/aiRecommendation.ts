import type { AIService } from '../types';

// Single source of truth for "which category does this text sound like" —
// previously duplicated (and drifting) between RouterScreen and TasksScreen.
export const KEYWORD_MAP: Record<string, string[]> = {
  coding: ['コード', 'コーディング', '実装', 'バグ', '修正', 'プログラム', 'サイト', 'アプリ'],
  research: ['調査', '検索', 'リサーチ', '情報', '比較', '市場'],
  writing: ['文章', '記事', 'ブログ', '執筆', 'ライティング', '要約', '企画'],
  image: ['画像', 'イラスト', 'デザイン', 'アイコン', '写真'],
  analysis: ['分析', 'レビュー', '評価', '検証'],
  general: ['相談', '雑談', 'アイデア'],
};

export function matchCategories(text: string): string[] {
  if (!text.trim()) return [];
  const hits = new Set<string>();
  for (const [category, keywords] of Object.entries(KEYWORD_MAP)) {
    if (keywords.some((k) => text.includes(k))) hits.add(category);
  }
  return Array.from(hits);
}

export interface RankedService {
  service: AIService;
  score: number;
}

export function rankServices(services: AIService[], matchedCategories: string[]): RankedService[] {
  if (matchedCategories.length === 0) return [];
  return services
    .filter((s) => s.enabled)
    .map((s) => ({ service: s, score: s.category.filter((c) => matchedCategories.includes(c)).length }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score);
}

// Convenience for call sites that just want "the one best AI for this text"
// (e.g. auto-assigning a new task), falling back to the first enabled
// service when nothing matches rather than leaving the field blank.
export function suggestTopAI(text: string, services: AIService[]): AIService | null {
  const ranked = rankServices(services, matchCategories(text));
  return ranked[0]?.service ?? services.find((s) => s.enabled) ?? null;
}
