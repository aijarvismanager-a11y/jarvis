import { TerminalExecutor, type CommandResult } from './executor.ts';
import { readFileSync, existsSync } from 'node:fs';

export class WSLBridge {
  private executor: TerminalExecutor;
  private windowsHome: string | null = null;
  private windowsHomeReady: Promise<void> = Promise.resolve();

  constructor() {
    this.executor = new TerminalExecutor();

    if (WSLBridge.isWSL()) {
      this.windowsHomeReady = this.detectWindowsHome();
    }
  }

  static isWSL(): boolean {
    try {
      if (process.platform !== 'linux') {
        return false;
      }

      if (existsSync('/proc/version')) {
        const version = readFileSync('/proc/version', 'utf-8').toLowerCase();
        return version.includes('microsoft') || version.includes('wsl');
      }

      if (process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP) {
        return true;
      }

      return false;
    } catch {
      return false;
    }
  }

  async runWindowsCommand(command: string): Promise<CommandResult> {
    if (!WSLBridge.isWSL()) {
      throw new Error('Not running in WSL environment');
    }

    try {
      return await this.executor.execute(`cmd.exe /C "${command.replace(/"/g, '\\"')}"`);
    } catch (error) {
      throw new Error(`Failed to run Windows command: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async runPowerShell(script: string): Promise<CommandResult> {
    if (!WSLBridge.isWSL()) {
      throw new Error('Not running in WSL environment');
    }

    try {
      const escapedScript = script
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\$/g, '\\$')
        .replace(/`/g, '\\`');

      return await this.executor.execute(`powershell.exe -Command "${escapedScript}"`);
    } catch (error) {
      throw new Error(`Failed to run PowerShell script: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Awaits detection before returning - the constructor kicks off
   * detectWindowsHome() without awaiting it, so callers that read
   * windowsHome synchronously right after `new WSLBridge()` would
   * otherwise always observe null/undetected, even on a real WSL box.
   */
  async getWindowsHome(): Promise<string | null> {
    await this.windowsHomeReady;
    return this.windowsHome;
  }

  private async detectWindowsHome(): Promise<void> {
    try {
      const result = await this.executor.execute('cmd.exe /C "echo %USERPROFILE%"');
      const path = result.stdout.trim();

      if (path && !path.includes('%')) {
        this.windowsHome = this.convertWindowsPath(path);
      }
    } catch {
      this.windowsHome = null;
    }
  }

  private convertWindowsPath(windowsPath: string): string {
    const normalized = windowsPath.replace(/\\/g, '/');

    const driveMatch = normalized.match(/^([A-Z]):/i);
    if (driveMatch) {
      const drive = driveMatch[1]?.toLowerCase();
      const rest = normalized.slice(2);
      return `/mnt/${drive}${rest}`;
    }

    return normalized;
  }

  async convertToWindowsPath(wslPath: string): Promise<string> {
    if (!WSLBridge.isWSL()) {
      throw new Error('Not running in WSL environment');
    }

    try {
      const result = await this.executor.execute(`wslpath -w "${wslPath}"`);
      return result.stdout.trim();
    } catch (error) {
      throw new Error(`Failed to convert WSL path: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async convertToWSLPath(windowsPath: string): Promise<string> {
    if (!WSLBridge.isWSL()) {
      throw new Error('Not running in WSL environment');
    }

    try {
      const result = await this.executor.execute(`wslpath -u "${windowsPath}"`);
      return result.stdout.trim();
    } catch (error) {
      throw new Error(`Failed to convert Windows path: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
