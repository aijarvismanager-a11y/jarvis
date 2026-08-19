import type { AIService } from '../types';

// Single source of truth for "which category does this text sound like" —
// previously duplicated (and drifting) between RouterScreen and TasksScreen.
export const KEYWORD_MAP: Record<string, string[]> = {
  coding: [
    'コード', 'コーディング', '実装', 'バグ', '修正', 'プログラム', 'プログラミング', 'サイト', 'アプリ',
    '開発', '構築', 'エラー', 'デバッグ', '関数', 'API', 'データベース', 'DB', 'テスト', '環境構築',
  ],
  research: [
    '調査', '検索', 'リサーチ', '情報', '比較', '市場', 'まとめ', '収集', '情報収集', '資料', '出典',
    'ファクトチェック', '一次情報', '年表', '歴史', 'データ入力', '整理', 'アーカイブ',
  ],
  writing: [
    '文章', '記事', 'ブログ', '執筆', 'ライティング', '要約', '企画', '原稿', '校正', 'リライト',
    '構成', '見出し', 'タイトル', 'キャッチコピー', '台本',
  ],
  image: ['画像', 'イラスト', 'デザイン', 'アイコン', '写真', 'ロゴ', 'バナー', 'サムネイル'],
  analysis: ['分析', 'レビュー', '評価', '検証', '集計', '統計', '考察', '検討', '診断'],
  general: ['相談', '雑談', 'アイデア', '質問', 'ブレスト'],
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
// (e.g. auto-assigning a new task). Returns null when nothing genuinely
// matched — callers must not paper over that with an arbitrary default, or
// the "recommendation" silently becomes a fixed pick that ignores the text.
export function suggestTopAI(text: string, services: AIService[]): AIService | null {
  const ranked = rankServices(services, matchCategories(text));
  return ranked[0]?.service ?? null;
}
