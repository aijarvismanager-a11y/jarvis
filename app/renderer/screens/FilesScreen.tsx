import { useEffect, useState } from 'react';
import { useAppState } from '../state';
import { Button } from '../design/ui/Button';

interface Change {
  event: string;
  path: string;
  at: string;
}

const EVENT_LABEL: Record<string, string> = {
  add: '追加',
  change: '変更',
  unlink: '削除',
};

export function FilesScreen() {
  const { activeProjectId, projects } = useAppState();
  const [changes, setChanges] = useState<Change[]>([]);
  const activeProject = projects.find((p) => p.id === activeProjectId);

  useEffect(() => {
    const unsubscribe = window.api.onFilesChanged((payload) => {
      setChanges((prev) => [{ ...payload, at: new Date().toLocaleTimeString('ja-JP') }, ...prev].slice(0, 100));
    });
    return unsubscribe;
  }, []);

  if (!activeProjectId || !activeProject) {
    return (
      <div className="screen">
        <h1 className="screen__title">ファイル監視</h1>
        <div className="empty-state">プロジェクト画面でプロジェクトを選択してください。</div>
      </div>
    );
  }

  return (
    <div className="screen">
      <div className="screen__header">
        <div>
          <h1 className="screen__title">ファイル監視</h1>
          <p className="screen__subtitle">{activeProject.name} フォルダの変更を軽量に監視します。</p>
        </div>
        <Button onClick={() => window.api.projects.openFolder(activeProject.id)}>フォルダを開く</Button>
      </div>
      <div className="list">
        {changes.length === 0 && <div className="empty-state">まだ変更はありません。</div>}
        {changes.map((c, i) => (
          <div key={i} className="card row" style={{ justifyContent: 'space-between' }}>
            <span>🔔 {c.path}</span>
            <span style={{ color: 'var(--ink2)', fontSize: 13 }}>{EVENT_LABEL[c.event] ?? c.event} · {c.at}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
