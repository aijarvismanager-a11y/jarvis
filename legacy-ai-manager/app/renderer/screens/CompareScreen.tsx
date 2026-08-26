import { useAppState } from '../state';

const RATING: Record<string, Record<string, string>> = {
  coding: { claude: '◎', gemini: '○', chatgpt: '○' },
  research: { claude: '○', gemini: '◎', chatgpt: '◎' },
  writing: { claude: '◎', gemini: '○', chatgpt: '◎' },
  image: { claude: '×', gemini: '◎', chatgpt: '◎' },
  analysis: { claude: '◎', gemini: '○', chatgpt: '○' },
};

export function CompareScreen() {
  const { services, categories } = useAppState();

  return (
    <div className="screen">
      <div className="screen__header">
        <div>
          <h1 className="screen__title">AI比較</h1>
          <p className="screen__subtitle">
            各AIの「おすすめ用途」の目安です。固定的な評価として過信せず、参考情報としてご利用ください。
          </p>
        </div>
      </div>
      <div className="card" style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', padding: 8 }}>用途</th>
              {services.map((s) => (
                <th key={s.id} style={{ textAlign: 'center', padding: 8 }}>{s.icon} {s.name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Object.entries(RATING).map(([catId, row]) => (
              <tr key={catId} style={{ borderTop: '1px solid var(--rule)' }}>
                <td style={{ padding: 8 }}>{categories.find((c) => c.id === catId)?.label ?? catId}</td>
                {services.map((s) => (
                  <td key={s.id} style={{ textAlign: 'center', padding: 8 }}>{row[s.id] ?? '—'}</td>
                ))}
              </tr>
            ))}
            <tr style={{ borderTop: '1px solid var(--rule)' }}>
              <td style={{ padding: 8 }}>無料プラン</td>
              {services.map((s) => (
                <td key={s.id} style={{ textAlign: 'center', padding: 8 }}>{s.free ? '○' : '×'}</td>
              ))}
            </tr>
            <tr style={{ borderTop: '1px solid var(--rule)' }}>
              <td style={{ padding: 8 }}>日本語対応</td>
              {services.map((s) => (
                <td key={s.id} style={{ textAlign: 'center', padding: 8 }}>{s.japanese ? '◎' : '×'}</td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
