import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import { resolveWorkspacePath } from './config';
import { PreviewEvent, WorkflowStep } from './types';

const DEBOUNCE_MS = 100;

/**
 * Watches only the output_files of the currently selected step (not the
 * whole workspace/), per the scoping decision in docs/design_review.md.
 * Watches each file's parent directory rather than the file itself so file
 * deletion and later re-creation (which some platforms report as
 * consecutive "rename" events) keep working instead of orphaning the watch.
 */
export class PreviewWatcher extends EventEmitter {
  private watchers: fs.FSWatcher[] = [];
  private timers = new Map<string, NodeJS.Timeout>();
  private knownExists = new Map<string, boolean>();

  watchStep(step: WorkflowStep): void {
    this.unwatchAll();

    const byDir = new Map<string, string[]>();
    for (const relativePath of step.output_files) {
      const absolutePath = resolveWorkspacePath(relativePath);
      const dir = path.dirname(absolutePath);
      const fileName = path.basename(absolutePath);
      if (!byDir.has(dir)) byDir.set(dir, []);
      byDir.get(dir)!.push(fileName);
      this.knownExists.set(relativePath, fs.existsSync(absolutePath));
    }

    for (const [dir, fileNames] of byDir) {
      if (!fs.existsSync(dir)) continue;
      const watcher = fs.watch(dir, (_eventType, changedName) => {
        if (!changedName || !fileNames.includes(changedName)) return;
        const relativePath = step.output_files.find(
          (f) => path.basename(resolveWorkspacePath(f)) === changedName && path.dirname(resolveWorkspacePath(f)) === dir
        );
        if (relativePath) this.scheduleEmit(relativePath);
      });
      this.watchers.push(watcher);
    }
  }

  private scheduleEmit(relativePath: string): void {
    const existing = this.timers.get(relativePath);
    if (existing) clearTimeout(existing);
    this.timers.set(
      relativePath,
      setTimeout(() => this.emitChange(relativePath), DEBOUNCE_MS)
    );
  }

  private emitChange(relativePath: string): void {
    this.timers.delete(relativePath);
    const absolutePath = resolveWorkspacePath(relativePath);
    const existed = this.knownExists.get(relativePath) ?? false;
    const exists = fs.existsSync(absolutePath);
    this.knownExists.set(relativePath, exists);

    if (!exists) {
      const event: PreviewEvent = { file: relativePath, type: 'deleted' };
      this.emit('preview', event);
      return;
    }

    const mtimeMs = fs.statSync(absolutePath).mtimeMs;
    const event: PreviewEvent = { file: relativePath, type: existed ? 'changed' : 'created', mtimeMs };
    this.emit('preview', event);
  }

  unwatchAll(): void {
    for (const watcher of this.watchers) watcher.close();
    this.watchers = [];
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.knownExists.clear();
  }
}
