import type { FreeStatus } from "./schema.ts";
import type { AiService, Store } from "./store.ts";
import { costGuardReason } from "./aiBroker.ts";

// On-Demand AI Discovery (spec §5 / §20, Phase 5). Not a crawler: it runs only
// when a needed capability has no usable AI in the registry, proposes at most a
// handful of candidates from pluggable sources, checks each one's public pages
// for reachability and free-tier conditions, and saves only the ones that pass.
//
// Honesty rules: "free" is never assumed. A candidate whose pricing page could
// not be read stays `unknown` and is not saved when free is required. Candidate
// capability scores come from the source and are 【仮定】, recorded as such.
// Discovered services are saved as adapter_type "manual" (Level 1), so the
// Broker may recommend them but the executor never runs them automatically.

export type DiscoveryRequest = {
  requiredCapabilities: string[];
  language?: string;
  /** default true: only free / free_tier candidates qualify (spec §8) */
  freeRequired?: boolean;
  /** minimum automation level 1-3 */
  automationRequired?: number;
  /** look for new candidates even when the registry already covers the request */
  force?: boolean;
  /** persist the qualifying candidates to the registry */
  save?: boolean;
};

export type RawCandidate = {
  id: string;
  name: string;
  url: string;
  /** page to read the plan / price conditions from; defaults to `url` */
  pricingUrl?: string;
  provider?: string;
  /** capability -> 0-5 (an assumption supplied by the source) */
  capabilities: Record<string, number>;
  languages?: string[];
  automationLevel?: 1 | 2 | 3;
  requiresLogin?: boolean;
  requiresApiKey?: boolean;
};

export interface DiscoverySource {
  readonly name: string;
  find(request: DiscoveryRequest): Promise<RawCandidate[]>;
}

/**
 * Bundled list of publicly known chat AIs that are not in the default registry.
 * A starting hint only: every entry still goes through the live checks below.
 */
export const BUNDLED_CATALOG: RawCandidate[] = [
  { id: "mistral-le-chat", name: "Le Chat (Mistral)", url: "https://chat.mistral.ai", pricingUrl: "https://mistral.ai/pricing", provider: "Mistral AI", capabilities: { coding: 3.5, research: 3, translation: 4, documentation: 3 }, languages: ["en", "fr", "ja"], requiresLogin: true },
  { id: "qwen-chat", name: "Qwen Chat", url: "https://chat.qwen.ai", provider: "Alibaba Cloud", capabilities: { coding: 4, translation: 4, research: 3, documentation: 3 }, languages: ["en", "zh", "ja"], requiresLogin: true },
  { id: "huggingchat", name: "HuggingChat", url: "https://huggingface.co/chat", pricingUrl: "https://huggingface.co/pricing", provider: "Hugging Face", capabilities: { coding: 3, research: 3, documentation: 3 }, languages: ["en", "ja"] },
  { id: "grok", name: "Grok (xAI)", url: "https://grok.com", provider: "xAI", capabilities: { research: 4, coding: 3, seo: 3 }, languages: ["en", "ja"], requiresLogin: true },
  { id: "kimi", name: "Kimi", url: "https://www.kimi.com", provider: "Moonshot AI", capabilities: { research: 3.5, documentation: 3.5, translation: 3.5, coding: 3 }, languages: ["en", "zh"], requiresLogin: true },
  { id: "poe", name: "Poe", url: "https://poe.com", provider: "Quora", capabilities: { research: 3, coding: 3, translation: 3, image_generation: 3 }, languages: ["en", "ja"], requiresLogin: true },
];

export class CatalogSource implements DiscoverySource {
  readonly name = "bundled-catalog";
  constructor(private readonly catalog: RawCandidate[] = BUNDLED_CATALOG) {}
  async find(): Promise<RawCandidate[]> {
    return this.catalog;
  }
}

// ---- free-condition judgement (spec §7) -----------------------------------

export type FreeJudgement = { status: FreeStatus; requiresApiKey: boolean; evidence: string | null };

const stripHtml = (html: string) =>
  html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const FREE_TRIAL_RE = /free[\s-]+trials?|無料トライアル|無料体験|\btrial\b/i;
const FREE_RE = /\bfree\b|無料|フリープラン/i;
const PAID_RE = /\$\s?\d+(?:\.\d+)?\s*(?:\/|per)\s*(?:mo|month|user|seat)|per month|monthly|subscribe|月額|有料プラン|upgrade to|pro plan|plus plan/i;
const API_ONLY_RE = /api key|per (?:1m|million|1,000,000) tokens|pay[\s-]as[\s-]you[\s-]go|従量課金|APIキー/i;

const snippet = (text: string, re: RegExp) => {
  const m = re.exec(text);
  if (!m) return null;
  return text.slice(Math.max(0, m.index - 40), Math.min(text.length, m.index + 100)).trim();
};

/** Heuristic read of a public pricing page. Anything it cannot tell is `unknown`, never `free`. */
export function judgeFreeStatus(html: string): FreeJudgement {
  const text = stripHtml(html);
  if (text.length < 40) return { status: "unknown", requiresApiKey: false, evidence: null };
  const withoutTrial = text.replace(new RegExp(FREE_TRIAL_RE.source, "gi"), " ");
  const hasFree = FREE_RE.test(withoutTrial);
  const hasTrial = FREE_TRIAL_RE.test(text);
  const hasPaid = PAID_RE.test(text);
  const apiHeavy = API_ONLY_RE.test(text);
  if (apiHeavy && !hasFree) return { status: "paid", requiresApiKey: true, evidence: snippet(text, API_ONLY_RE) };
  // never "free": a public page cannot show the absence of limits, so free means free_tier here
  if (hasFree) return { status: "free_tier", requiresApiKey: false, evidence: snippet(withoutTrial, FREE_RE) };
  if (hasTrial) return { status: "trial", requiresApiKey: false, evidence: snippet(text, FREE_TRIAL_RE) };
  if (hasPaid) return { status: "paid", requiresApiKey: apiHeavy, evidence: snippet(text, PAID_RE) };
  return { status: "unknown", requiresApiKey: false, evidence: null };
}

// ---- discovery ------------------------------------------------------------

export type EvaluatedCandidate = {
  raw: RawCandidate;
  reachable: boolean | null;
  free: FreeJudgement;
  /** mean of the required capabilities' scores (0 when one is missing) */
  fit: number;
  eligible: boolean;
  rejectedBecause: string[];
};

export type DiscoveryResult = {
  request: DiscoveryRequest;
  /** "registry": an existing AI already covers the request, nothing was searched */
  source: "registry" | "web";
  existing: { aiId: string; name: string }[];
  /** up to three qualifying candidates, best first (spec §20: candidate A/B/C) */
  candidates: EvaluatedCandidate[];
  rejected: EvaluatedCandidate[];
  saved: string[];
  checkedAt: string;
};

export type DiscoveryDeps = { fetchImpl?: typeof fetch; sources?: DiscoverySource[]; now?: () => Date; timeoutMs?: number; maxEvaluated?: number };

const host = (url: string | null) => {
  try {
    return url ? new URL(url).hostname.replace(/^www\./, "") : null;
  } catch {
    return null;
  }
};

export class AiDiscovery {
  private readonly fetchImpl: typeof fetch;
  private readonly sources: DiscoverySource[];
  private readonly now: () => Date;
  private readonly timeoutMs: number;
  private readonly maxEvaluated: number;

  constructor(
    private readonly store: Store,
    deps: DiscoveryDeps = {},
  ) {
    this.fetchImpl = deps.fetchImpl ?? fetch;
    this.sources = deps.sources ?? [new CatalogSource()];
    this.now = deps.now ?? (() => new Date());
    this.timeoutMs = deps.timeoutMs ?? 8_000;
    this.maxEvaluated = deps.maxEvaluated ?? 6;
  }

  private covers(service: AiService, caps: string[]): boolean {
    return caps.every((c) => (service.capabilityScores[c] ?? (service.capabilities.includes(c) ? 3 : 0)) > 0);
  }

  /** Step 1 of §5: is there already a usable AI? */
  private existingMatches(req: DiscoveryRequest): AiService[] {
    const freeOnly = req.freeRequired !== false;
    return this.store
      .listAiServices()
      .filter((s) => s.status === "active" && this.covers(s, req.requiredCapabilities) && !costGuardReason(s, freeOnly ? "free_only" : "allow_paid") && s.automationLevel >= (req.automationRequired ?? 1));
  }

  private async fetchText(url: string): Promise<{ status: number; body: string } | null> {
    try {
      const res = await this.fetchImpl(url, { redirect: "follow", signal: AbortSignal.timeout(this.timeoutMs), headers: { accept: "text/html" } });
      return { status: res.status, body: res.status < 400 ? (await res.text()).slice(0, 500_000) : "" };
    } catch {
      return null;
    }
  }

  private async evaluate(raw: RawCandidate, req: DiscoveryRequest): Promise<EvaluatedCandidate> {
    const home = await this.fetchText(raw.url);
    const reachable = home === null ? false : home.status < 500;
    const pricing = raw.pricingUrl && raw.pricingUrl !== raw.url ? await this.fetchText(raw.pricingUrl) : home;
    const free: FreeJudgement = pricing && pricing.body ? judgeFreeStatus(pricing.body) : { status: "unknown", requiresApiKey: false, evidence: null };
    if (raw.requiresApiKey) free.requiresApiKey = true;
    const scores = req.requiredCapabilities.map((c) => raw.capabilities[c] ?? 0);
    const fit = scores.every((s) => s > 0) && scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;

    const rejectedBecause: string[] = [];
    if (!reachable) rejectedBecause.push("URLにアクセスできない");
    if (fit === 0) rejectedBecause.push("必要な能力を満たさない");
    if (free.requiresApiKey) rejectedBecause.push("APIキーが必要(Cost Guard)");
    if (req.freeRequired !== false && free.status !== "free" && free.status !== "free_tier") rejectedBecause.push(`無料条件を確認できない(${free.status})`);
    if (req.language && raw.languages && !raw.languages.includes(req.language)) rejectedBecause.push(`言語 ${req.language} 非対応`);
    if ((raw.automationLevel ?? 1) < (req.automationRequired ?? 1)) rejectedBecause.push("必要な自動化レベルに届かない");
    return { raw, reachable, free, fit, eligible: rejectedBecause.length === 0, rejectedBecause };
  }

  async discover(req: DiscoveryRequest): Promise<DiscoveryResult> {
    const checkedAt = this.now().toISOString();
    const base = { request: req, candidates: [], rejected: [], saved: [], checkedAt };
    const existing = this.existingMatches(req);
    if (existing.length && !req.force) {
      return { ...base, source: "registry", existing: existing.map((s) => ({ aiId: s.id, name: s.name })) };
    }

    const known = new Set(this.store.listAiServices().flatMap((s) => [s.id, host(s.url)].filter((v): v is string => !!v)));
    const seen = new Set<string>();
    const raws: RawCandidate[] = [];
    for (const source of this.sources) {
      let found: RawCandidate[] = [];
      try {
        found = await source.find(req);
      } catch {
        continue; // one failing source must not stop the others
      }
      for (const c of found) {
        const h = host(c.url);
        if (known.has(c.id) || (h && known.has(h)) || seen.has(c.id)) continue;
        seen.add(c.id);
        raws.push(c);
      }
    }

    const evaluated = await Promise.all(
      raws
        .filter((r) => req.requiredCapabilities.every((c) => (r.capabilities[c] ?? 0) > 0))
        .slice(0, this.maxEvaluated)
        .map((r) => this.evaluate(r, req)),
    );
    const candidates = evaluated.filter((e) => e.eligible).sort((a, b) => b.fit - a.fit || a.raw.name.localeCompare(b.raw.name)).slice(0, 3);
    const rejected = evaluated.filter((e) => !e.eligible);
    const saved = req.save ? candidates.map((c) => this.save(c, checkedAt)) : [];

    this.store.appendEvent({ type: "AI_DISCOVERY_RUN", payload: { capabilities: req.requiredCapabilities, evaluated: evaluated.length, qualified: candidates.length, saved: saved.length } });
    return { ...base, source: "web", existing: [], candidates, rejected, saved };
  }

  /** Registry Save (§5). Only called for candidates that passed every check. */
  private save(c: EvaluatedCandidate, checkedAt: string): string {
    const { raw, free } = c;
    this.store.upsertAiService({
      id: raw.id,
      name: raw.name,
      url: raw.url,
      provider: raw.provider ?? null,
      accessMode: "web",
      automationLevel: 1,
      freeStatus: free.status,
      requiresLogin: raw.requiresLogin,
      requiresApiKey: false,
      adapterType: "manual",
    });
    this.store.setCapabilities(raw.id, raw.capabilities);
    this.store.patchAiService(raw.id, {
      freeStatus: free.status,
      freeLimit: free.evidence,
      limitations: "AI Discoveryで追加。能力スコアは仮定、品質・信頼性は未評価。手動(Level 1)で利用",
      status: "active",
      lastVerifiedAt: checkedAt,
    });
    this.store.addDecision({
      title: `AI Discovery: ${raw.name} をRegistryに追加`,
      reason: `必要能力を満たし、公開ページで無料条件(${free.status})を確認。能力スコアは情報源の仮定値${free.evidence ? `。根拠: 「${free.evidence}」` : ""}`,
      isAssumption: true,
    });
    return raw.id;
  }
}
