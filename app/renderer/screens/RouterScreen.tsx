import { useMemo, useState } from 'react';
import { useAppState } from '../state';
import { Button } from '../design/ui/Button';
import { Chip } from '../design/ui/Chip';
import { matchCategories, rankServices } from '../lib/aiRecommendation';

export function RouterScreen() {
  const { services, categories } = useAppState();
  const [input, setInput] = useState('');

  const matchedCategories = useMemo(() => matchCategories(input), [input]);
  const ranked = useMemo(() => rankServices(services, matchedCategories), [services, matchedCategories]);

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
