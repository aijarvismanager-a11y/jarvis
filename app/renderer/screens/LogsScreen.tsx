import { useEffect, useState } from 'react';
import type { LogEntry } from '../types';

export function LogsScreen() {
  const [logs, setLogs] = useState<LogEntry[]>([]);

  useEffect(() => {
    window.api.logs.list(200).then(setLogs);
  }, []);

  return (
    <div className="screen">
      <div className="screen__header">
        <div>
          <h1 className="screen__title">ログ</h1>
          <p className="screen__subtitle">AIの起動・プロジェクト作成・Handoff作成などの操作履歴です。</p>
        </div>
      </div>
      <div className="list">
        {logs.length === 0 && <div className="empty-state">まだ操作履歴がありません。</div>}
        {logs.map((entry, i) => (
          <div key={i} className="card row" style={{ justifyContent: 'space-between' }}>
            <span>{entry.ai ? `[${entry.ai}] ` : ''}{entry.message}</span>
            <span style={{ color: 'var(--ink2)', fontSize: 12, whiteSpace: 'nowrap' }}>
              {new Date(entry.timestamp).toLocaleString('ja-JP')}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
