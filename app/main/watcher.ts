import chokidar, { type FSWatcher } from 'chokidar';
import path from 'node:path';
import { Notification, type BrowserWindow } from 'electron';
import { loadSettings } from './store/settings';

const EVENT_LABEL: Record<string, string> = { add: '追加', change: '変更', unlink: '削除' };

let watcher: FSWatcher | null = null;
let watchedDir: string | null = null;

export function watchProject(win: BrowserWindow, projectDir: string | null): void {
  if (watcher) {
    watcher.close();
    watcher = null;
    watchedDir = null;
  }
  if (!projectDir) return;

  watchedDir = projectDir;
  watcher = chokidar.watch(projectDir, {
    ignoreInitial: true,
    depth: 4,
    ignored: (p) => path.basename(p) === 'tasks.json',
  });

  const notify = (event: string, filePath: string) => {
    if (win.isDestroyed()) return;
    const relativePath = path.relative(watchedDir!, filePath);
    win.webContents.send('files:changed', { event, path: relativePath });

    // Only interrupt with an OS notification when the window isn't visible
    // anyway — otherwise the in-app "ファイル監視" list already shows this.
    if (!win.isFocused() && loadSettings().notificationsEnabled && Notification.isSupported()) {
      new Notification({
        title: 'AI Orchestrator',
        body: `${relativePath}（${EVENT_LABEL[event] ?? event}）`,
      }).show();
    }
  };

  watcher.on('add', (p) => notify('add', p));
  watcher.on('change', (p) => notify('change', p));
  watcher.on('unlink', (p) => notify('unlink', p));
}

export function stopWatching(): void {
  watcher?.close();
  watcher = null;
  watchedDir = null;
}
