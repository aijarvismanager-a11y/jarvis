import { spawnRunner, type CommandRunner } from "./commandRunner.ts";
import type { AiService, Store } from "./store.ts";

// AI Health Check (spec §21). Only what can be verified without touching a
// user's session is checked: a Web AI's URL is reachable, a CLI AI's binary
// runs. Login state, free-tier conditions and UI usability cannot be read
// without automating the browser (and credentials/cookies are never touched,
// §11), so they are reported as "unverified" instead of guessed.

export type HealthCheckItem = { name: "reachable" | "binary" | "login" | "free_status" | "ui"; status: "ok" | "failed" | "unverified"; detail?: string };
export type HealthResult = {
  aiId: string;
  name: string;
  /** true = confirmed usable, false = confirmed broken, null = could not tell */
  healthy: boolean | null;
  checks: HealthCheckItem[];
  checkedAt: string;
};

const CLI_BINARY: Record<string, string> = { "claude-code": "claude" };
const REACHABLE_TIMEOUT_MS = 8_000;

export type HealthCheckerDeps = { fetchImpl?: typeof fetch; runner?: CommandRunner; now?: () => Date; timeoutMs?: number };

export class AiHealthChecker {
  private readonly fetchImpl: typeof fetch;
  private readonly runner: CommandRunner;
  private readonly now: () => Date;
  private readonly timeoutMs: number;

  constructor(
    private readonly store: Store,
    deps: HealthCheckerDeps = {},
  ) {
    this.fetchImpl = deps.fetchImpl ?? fetch;
    this.runner = deps.runner ?? spawnRunner;
    this.now = deps.now ?? (() => new Date());
    this.timeoutMs = deps.timeoutMs ?? REACHABLE_TIMEOUT_MS;
  }

  private async checkUrl(url: string): Promise<HealthCheckItem> {
    try {
      const res = await this.fetchImpl(url, { method: "GET", redirect: "follow", signal: AbortSignal.timeout(this.timeoutMs) });
      // 4xx (e.g. a bot wall's 403) still means the site is up; only 5xx / no answer is a failure.
      return res.status < 500 ? { name: "reachable", status: "ok", detail: `HTTP ${res.status}` } : { name: "reachable", status: "failed", detail: `HTTP ${res.status}` };
    } catch (err) {
      return { name: "reachable", status: "failed", detail: err instanceof Error ? err.message : String(err) };
    }
  }

  private async checkBinary(binary: string): Promise<HealthCheckItem> {
    try {
      const r = await this.runner(binary, ["--version"], { timeoutMs: this.timeoutMs });
      if (r.timedOut) return { name: "binary", status: "failed", detail: "応答がありません(タイムアウト)" };
      return r.code === 0 ? { name: "binary", status: "ok", detail: r.stdout.trim().split("\n")[0] } : { name: "binary", status: "failed", detail: `終了コード ${r.code}` };
    } catch (err) {
      return { name: "binary", status: "failed", detail: err instanceof Error ? err.message : String(err) };
    }
  }

  private async probe(service: AiService): Promise<HealthResult> {
    const checks: HealthCheckItem[] = [];
    const binary = CLI_BINARY[service.adapterType];
    if (binary) checks.push(await this.checkBinary(binary));
    else if (service.url) checks.push(await this.checkUrl(service.url));
    else checks.push({ name: "reachable", status: "unverified", detail: "URLもCLIも登録されていないため確認できません" });
    if (service.requiresLogin || !binary) checks.push({ name: "login", status: "unverified", detail: "ログイン状態はユーザーの操作でのみ確認できます" });
    checks.push({ name: "free_status", status: "unverified", detail: "無料条件は自動確認しません(AI Discoveryで扱う)" });
    if (!binary) checks.push({ name: "ui", status: "unverified", detail: "UIの自動操作可否はLevel 2以降で確認" });
    const primary = checks[0];
    return { aiId: service.id, name: service.name, healthy: primary.status === "ok" ? true : primary.status === "failed" ? false : null, checks, checkedAt: this.now().toISOString() };
  }

  /**
   * Checks the given services (default: every non-retired one) and records the
   * outcome: confirmed-ok -> active + last_verified_at, confirmed-broken ->
   * unavailable. If every network probe failed the machine is probably offline,
   * so statuses are left alone rather than marking the whole registry down.
   */
  async checkAll(aiIds?: string[]): Promise<HealthResult[]> {
    const services = this.store.listAiServices().filter((s) => s.status !== "retired" && (!aiIds || aiIds.includes(s.id)));
    const results = await Promise.all(services.map((s) => this.probe(s)));
    const network = results.filter((r, i) => !CLI_BINARY[services[i].adapterType] && r.checks[0].name === "reachable" && r.checks[0].status !== "unverified");
    const offline = network.length >= 2 && network.every((r) => r.healthy === false);
    for (const r of results) {
      if (r.healthy === null || (offline && network.includes(r))) continue;
      this.store.patchAiService(r.aiId, r.healthy ? { status: "active", lastVerifiedAt: r.checkedAt } : { status: "unavailable" });
    }
    this.store.appendEvent({ type: "AI_HEALTH_CHECKED", payload: { checked: results.length, healthy: results.filter((r) => r.healthy).length, offline } });
    return results;
  }
}
