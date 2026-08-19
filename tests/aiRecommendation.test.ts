import { describe, it, expect } from 'vitest';
import { matchCategories, rankServices, suggestTopAI } from '../app/renderer/lib/aiRecommendation';
import type { AIService } from '../app/renderer/types';

function service(overrides: Partial<AIService>): AIService {
  return {
    id: 'svc',
    name: 'Service',
    url: 'https://example.com/',
    icon: '🔧',
    category: [],
    image_generation: false,
    free: true,
    free_note: '',
    japanese: true,
    description: '',
    enabled: true,
    ...overrides,
  };
}

describe('matchCategories', () => {
  it('returns no categories for blank input', () => {
    expect(matchCategories('   ')).toEqual([]);
  });

  it('matches a coding-related phrase', () => {
    expect(matchCategories('Webサイトのコードを修正したい')).toContain('coding');
  });

  it('can match multiple categories at once', () => {
    const cats = matchCategories('記事のための画像を作りたい');
    expect(cats).toEqual(expect.arrayContaining(['writing', 'image']));
  });
});

describe('rankServices', () => {
  const claude = service({ id: 'claude', name: 'Claude', category: ['coding', 'writing'] });
  const gemini = service({ id: 'gemini', name: 'Gemini', category: ['research', 'image'] });
  const disabled = service({ id: 'disabled', name: 'Disabled', category: ['coding'], enabled: false });

  it('ranks services by number of matched categories, highest first', () => {
    const ranked = rankServices([claude, gemini], ['coding', 'writing']);
    expect(ranked.map((r) => r.service.id)).toEqual(['claude']);
    expect(ranked[0].score).toBe(2);
  });

  it('excludes disabled services even if their category matches', () => {
    const ranked = rankServices([disabled], ['coding']);
    expect(ranked).toEqual([]);
  });

  it('returns nothing when no categories matched', () => {
    expect(rankServices([claude, gemini], [])).toEqual([]);
  });
});

describe('suggestTopAI', () => {
  const claude = service({ id: 'claude', name: 'Claude', category: ['coding'] });
  const gemini = service({ id: 'gemini', name: 'Gemini', category: ['research'] });

  it('picks the best-matching service for the text', () => {
    expect(suggestTopAI('バグを修正して', [claude, gemini])?.id).toBe('claude');
  });

  it('returns null instead of an arbitrary default when nothing matches', () => {
    // A silent fallback here would make the "recommendation" a fixed pick
    // that ignores the text — honest null lets the caller ask the user instead.
    expect(suggestTopAI('こんにちは', [claude, gemini])).toBeNull();
  });

  it('returns null when there are no enabled services at all', () => {
    const disabledOnly = service({ id: 'disabled', enabled: false });
    expect(suggestTopAI('バグを修正して', [disabledOnly])).toBeNull();
  });
});
