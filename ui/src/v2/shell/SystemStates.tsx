import React, { useEffect, useRef, useState } from "react";
import { isDevToolsEnabled } from "../devtools";
import "./SystemStates.css";

/* ═══════════════════ System states · Monochrome Lab ═══════════════════
   Six honest answers for when the app has to speak up. Two banners over a
   working app (update-available, provider-busy) and four full-window takeovers
   when the agent can't act (offline, updating, crash, out-of-tokens). Built to
   usejarvis-system-states.html. The rule: say what's wrong, say what
   still works, give the one way out. The Pebble carries the mood. */

export type TakeoverKind = "offline" | "updating" | "crash" | "quota";
export type BannerKind = "update" | "rate";

// ── icons (from the design) ───────────────────────────────────────────────
const IChk = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M13 4.5 6.5 11.5 3 8" /></svg>
);
const ICross = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M4 4l8 8M12 4l-8 8" /></svg>
);
const ISpin = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M8 2.6a5.4 5.4 0 1 1-5.1 3.6" /></svg>
);
const IDown = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M8 2.5v8M5 7.5 8 10.5 11 7.5M3.5 13.5h9" /></svg>
);

// ── the drop (carries the mood) ────────────────────────────────────────────
type DropState = "muted" | "think" | "hold" | "done";
function SystemDrop({ state, size = 54 }: { state: DropState; size?: number }) {
  return (
    <span className={`sys-drop ${state}`} style={{ width: size, height: size }} aria-hidden="true">
      <span className="in" />
      {state === "think" && <span className="ring" />}
    </span>
  );
}

const BLOOM: Record<TakeoverKind, string> = { offline: "n", updating: "w", crash: "a", quota: "a" };
const DROP: Record<TakeoverKind, DropState> = { offline: "muted", updating: "think", crash: "hold", quota: "hold" };

// ── takeover content ───────────────────────────────────────────────────────
export type TakeoverHandlers = {
  onRetry?: () => void;
  onCheckStatus?: () => void;
  onReopen?: () => void;
  onSendReport?: () => void;
  onUpgrade?: () => void;
  onTopUp?: () => void;
  onSwitchLocal?: () => void;
};

export type TakeoverData = {
  /** offline: the endpoints shown in the fine print. */
  statusUrl?: string;
  apiHost?: string;
  /** updating: target version. */
  version?: string;
  /** quota: plan wording + reset date + prices. */
  quotaTokens?: string;
  quotaPlan?: string;
  resetDate?: string;
};

function TakeoverBody({ kind, on, data }: { kind: TakeoverKind; on: TakeoverHandlers; data: TakeoverData }) {
  const dropSize = kind === "quota" ? 48 : 54;
  const bloomSize = kind === "quota" ? 130 : 140;
  const head = (
    <div className="sys-dropwrap">
      <span className={`sys-bloom ${BLOOM[kind]}`} style={{ width: bloomSize, height: bloomSize }} />
      <SystemDrop state={DROP[kind]} size={dropSize} />
    </div>
  );

  if (kind === "offline") {
    // The brain is the LOCAL daemon — the copy must say so, not blame "our
    // servers" (align with NowRoom's jarvis-start notice).
    return (
      <div className="sys-wrap">
        {head}
        <h2 className="sys-h2">デーモンに接続できません。</h2>
        <div className="sys-sub">このマシン上のJarvisランタイムへの接続が切れました。自動的に再接続を試みています。</div>
        <div className="sys-statuslist">
          <div className="sr ok"><span className="si"><IChk /></span><span><b>作業内容は失われていません</b>、保存済みです</span></div>
          <div className="sr wait"><span className="si"><ISpin /></span><span>数秒ごとに再接続中…</span></div>
          <div className="sr no"><span className="si"><ICross /></span><span>復旧するまでエージェントは<b>思考も行動もできません</b></span></div>
        </div>
        <div className="sys-btnrow">
          <button className="sys-btn sys-btn--pri" onClick={on.onRetry}>今すぐ再試行</button>
        </div>
        <div className="sys-fine">復旧しない場合は自分で起動してください: <span style={{ fontFamily: "var(--mono)" }}>jarvis start</span></div>
      </div>
    );
  }

  if (kind === "updating") {
    const v = data.version ?? "最新バージョン";
    return (
      <div className="sys-wrap">
        {head}
        <h2 className="sys-h2">{v}に更新中</h2>
        <div className="sys-sub">数秒で完了します。そのままお待ちください。</div>
        <div className="sys-pbar run"><i /></div>
        <div className="sys-fine">更新中はJarvisを閉じないでください。</div>
      </div>
    );
  }

  if (kind === "crash") {
    return (
      <div className="sys-wrap">
        {head}
        <h2 className="sys-h2">Jarvisが予期せず停止しました。</h2>
        <div className="sys-sub">セッションは復旧済みなので、続きから再開できます。再度開いて元の状態に戻りましょう。</div>
        <div className="sys-btnrow">
          <button className="sys-btn sys-btn--pri" onClick={on.onReopen}>Jarvisを開き直す</button>
          <button className="sys-btn sys-btn--ghost" onClick={on.onSendReport}>レポートを送信</button>
        </div>
        <div className="sys-fine">レポートは修正に役立ちます。画面やファイルの内容は含まれず、クラッシュ内容のみ送信されます。</div>
      </div>
    );
  }

  // quota / out-of-tokens
  const tokens = data.quotaTokens ?? "2M";
  const plan = data.quotaPlan ?? "Hosted + AI";
  const reset = data.resetDate ?? "次の更新日";
  return (
    <div className="sys-wrap">
      {head}
      <h2 className="sys-h2">今月分のトークンを使い切りました。</h2>
      <div className="sys-sub">{plan}の{tokens}トークンは{reset}にリセットされます。それまでは以下から選択してください:</div>
      <div className="sys-opts">
        <div className="sys-opt">
          <div className="ot"><div className="otn">Maxにアップグレード</div><div className="otd">月1000万トークン</div></div>
          <span className="op">€79/月</span>
          <button className="ob pri" onClick={on.onUpgrade}>アップグレード</button>
        </div>
        <div className="sys-opt">
          <div className="ot"><div className="otn">追加購入</div><div className="otd">今サイクル分、100万トークン</div></div>
          <span className="op">€9</span>
          <button className="ob" onClick={on.onTopUp}>追加</button>
        </div>
        <div className="sys-opt free">
          <div className="ot"><div className="otn">ローカルモデルに切り替え</div><div className="otd">このマシン上で動作</div></div>
          <span className="op">€0</span>
          <button className="ob" onClick={on.onSwitchLocal}>切り替え</button>
        </div>
      </div>
    </div>
  );
}

/** The takeover content without the fixed overlay — for the QA gallery, which
 *  renders each state inside a contained frame. */
export function SystemTakeoverContent({
  kind, handlers = {}, data = {},
}: { kind: TakeoverKind; handlers?: TakeoverHandlers; data?: TakeoverData }) {
  return <TakeoverBody kind={kind} on={handlers} data={data} />;
}

const TAKEOVER_LABEL: Record<TakeoverKind, string> = {
  offline: "頭脳に接続できません",
  updating: "Jarvisを更新中",
  crash: "Jarvisが予期せず停止しました",
  quota: "今月のトークンを使い切りました",
};

/**
 * Full-window takeover host. Renders the overlay for the active takeover and
 * fades it back to the app (240ms) when `kind` goes null — the same
 * continuity as the cold-start hand-off. Static (no fade) when `instant`.
 */
export function SystemTakeover({
  kind, handlers = {}, data = {}, instant = false,
}: { kind: TakeoverKind | null; handlers?: TakeoverHandlers; data?: TakeoverData; instant?: boolean }) {
  const [shown, setShown] = useState<TakeoverKind | null>(kind);
  const [out, setOut] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (kind) { setShown(kind); setOut(false); return; }
    if (!shown) return;
    if (instant) { setShown(null); return; }
    setOut(true);
    timer.current = setTimeout(() => { setShown(null); setOut(false); }, 240);
    return () => { if (timer.current) clearTimeout(timer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, instant]);

  if (!shown) return null;
  return (
    <div className={`sys-overlay${out ? " out" : ""}`} role="alertdialog" aria-modal="true" aria-label={TAKEOVER_LABEL[shown]} aria-live="assertive">
      <TakeoverBody kind={shown} on={handlers} data={data} />
    </div>
  );
}

// ── banners (over a usable app) ────────────────────────────────────────────
export type BannerHandlers = {
  onRestartUpdate?: () => void;
  onLater?: () => void;
};

export function UpdateBanner({ version, on = {} }: { version?: string; on?: BannerHandlers }) {
  const v = version ?? "新しいバージョン";
  return (
    <div className="sys-bnr info" role="status">
      <span className="bi"><IDown /></span>
      <span className="bm"><b>Jarvis {v}の準備ができました。</b> 再起動して最新版を適用するか、後で更新できます。</span>
      <span className="ba">
        <button className="sys-sbtn pri" onClick={on.onRestartUpdate}>再起動して更新</button>
        <button className="sys-sbtn" onClick={on.onLater}>後で</button>
      </span>
    </div>
  );
}

export function ProviderBusyBanner() {
  return (
    <div className="sys-bnr warn" role="status" aria-live="polite">
      <span className="bi"><span className="ratespin"><ISpin /></span></span>
      <span className="bm"><b>モデルプロバイダーが混雑しています。</b> 再試行中です。通常は数秒で解消します。</span>
    </div>
  );
}

/**
 * The banner stack that sits under the top bar over a usable app. Both banners
 * are self-describing; provider-busy carries no action (it clears itself).
 */
export function SystemBanners({
  update, providerBusy, updateVersion, on = {},
}: { update?: boolean; providerBusy?: boolean; updateVersion?: string; on?: BannerHandlers }) {
  if (!update && !providerBusy) return null;
  return (
    <>
      {providerBusy && <ProviderBusyBanner />}
      {update && <UpdateBanner version={updateVersion} on={on} />}
    </>
  );
}

/**
 * QA / manual-trigger override. Lets any state be forced in the live shell for
 * testing without a real trigger — offline is the only one wired to a real
 * signal today (the update feed, crash capture and quota counters are pending
 * backend). Gated behind the jarvis-devtools opt-in so a stray localStorage
 * key can't fake an "Out of tokens" takeover for a real user. Reads two
 * localStorage keys, live across tabs:
 *   jarvis-system-state  → one TakeoverKind ("offline"|"updating"|"crash"|"quota")
 *   jarvis-system-banner → comma list of BannerKind ("update","rate")
 */
export function useSystemStateOverride(): { takeover: TakeoverKind | null; banners: BannerKind[] } {
  const read = () => {
    let takeover: TakeoverKind | null = null;
    const banners: BannerKind[] = [];
    if (!isDevToolsEnabled()) return { takeover, banners };
    try {
      const t = localStorage.getItem("jarvis-system-state");
      if (t === "offline" || t === "updating" || t === "crash" || t === "quota") takeover = t;
      const b = localStorage.getItem("jarvis-system-banner") ?? "";
      if (b.includes("update")) banners.push("update");
      if (b.includes("rate")) banners.push("rate");
    } catch { /* no storage */ }
    return { takeover, banners };
  };
  const [state, setState] = useState(read);
  useEffect(() => {
    const reRead = () => setState(read());
    // `storage` only fires in OTHER tabs; `jarvis:system-state` lets the same
    // tab update live so a devtools one-liner works without a reload.
    const onStorage = (e: StorageEvent) => {
      if (e.key === "jarvis-system-state" || e.key === "jarvis-system-banner") reRead();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("jarvis:system-state", reRead);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("jarvis:system-state", reRead);
    };
  }, []);
  return state;
}
