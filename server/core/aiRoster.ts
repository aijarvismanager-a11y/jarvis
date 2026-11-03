import type { AiService, Store } from "./store.ts";
import { getWebAiSettings, NOT_AUTOMATABLE, resolveSiteProfile } from "./webAiSites.ts";

// AI roster. Once a week (with the new-AI scout) the registered AIs that still need a person (manual, Level 1-2) are looked after:
//  - one that can now be run by the app (it has a site profile, the person is signed in, and one tiny question gets an answer) is
//    raised to automatic (Level 3) by itself;
//  - one whose site has been gone two checks in a row is taken out of the registry. Nothing is lost: the whole record is kept in
//    "removed", the person can put it back with one click, and it is looked at again every 4 weeks (a site that is back is only
//    reported: nothing is added to the registry without the person's click).
// Every change is written to a short log the screen shows ("AIの入れ替わり").

export type RosterLogKind = "promoted" | "removed" | "restored" | "back" | "promote_failed";
export type RosterLogEntry = { at: string; kind: RosterLogKind; aiId: string; name: string; text: string };
export type RemovedAi = { service: AiService; removedAt: string; reason: string; nextRecheckAt: string; backAlive: boolean };
export type RosterState = {
  lastRunAt: string | null;
  strikes: Record<string, number>;
  removed: RemovedAi[];
  log: RosterLogEntry[];
  lastNote: string | null;
  running: boolean;
};

const KEY = "roster.v1";
const RUN_EVERY_MS = 7 * 86_400_000;
const RECHECK_REMOVED_MS = 28 * 86_400_000;
const STRIKES_TO_REMOVE = 2;
const MAX_PROBES_PER_RUN = 2;
const MAX_LOG = 60;

const readState = (store: Store): RosterState => ({ lastRunAt: null, strikes: {}, removed: [], log: [], lastNote: null, running: false, ...store.getSetting<Partial<RosterState>>(KEY, {}) });

export type SiteStatus = "alive" | "gone" | "unknown";

export type RosterDeps = {
  /** one tiny question to the AI through the automation browser (Level 3 only); used to confirm an AI can be run by the app */
  probe: (svc: AiService) => Promise<{ ok: true } | { ok: false; reason: string }>;
  fetchImpl?: typeof fetch;
  now?: () => Date;
};

export class AiRoster {
  private busy = false;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Date;

  constructor(
    private readonly store: Store,
    private readonly deps: RosterDeps,
  ) {
    this.fetchImpl = deps.fetchImpl ?? fetch;
    this.now = deps.now ?? (() => new Date());
  }

  state(): RosterState {
    return { ...readState(this.store), running: this.busy };
  }

  due(): boolean {
    const last = readState(this.store).lastRunAt;
    return !last || this.now().getTime() - Date.parse(last) >= RUN_EVERY_MS;
  }

  /** "gone" only for a site that does not exist any more (no DNS answer, 404, 410). A bot wall, a slow answer or a server error is "unknown": never held against the AI. */
  async siteStatus(url: string | null): Promise<SiteStatus> {
    if (!url) return "unknown";
    try {
      const res = await this.fetchImpl(url, { redirect: "follow", signal: AbortSignal.timeout(10_000), headers: { accept: "text/html" } });
      if (res.status === 404 || res.status === 410) return "gone";
      return "alive";
    } catch (err) {
      const code = (err as { cause?: { code?: string } })?.cause?.code;
      return code === "ENOTFOUND" || code === "ECONNREFUSED" ? "gone" : "unknown";
    }
  }

  private log(state: RosterState, kind: RosterLogKind, svc: Pick<AiService, "id" | "name">, text: string): void {
    state.log = [{ at: this.now().toISOString(), kind, aiId: svc.id, name: svc.name, text }, ...state.log].slice(0, MAX_LOG);
    this.store.appendEvent({ type: "AI_ROSTER", payload: { kind, aiId: svc.id, text } });
  }

  async run(): Promise<RosterState> {
    if (this.busy) return this.state();
    this.busy = true;
    const state = readState(this.store);
    const nowMs = this.now().getTime();
    const notes: string[] = [];
    try {
      const web = getWebAiSettings(this.store);
      const manual = this.store.listAiServices().filter((s) => s.accessMode === "web" && s.automationLevel <= 2 && s.status === "active" && !!s.url && s.id !== "claude-code");

      // 1. raise to automatic what can be run by the app now (a few probes per run: each one uses a little of a free allowance)
      let probes = 0;
      for (const s of manual) {
        if (probes >= MAX_PROBES_PER_RUN) break;
        if ((NOT_AUTOMATABLE as Record<string, string>)[s.id] || resolveSiteProfile(this.store, s.id) === null || web.loggedIn[s.id] !== true) continue;
        probes++;
        const r = await this.deps.probe(s);
        if (r.ok) {
          this.store.patchAiService(s.id, { automationLevel: 3, lastVerifiedAt: this.now().toISOString() });
          this.store.addDecision({ title: `AIの入れ替わり: ${s.name} を自動のAIにしました`, reason: "ログイン済みで、サイト設定があり、試しの質問に自動で答えが返ったため。", isAssumption: false });
          this.log(state, "promoted", s, "自動で使えることを確認できたので、自動のAIにしました");
          notes.push(`${s.name}を自動にしました`);
        } else {
          this.log(state, "promote_failed", s, `自動にできませんでした: ${r.reason}`);
        }
      }

      // 2. take out what is gone (two checks in a row; and never when every site looks gone: that is the network, not the sites)
      const checked = await Promise.all(manual.filter((s) => this.store.getAiService(s.id)?.automationLevel! <= 2).map(async (s) => [s, await this.siteStatus(s.url)] as const));
      const offline = checked.length > 1 && checked.every(([, st]) => st !== "alive");
      if (!offline) {
        for (const [s, st] of checked) {
          if (st === "alive") delete state.strikes[s.id];
          else if (st === "gone") state.strikes[s.id] = (state.strikes[s.id] ?? 0) + 1;
          if ((state.strikes[s.id] ?? 0) >= STRIKES_TO_REMOVE) {
            const snapshot = this.store.getAiService(s.id);
            if (snapshot && this.store.deleteAiService(s.id)) {
              state.removed = [{ service: snapshot, removedAt: this.now().toISOString(), reason: "サイトが2回続けて見つかりませんでした", nextRecheckAt: new Date(nowMs + RECHECK_REMOVED_MS).toISOString(), backAlive: false }, ...state.removed.filter((r) => r.service.id !== s.id)].slice(0, 40);
              delete state.strikes[s.id];
              this.store.addDecision({ title: `AIの入れ替わり: ${s.name} を名簿から外しました`, reason: "サイトが2回続けて見つかりませんでした。「戻す」でいつでも元に戻せます。", isAssumption: false });
              this.log(state, "removed", s, "サイトが見つからないため、名簿から外しました(戻せます)");
              notes.push(`${s.name}を外しました`);
            }
          }
        }
      }

      // 3. look again at what was taken out (every 4 weeks); a site that is back is only reported
      for (const r of state.removed) {
        if (Date.parse(r.nextRecheckAt) > nowMs) continue;
        r.nextRecheckAt = new Date(nowMs + RECHECK_REMOVED_MS).toISOString();
        if (!r.backAlive && (await this.siteStatus(r.service.url)) === "alive") {
          r.backAlive = true;
          this.log(state, "back", r.service, "サイトが戻ったようです。使いたければ「戻す」を押してください");
          notes.push(`${r.service.name}のサイトが戻っています`);
        }
      }
      state.lastNote = notes.length ? notes.join(" / ") : `確認しました(${manual.length}件)。入れ替えはありません。`;
    } catch (err) {
      state.lastNote = `確認の途中で止まりました: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      state.lastRunAt = this.now().toISOString();
      this.store.setSetting(KEY, { ...state, running: false });
      this.busy = false;
    }
    return this.state();
  }

  /** Puts a removed AI back exactly as it was. */
  restore(id: string): boolean {
    const state = readState(this.store);
    const r = state.removed.find((x) => x.service.id === id);
    if (!r) return false;
    const s = r.service;
    if (!this.store.getAiService(id)) {
      this.store.upsertAiService({ id: s.id, name: s.name, url: s.url, provider: s.provider, accessMode: s.accessMode as "web", automationLevel: s.automationLevel, freeStatus: s.freeStatus, requiresLogin: s.requiresLogin, requiresApiKey: s.requiresApiKey, adapterType: s.adapterType });
      this.store.setCapabilities(s.id, Object.fromEntries(s.capabilities.map((c) => [c, s.capabilityScores[c] ?? null])));
      this.store.patchAiService(s.id, { freeLimit: s.freeLimit, qualityScore: s.qualityScore, reliabilityScore: s.reliabilityScore, limitations: s.limitations, status: "active" });
    }
    state.removed = state.removed.filter((x) => x.service.id !== id);
    this.log(state, "restored", s, "あなたの操作で名簿に戻しました");
    this.store.setSetting(KEY, state);
    return true;
  }
}
