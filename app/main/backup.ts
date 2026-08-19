import path from 'node:path';
import fs from 'node:fs';
import AdmZip from 'adm-zip';
import { dialog, BrowserWindow } from 'electron';
import { dataDir } from './paths';

// Only the app's own data — dataDir doubles as Electron's userData profile in a
// packaged build, which also holds Chromium's Cache/Cookies/Local Storage/etc.
// Backing up the whole folder would bundle browser internals into the zip.
const BACKUP_ENTRIES = ['projects.json', 'prompts.json', 'logs.jsonl', 'config'];

export async function createBackup(win: BrowserWindow): Promise<{ ok: boolean; path?: string }> {
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'バックアップを作成',
    defaultPath: `ai-orchestrator-backup-${new Date().toISOString().slice(0, 10)}.zip`,
    filters: [{ name: 'ZIP', extensions: ['zip'] }],
  });
  if (canceled || !filePath) return { ok: false };

  const zip = new AdmZip();
  for (const entry of BACKUP_ENTRIES) {
    const entryPath = path.join(dataDir, entry);
    if (!fs.existsSync(entryPath)) continue;
    if (fs.statSync(entryPath).isDirectory()) {
      zip.addLocalFolder(entryPath, entry);
    } else {
      zip.addLocalFile(entryPath);
    }
  }
  zip.writeZip(filePath);
  return { ok: true, path: filePath };
}

export async function restoreBackup(win: BrowserWindow): Promise<{ ok: boolean }> {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'バックアップから復元',
    properties: ['openFile'],
    filters: [{ name: 'ZIP', extensions: ['zip'] }],
  });
  if (canceled || filePaths.length === 0) return { ok: false };

  const { response } = await dialog.showMessageBox(win, {
    type: 'warning',
    buttons: ['キャンセル', '復元する'],
    defaultId: 0,
    cancelId: 0,
    title: '復元の確認',
    message: '現在のデータを選択したバックアップで上書きします。よろしいですか？',
  });
  if (response !== 1) return { ok: false };

  const zip = new AdmZip(filePaths[0]);
  for (const entry of BACKUP_ENTRIES) {
    fs.rmSync(path.join(dataDir, entry), { recursive: true, force: true });
  }
  zip.extractAllTo(dataDir, true);
  return { ok: true };
}
