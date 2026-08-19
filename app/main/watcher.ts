import chokidar, { type FSWatcher } from 'chokidar';
import path from 'node:path';
import type { BrowserWindow } from 'electron';

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
    win.webContents.send('files:changed', {
      event,
      path: path.relative(watchedDir!, filePath),
    });
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
