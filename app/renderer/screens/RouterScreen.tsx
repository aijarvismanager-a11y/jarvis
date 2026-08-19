import { useMemo, useState } from 'react';
import { useAppState } from '../state';
import { Button } from '../design/ui/Button';
import { Chip } from '../design/ui/Chip';
import type { AIService } from '../types';

const KEYWORD_MAP: Record<string, string[]> = {
  coding: ['コード', 'コーディング', '実装', 'バグ', '修正', 'プログラム', 'サイト', 'アプリ'],
  research: ['調査', '検索', 'リサーチ', '情報', '比較', '市場'],
  writing: ['文章', '記事', 'ブログ', '執筆', 'ライティング', '要約', '企画'],
  image: ['画像', 'イラスト', 'デザイン', 'アイコン', '写真'],
  analysis: ['分析', 'レビュー', '評価', '検証'],
  general: ['相談', '雑談', 'アイデア'],
};

function scoreService(service: AIService, matchedCategories: string[]): number {
  return service.category.filter((c) => matchedCategories.includes(c)).length;
}

export function RouterScreen() {
  const { services, categories } = useAppState();
  const [input, setInput] = useState('');

  const matchedCategories = useMemo(() => {
    if (!input.trim()) return [];
    const hits = new Set<string>();
    for (const [cat, keywords] of Object.entries(KEYWORD_MAP)) {
      if (keywords.some((k) => input.includes(k))) hits.add(cat);
    }
    return Array.from(hits);
  }, [input]);

  const ranked = useMemo(() => {
    if (matchedCategories.length === 0) return [];
    return services
      .filter((s) => s.enabled)
      .map((s) => ({ service: s, score: scoreService(s, matchedCategories) }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score);
  }, [services, matchedCategories]);

  const labelOf = (id: string) => categories.find((c) => c.id === id)?.label ?? id;
  const medals = ['🥇', '🥈', '🥉'];

  return (
    <div className="screen">
      <div className="screen__header">
        <div>
          <h1 className="screen__title">AI Router</h1>
          <p className="screen__subtitle">
            作業内容を入力すると、ローカルのカテゴリー情報からおすすめAIを提示します（AI自身は呼び出しません）。最終的にどのAIを使うかはあなたが選びます。
          </p>
        </div>
      </div>
      <div className="card">
        <div className="field">
          <label>作業内容</label>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="例：Webサイトのコードを修正したい"
          />
        </div>
      </div>

      {input.trim() && (
        <div className="list">
          {matchedCategories.length > 0 && (
            <div className="row row--wrap">
              判定カテゴリー:
              {matchedCategories.map((c) => (
                <Chip key={c} tone="accent">{labelOf(c)}</Chip>
              ))}
            </div>
          )}
          {ranked.length === 0 && (
            <div className="empty-state">一致するAIが見つかりませんでした。キーワードを変えてお試しください。</div>
          )}
          {ranked.map(({ service, score }, i) => (
            <div key={service.id} className="card row" style={{ justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontWeight: 600 }}>
                  {medals[i] ?? '　'} {service.name}
                </div>
                <div style={{ color: 'var(--ink2)', fontSize: 13 }}>
                  理由: {service.category.filter((c) => matchedCategories.includes(c)).map(labelOf).join('・')}に向いています（一致度 {score}）
                </div>
              </div>
              <Button variant="primary" onClick={() => window.api.ai.open(service.url, service.name)}>
                {service.name}を開く
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
