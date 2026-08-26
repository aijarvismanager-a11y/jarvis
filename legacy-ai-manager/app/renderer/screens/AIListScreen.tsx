import { useAppState } from '../state';
import { Button } from '../design/ui/Button';
import { Chip } from '../design/ui/Chip';

export function AIListScreen() {
  const { services, categories } = useAppState();
  const labelOf = (id: string) => categories.find((c) => c.id === id)?.label ?? id;

  return (
    <div className="screen">
      <div className="screen__header">
        <div>
          <h1 className="screen__title">AI一覧</h1>
          <p className="screen__subtitle">既定ブラウザでAIサービスを開きます。ログインは各サービス側で行ってください。</p>
        </div>
      </div>
      <div className="card-grid">
        {services.filter((s) => s.enabled).map((service) => (
          <div key={service.id} className="card">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <div style={{ fontSize: 24 }}>{service.icon}</div>
              {service.image_generation && <Chip tone="accent">画像生成</Chip>}
            </div>
            <h3 style={{ margin: '8px 0 4px' }}>{service.name}</h3>
            <p style={{ color: 'var(--ink2)', fontSize: 13, margin: '0 0 8px' }}>{service.description}</p>
            <div className="row row--wrap" style={{ marginBottom: 8 }}>
              {service.category.map((c) => (
                <Chip key={c}>{labelOf(c)}</Chip>
              ))}
            </div>
            <p style={{ color: 'var(--faint)', fontSize: 12, margin: '0 0 12px' }}>
              {service.free ? service.free_note : '有料サービス'}
            </p>
            <Button variant="primary" onClick={() => window.api.ai.open(service.url, service.name)}>
              {service.name} を開く
            </Button>
          </div>
        ))}
        {services.filter((s) => s.enabled).length === 0 && (
          <div className="empty-state">有効なAIサービスがありません。設定から追加してください。</div>
        )}
      </div>
    </div>
  );
}
