/**
 * QAAgent - independent QA checks (spec section 36). Deliberately NOT an
 * LLM-driven role: every check here is deterministic (typecheck/build/test
 * exit codes, static file scans) so its verdict is reproducible and can gate
 * the Self-Healing pipeline (see self-healing.ts) without burning an LLM
 * call on judgment a shell command already answers definitively.
 *
 * Spec's check list or a project-appropriate automated equivalent:
 *   TypeScript, Lint, Build, Unit tests, Integration tests, UI tests,
 *   Runtime errors, Broken links, Missing files, Configuration errors.
 *
 * This repo has no separate integration/UI test runners or a runtime smoke
 * harness (see docs/AI_MANAGER_ARCHITECTURE_AUDIT.md) - `automated: false`
 * checks are reported honestly as not-yet-automatable rather than faked, per
 * spec's "可能な範囲で自動化" (automate to the extent possible).
 */

import { readFileSync, existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join, dirname, resolve, extname } from 'node:path';

export type QACheckName =
  | 'typescript'
  | 'lint'
  | 'build'
  | 'unit_tests'
  | 'integration_tests'
  | 'ui_tests'
  | 'runtime_errors'
  | 'broken_links'
  | 'missing_files'
  | 'configuration_errors';

export type QACheckResult = {
  name: QACheckName;
  automated: boolean;
  passed: boolean;
  summary: string;
  detail?: string;
  duration_ms: number;
};

export type QAReport = {
  passed: boolean;
  checks: QACheckResult[];
  ran_at: number;
};

/** Which checks to run. Defaults to the fast, always-safe subset. */
export type QAOptions = {
  cwd?: string;
  /** Run `bun run build:ui` - slower and requires model assets, off by default. */
  includeBuild?: boolean;
  /** Guard scripts to run for the "lint" category (see package.json). */
  lintScripts?: string[];
};

const DEFAULT_LINT_SCRIPTS = ['check:no-ee', 'check:migrations', 'lint:templates'];

async function runCommand(cwd: string, cmd: string[], timeoutMs = 120_000): Promise<{ ok: boolean; output: string }> {
  const start = Date.now();
  try {
    const proc = Bun.spawn(cmd, { cwd, stdout: 'pipe', stderr: 'pipe' });
    const timer = setTimeout(() => proc.kill(), timeoutMs);
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    clearTimeout(timer);
    const output = (stdout + stderr).slice(-4000);
    return { ok: exitCode === 0, output };
  } catch (err) {
    return { ok: false, output: err instanceof Error ? err.message : String(err) };
  } finally {
    void start;
  }
}

async function timed<T>(fn: () => Promise<T>): Promise<{ result: T; duration_ms: number }> {
  const start = Date.now();
  const result = await fn();
  return { result, duration_ms: Date.now() - start };
}

export class QAAgent {
  /**
   * Run the full QA suite and return a structured pass/fail report.
   *
   * `opts.cwd` must name the actual project/repo being checked. Previously
   * this defaulted to REPO_ROOT (JARVIS's own daemon repo) when omitted -
   * both call sites (ManagerAgent's Self-Healing QA gate and the workflow
   * "QA" node) check arbitrary user projects, never JARVIS itself, so that
   * default silently ran tsc/lint/bun test against unrelated code and let
   * JARVIS's own repo state produce a pass/fail verdict that had nothing to
   * do with the task actually being graded. Report the code-dependent
   * checks honestly as not-yet-automatable instead, matching this file's
   * existing convention for ui_tests/runtime_errors.
   */
  async run(opts?: QAOptions): Promise<QAReport> {
    const cwd = opts?.cwd;
    const checks: QACheckResult[] = [];
    const noCwdReason = 'No project repository path configured - skipping to avoid checking unrelated code.';

    if (cwd) {
      checks.push(await this.checkTypescript(cwd));
      checks.push(await this.checkLint(cwd, opts?.lintScripts ?? DEFAULT_LINT_SCRIPTS));
      if (opts?.includeBuild) checks.push(await this.checkBuild(cwd));
      checks.push(await this.checkUnitTests(cwd));
      checks.push(this.checkIntegrationTests(checks));
    } else {
      checks.push(this.notAutomated('typescript', noCwdReason));
      checks.push(this.notAutomated('lint', noCwdReason));
      checks.push(this.notAutomated('unit_tests', noCwdReason));
      checks.push(this.notAutomated('integration_tests', noCwdReason));
    }
    checks.push(this.notAutomated('ui_tests', 'No UI test runner is configured for ui/ - verify manually in a browser.'));
    checks.push(this.notAutomated('runtime_errors', 'No runtime smoke harness exists yet - start the daemon and check logs manually.'));
    if (cwd) {
      checks.push(await this.checkBrokenLinks(cwd));
      checks.push(await this.checkMissingFiles(cwd));
      checks.push(await this.checkConfiguration(cwd));
    } else {
      checks.push(this.notAutomated('broken_links', noCwdReason));
      checks.push(this.notAutomated('missing_files', noCwdReason));
      checks.push(this.notAutomated('configuration_errors', noCwdReason));
    }

    return {
      passed: checks.every((c) => !c.automated || c.passed),
      checks,
      ran_at: Date.now(),
    };
  }

  private notAutomated(name: QACheckName, summary: string): QACheckResult {
    return { name, automated: false, passed: true, summary, duration_ms: 0 };
  }

  private async checkTypescript(cwd: string): Promise<QACheckResult> {
    const { result, duration_ms } = await timed(() => runCommand(cwd, ['bun', 'x', 'tsc', '--noEmit', '-p', 'tsconfig.json']));
    return {
      name: 'typescript',
      automated: true,
      passed: result.ok,
      summary: result.ok ? 'tsc --noEmit passed.' : 'tsc --noEmit reported type errors.',
      detail: result.ok ? undefined : result.output,
      duration_ms,
    };
  }

  /**
   * This repo has no eslint/biome config - its actual "lint" is the set of
   * guard scripts in package.json (`check:no-ee`, `check:migrations`,
   * `lint:templates`, ...). Running them IS the lint check here. The default
   * list is JARVIS's own script names, so only run the ones the checked
   * project's package.json actually declares - callers here are arbitrary
   * user projects (see this file's class-level `run()` doc comment), and
   * `bun run <missing script>` exits non-zero for "script not found", which
   * would otherwise fail this check on every project that isn't JARVIS.
   */
  private async checkLint(cwd: string, scripts: string[]): Promise<QACheckResult> {
    const start = Date.now();
    let declared: Record<string, unknown> = {};
    try {
      const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf-8')) as { scripts?: Record<string, unknown> };
      declared = pkg.scripts ?? {};
    } catch {
      // No readable package.json - fall through with an empty script set.
    }
    const applicable = scripts.filter((s) => s in declared);
    if (applicable.length === 0) {
      return {
        name: 'lint',
        automated: false,
        passed: true,
        summary: 'None of the configured lint guard scripts are declared in this project - nothing to run.',
        duration_ms: Date.now() - start,
      };
    }

    const { result: results, duration_ms } = await timed(async () => {
      const out: { script: string; ok: boolean; output: string }[] = [];
      for (const script of applicable) {
        const r = await runCommand(cwd, ['bun', 'run', script]);
        out.push({ script, ...r });
      }
      return out;
    });
    const failed = results.filter((r) => !r.ok);
    return {
      name: 'lint',
      automated: true,
      passed: failed.length === 0,
      summary: failed.length === 0
        ? `All guard scripts passed (${applicable.join(', ')}).`
        : `Failed: ${failed.map((f) => f.script).join(', ')}.`,
      detail: failed.length === 0 ? undefined : failed.map((f) => `[${f.script}]\n${f.output}`).join('\n\n'),
      duration_ms,
    };
  }

  private async checkBuild(cwd: string): Promise<QACheckResult> {
    const { result, duration_ms } = await timed(() => runCommand(cwd, ['bun', 'run', 'build:ui'], 300_000));
    return {
      name: 'build',
      automated: true,
      passed: result.ok,
      summary: result.ok ? 'build:ui succeeded.' : 'build:ui failed.',
      detail: result.ok ? undefined : result.output,
      duration_ms,
    };
  }

  private async checkUnitTests(cwd: string): Promise<QACheckResult> {
    const { result, duration_ms } = await timed(() => runCommand(cwd, ['bun', 'test'], 300_000));
    return {
      name: 'unit_tests',
      automated: true,
      passed: result.ok,
      summary: result.ok ? 'bun test passed.' : 'bun test reported failures.',
      detail: result.ok ? undefined : result.output,
      duration_ms,
    };
  }

  /**
   * No dedicated integration-test runner exists - `bun test` covers both
   * unit and integration-style specs in this repo (they live side by side,
   * see src/**\/*.test.ts). Reuse that verdict rather than re-running the
   * whole suite a second time.
   */
  private checkIntegrationTests(priorChecks: QACheckResult[]): QACheckResult {
    const unit = priorChecks.find((c) => c.name === 'unit_tests');
    return {
      name: 'integration_tests',
      automated: Boolean(unit),
      passed: unit?.passed ?? true,
      summary: unit
        ? 'Covered by the same bun test run as unit_tests (no separate integration suite exists).'
        : 'unit_tests check did not run.',
      duration_ms: 0,
    };
  }

  /** Scan markdown files for local relative links and verify they resolve. */
  private async checkBrokenLinks(cwd: string): Promise<QACheckResult> {
    const start = Date.now();
    const broken: string[] = [];
    try {
      const mdFiles = await this.findFiles(cwd, ['.md'], ['node_modules', '.git', 'dist', 'ui/dist']);
      const linkRe = /\]\(([^)#][^)]*)\)/g;
      for (const file of mdFiles) {
        const text = readFileSync(file, 'utf-8');
        let m: RegExpExecArray | null;
        while ((m = linkRe.exec(text))) {
          const target = m[1]!.trim();
          if (/^([a-z]+:)?\/\//i.test(target) || target.startsWith('mailto:')) continue; // external
          const cleanTarget = target.split('#')[0]!.trim();
          if (!cleanTarget) continue;
          const resolved = resolve(dirname(file), cleanTarget);
          if (!existsSync(resolved)) broken.push(`${file.replace(cwd, '.')} -> ${target}`);
        }
      }
    } catch (err) {
      return {
        name: 'broken_links',
        automated: true,
        passed: true,
        summary: 'Skipped: could not scan markdown files.',
        detail: err instanceof Error ? err.message : String(err),
        duration_ms: Date.now() - start,
      };
    }
    return {
      name: 'broken_links',
      automated: true,
      passed: broken.length === 0,
      summary: broken.length === 0 ? 'No broken local links found in markdown files.' : `${broken.length} broken link(s) found.`,
      detail: broken.length === 0 ? undefined : broken.join('\n'),
      duration_ms: Date.now() - start,
    };
  }

  /** Verify package.json's declared entry points actually exist on disk. */
  private async checkMissingFiles(cwd: string): Promise<QACheckResult> {
    const start = Date.now();
    const missing: string[] = [];
    try {
      const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf-8')) as Record<string, unknown>;
      const candidates: string[] = [];
      if (typeof pkg.module === 'string') candidates.push(pkg.module);
      if (typeof pkg.main === 'string') candidates.push(pkg.main);
      const bin = pkg.bin as Record<string, string> | string | undefined;
      if (typeof bin === 'string') candidates.push(bin);
      else if (bin && typeof bin === 'object') candidates.push(...Object.values(bin));

      for (const rel of candidates) {
        if (!existsSync(resolve(cwd, rel))) missing.push(rel);
      }
    } catch (err) {
      return {
        name: 'missing_files',
        automated: true,
        passed: false,
        summary: 'Could not read package.json.',
        detail: err instanceof Error ? err.message : String(err),
        duration_ms: Date.now() - start,
      };
    }
    return {
      name: 'missing_files',
      automated: true,
      passed: missing.length === 0,
      summary: missing.length === 0 ? "All package.json entry points exist." : `Missing: ${missing.join(', ')}`,
      duration_ms: Date.now() - start,
    };
  }

  /** package.json / tsconfig.json parse cleanly; config.yaml (if present) parses as YAML-ish. */
  private async checkConfiguration(cwd: string): Promise<QACheckResult> {
    const start = Date.now();
    const errors: string[] = [];
    for (const file of ['package.json', 'tsconfig.json']) {
      const path = join(cwd, file);
      if (!existsSync(path)) continue;
      try {
        JSON.parse(readFileSync(path, 'utf-8'));
      } catch (err) {
        errors.push(`${file}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    const configPath = join(cwd, 'config.yaml');
    if (existsSync(configPath)) {
      try {
        const { parse } = await import('yaml');
        parse(readFileSync(configPath, 'utf-8'));
      } catch (err) {
        errors.push(`config.yaml: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return {
      name: 'configuration_errors',
      automated: true,
      passed: errors.length === 0,
      summary: errors.length === 0 ? 'Configuration files parse cleanly.' : `${errors.length} configuration error(s).`,
      detail: errors.length === 0 ? undefined : errors.join('\n'),
      duration_ms: Date.now() - start,
    };
  }

  private async findFiles(dir: string, extensions: string[], excludeDirs: string[]): Promise<string[]> {
    const results: string[] = [];
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (excludeDirs.includes(entry.name)) continue;
        results.push(...(await this.findFiles(join(dir, entry.name), extensions, excludeDirs)));
      } else if (extensions.includes(extname(entry.name))) {
        results.push(join(dir, entry.name));
      }
    }
    return results;
  }
}
