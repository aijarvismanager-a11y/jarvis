import type { AiService, Store, Task } from "./store.ts";
import type { AiReviewer } from "./aiReview.ts";
import { chooseAi } from "./aiBroker.ts";
import { botCheckExclusions } from "./botCheck.ts";
import { getWebAiSettings, resolveSiteProfile } from "./webAiSites.ts";
import { WEB_ADAPTER_TYPES } from "./webHandoff.ts";

// New-AI scout. The app has no web search of its own, so it puts one question to an AI that already runs fully automatically
// (no Claude usage, no API fee), then checks each answer itself: is the site reachable, does its page show a free plan, does
// its page show a Google sign-in. Nothing is added to the registry here: candidates wait as proposals for the person to
// accept ("追加する") or drop ("見送る"). Only Google-sign-in AIs are proposed (the person's rule), and what is only the AI's
// claim is labelled as such.

export type ScoutProposal = {
  id: string;
  name: string;
  url: string;
  /** what it is for, as the asked AI described it ("コード作成", "画像生成"...) */
  use: string;
  provider: string | null;
  /** "page": the site's own page mentions a Google sign-in. "claimed": only the asked AI said so (not verified). */
  googleLogin: "page" | "claimed";
  /** the free plan: "page" = the page mentions one, "claimed" = only the AI said so */
  free: "page" | "claimed";
  foundAt: string;
  foundBy: string;
  status: "new" | "added" | "dismissed";
};

export type ScoutState = { proposals: ScoutProposal[]; lastRunAt: string | null; lastNote: string | null; running: boolean };

const KEY = "scout.state.v1";
const RUN_EVERY_MS = 7 * 86_400_000;
const MAX_ASKED = 8;
const MAX_KEPT = 30;

const GOOGLE_SIGNIN_RE = /(sign|log)[\s-]*in with google|continue with google|sign up with google|google(でログイン|アカウントでログイン|で続行|でサインイン)|googleアカウント/i;
const FREE_RE = /\bfree\b|無料|フリープラン|\$0/i;

const host = (url: string | null): string | null => {
  try {
    return url ? new URL(url).hostname.replace(/^www\./, "") : null;
  } catch {
    return null;
  }
};

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "ai";

const readState = (store: Store): ScoutState => ({ proposals: [], lastRunAt: null, lastNote: null, running: false, ...store.getSetting<Partial<ScoutState>>(KEY, {}) });

export const PROMPT = [
  "最近(直近1年ほど)に登場した、または急に注目されている「対話型AI・コードを書くAI・画像生成AI・動画生成AI」のうち、",
  "Googleアカウントでログインでき、無料で試せるものを、最大8件、教えてください。すでに有名な ChatGPT・Gemini・Claude・Perplexity・Copilot・Grok・DeepSeek・Mistral などは除いてください。",
  "答えは、次の形のJSON配列だけにしてください(前置きや説明は不要)。",
  '[{"name":"名前","url":"https://公式サイト","use":"用途(例: コード作成 / 画像生成 / 動画生成 / 調べもの)","provider":"提供会社","googleLogin":true,"free":true}]',
  "googleLogin は、Googleアカウントでのログインに対応していると確かな場合だけ true。確かでなければ含めないでください。",
].join("\n");

/** When the answer is a plain list instead of JSON: every https address in it, named by its link text or its host. Nothing is claimed about login or price, so the page itself has to show the Google sign-in. */
function parseLinks(text: string): ReturnType<typeof parseCandidates> {
  const out: ReturnType<typeof parseCandidates> = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(/(?:\[([^\]\n]{1,60})\]\()?(https:\/\/[^\s)\]>"'」]+)/g)) {
    const url = m[2].replace(/[.,、。]+$/, "");
    const h = host(url);
    if (!h || seen.has(h)) continue;
    seen.add(h);
    out.push({ name: m[1]?.trim() || h, url, use: "", provider: null, googleLogin: false, free: false });
  }
  return out.slice(0, MAX_ASKED);
}

/** Reads the JSON array out of an answer that may be wrapped in chatter or a code fence. */
export function parseCandidates(text: string): { name: string; url: string; use: string; provider: string | null; googleLogin: boolean; free: boolean }[] {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  let raw: unknown = null;
  if (start >= 0 && end > start) {
    try {
      raw = JSON.parse(text.slice(start, end + 1));
    } catch {
      raw = null;
    }
  }
  if (!Array.isArray(raw)) return parseLinks(text);
  const out: ReturnType<typeof parseCandidates> = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const name = typeof o.name === "string" ? o.name.trim().slice(0, 60) : "";
    const url = typeof o.url === "string" ? o.url.trim() : "";
    if (!name || !/^https:\/\//i.test(url) || !host(url)) continue;
    out.push({ name, url, use: typeof o.use === "string" ? o.use.trim().slice(0, 40) : "", provider: typeof o.provider === "string" ? o.provider.trim().slice(0, 40) : null, googleLogin: o.googleLogin === true, free: o.free === true });
  }
  return out.slice(0, MAX_ASKED);
}

export type ScoutDeps = { asker: AiReviewer; fetchImpl?: typeof fetch; now?: () => Date; timeoutMs?: number; /** which AI to ask; defaults to the best automatic research AI */ pick?: () => AiService | null };

/** The best AI that runs fully automatically right now and is good at research; null when none. */
export function pickScout(store: Store): AiService | null {
  const web = getWebAiSettings(store);
  if (!web.enabled) return null;
  const services = store.listAiServices();
  const decision = chooseAi(services, "research", { budgetPolicy: "free_only", executableAdapters: [...WEB_ADAPTER_TYPES], restingAis: botCheckExclusions(store, services.map((s) => s.id)) });
  for (const c of decision.ranked) {
    const s = services.find((x) => x.id === c.aiId);
    if (s && s.automationLevel >= 3 && web.loggedIn[s.id] === true && !!s.url && resolveSiteProfile(store, s.id) !== null) return s;
  }
  return null;
}

export class AiScout {
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Date;
  private readonly timeoutMs: number;
  private busy = false;

  constructor(
    private readonly store: Store,
    private readonly deps: ScoutDeps,
  ) {
    this.fetchImpl = deps.fetchImpl ?? fetch;
    this.now = deps.now ?? (() => new Date());
    this.timeoutMs = deps.timeoutMs ?? 8_000;
  }

  state(): ScoutState {
    return { ...readState(this.store), running: this.busy };
  }

  /** Whether a weekly run is due (never run, or the last run is older than a week). */
  due(): boolean {
    const last = readState(this.store).lastRunAt;
    return !last || this.now().getTime() - Date.parse(last) >= RUN_EVERY_MS;
  }

  private async page(url: string): Promise<{ ok: boolean; text: string }> {
    try {
      const res = await this.fetchImpl(url, { redirect: "follow", signal: AbortSignal.timeout(this.timeoutMs), headers: { accept: "text/html" } });
      if (res.status >= 400) return { ok: false, text: "" };
      return { ok: true, text: (await res.text()).slice(0, 400_000).replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ") };
    } catch {
      return { ok: false, text: "" };
    }
  }

  async run(): Promise<ScoutState> {
    if (this.busy) return this.state();
    this.busy = true;
    const at = this.now().toISOString();
    const finish = (note: string, proposals?: ScoutProposal[], retrySoon = false) => {
      const cur = readState(this.store);
      // nobody to ask yet: keep it due, so it runs as soon as an automatic AI is ready (not a week later)
      this.store.setSetting(KEY, { proposals: proposals ?? cur.proposals, lastRunAt: retrySoon ? cur.lastRunAt : at, lastNote: note });
      this.busy = false;
      return this.state();
    };
    try {
      const svc = (this.deps.pick ?? (() => pickScout(this.store)))();
      if (!svc) return finish(getWebAiSettings(this.store).enabled ? "探せるAIがありません(自動で使えるAIが1つもないか、ログインが済んでいません)。使えるAIができたら、自動で探します。" : "「ブラウザ上のAIも使う」がオフのため、探していません。オンにすると、自動で探します。", undefined, true);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 6 * 60_000);
      const task = { id: "ai-scout", projectId: "", role: "research", objective: "新しいAIの候補探し" } as unknown as Task;
      let answer: Awaited<ReturnType<AiReviewer["ask"]>>;
      try {
        answer = await this.deps.asker.ask({ svc, prompt: PROMPT, task, signal: controller.signal });
      } finally {
        clearTimeout(timer);
      }
      if (!answer.ok) return finish(`${svc.name}に聞けませんでした: ${answer.error}`);
      const found = parseCandidates(answer.text);
      if (!found.length) return finish(`${svc.name}の答えから候補を読み取れませんでした。(答えの冒頭: ${answer.text.replace(/\s+/g, " ").slice(0, 200) || "空"})`);

      const cur = readState(this.store);
      const known = new Set([...this.store.listAiServices().flatMap((s) => [s.id, host(s.url)]), ...cur.proposals.map((p) => host(p.url))].filter((v): v is string => !!v));
      const added: ScoutProposal[] = [];
      let dropped = 0;
      let already = 0;
      for (const c of found) {
        const h = host(c.url)!;
        if (known.has(h) || known.has(slug(c.name))) {
          already++;
          continue;
        }
        known.add(h);
        const pg = await this.page(c.url);
        if (!pg.ok) {
          dropped++; // a site that cannot be opened is not proposed
          continue;
        }
        const page = pg.text.replace(/\s+/g, " ");
        const googlePage = GOOGLE_SIGNIN_RE.test(page);
        if (!googlePage && !c.googleLogin) {
          dropped++; // nothing says it takes a Google sign-in: not proposed (the rule)
          continue;
        }
        added.push({ id: slug(c.name), name: c.name, url: c.url, use: c.use, provider: c.provider, googleLogin: googlePage ? "page" : "claimed", free: FREE_RE.test(page) ? "page" : "claimed", foundAt: at, foundBy: svc.id, status: "new" });
      }
      const proposals = [...added, ...cur.proposals].slice(0, MAX_KEPT);
      this.store.appendEvent({ type: "AI_SCOUT_RUN", payload: { asked: svc.id, found: found.length, proposed: added.length, dropped, already } });
      return finish(`${svc.name}に聞いて${found.length}件の候補が出て、新しく${added.length}件を提案します(${[already ? `${already}件は登録済みか前に出した候補` : "", dropped ? `${dropped}件は開けない・Googleログインの記載がない` : ""].filter(Boolean).join("、") || "除いたものはありません"})。`, proposals);
    } catch (err) {
      return finish(`探している途中で止まりました: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** Registers a proposal as a manual (Level 1) AI, the way the Google-login additions are. */
  accept(id: string): ScoutProposal | null {
    const cur = readState(this.store);
    const p = cur.proposals.find((x) => x.id === id && x.status === "new");
    if (!p) return null;
    if (!this.store.getAiService(p.id)) {
      this.store.upsertAiService({ id: p.id, name: p.name, url: p.url, provider: p.provider, accessMode: "web", automationLevel: 1, requiresLogin: true, adapterType: "manual" });
      this.store.patchAiService(p.id, { freeStatus: "free_tier", limitations: `新AI探しで追加(用途: ${p.use || "不明"})。能力スコアは未評価。手動(Level 1)で利用`, status: "active" });
      this.store.addDecision({ title: `新AI探し: ${p.name} を追加`, reason: `Googleログイン: ${p.googleLogin === "page" ? "サイトのページに記載あり" : "AIの回答のみ(未検証)"} / 無料枠: ${p.free === "page" ? "ページに記載あり" : "AIの回答のみ(未検証)"}。あなたの操作で追加。`, isAssumption: p.googleLogin !== "page" });
    }
    p.status = "added";
    this.store.setSetting(KEY, cur);
    return p;
  }

  dismiss(id: string): boolean {
    const cur = readState(this.store);
    const p = cur.proposals.find((x) => x.id === id && x.status === "new");
    if (!p) return false;
    p.status = "dismissed"; // kept, so the same site is not proposed again
    this.store.setSetting(KEY, cur);
    return true;
  }
}
