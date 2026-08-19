import React, { useEffect, useState } from "react";

/* ═══════════════════ Billing state · Monochrome Lab ═══════════════════
   The subscription lifecycle from usejarvis-billing-states.html. Five
   states, five tones. No payment processor is wired in code yet (the design's
   own candor note), so this is the state vocabulary + copy for a billing
   backend to drive. Until then it's localStorage-backed so the lifecycle is
   walkable in the shell (Settings → Billing) and previewable for QA. Live
   across the banner + the tab via a same-tab custom event. */

/** Hosted billing / subscriptions aren't live yet (no processor wired). Until
 *  then the Settings → Billing tab shows a "coming soon" state and the shell
 *  banner is suppressed. Flip to true when the billing backend ships; the plan
 *  card, banners, change-plan modal, and #/_billing gallery are all ready. */
export const BILLING_ENABLED = false;

export type BillingState = "trialing" | "active" | "past_due" | "canceled" | "expired";
export type BillingTone = "info" | "ok" | "warn" | "neutral" | "danger";

export type PlanKey = "hosted" | "hosted_ai" | "max";
export const PLANS: Record<PlanKey, { name: string; price: string; blurb: string }> = {
  hosted: { name: "Hosted", price: "€9.99", blurb: "自前のモデルキーを使用" },
  hosted_ai: { name: "Hosted + AI", price: "€29", blurb: "管理型モデル、設定不要" },
  max: { name: "Hosted + AI · Max", price: "€79", blurb: "トークン5倍、最優先" },
};

/** The plan a returning user is on. Static until the billing backend is wired. */
export const CURRENT_PLAN: PlanKey = "hosted_ai";

export type BannerAction = { label: string; to: BillingState };
export type StateInfo = {
  chip: { tone: BillingTone; label: string };
  /** Top-of-app banner. Null for `active` — nothing needs you. */
  banner: { tone: BillingTone; icon: "clock" | "alert" | "info"; message: string; action: BannerAction } | null;
  planName: string;
  price: string;
  meta: string;
};

// `**bold**` markers in copy are rendered by renderBold() below.
export const STATE_META: Record<BillingState, StateInfo> = {
  trialing: {
    chip: { tone: "info", label: "トライアル" },
    banner: { tone: "info", icon: "clock", message: "Hosted + AI の**トライアル残り11日**です。継続するにはカードを追加してください。", action: { label: "カードを追加", to: "active" } },
    planName: "Hosted + AI", price: "€0 now", meta: "トライアルは7月26日終了 · その後€29/月 · まだ課金なし",
  },
  active: {
    chip: { tone: "ok", label: "有効" },
    banner: null,
    planName: "Hosted + AI", price: "€29 / mo", meta: "2026年7月15日更新 · Visa •••• 4242",
  },
  past_due: {
    chip: { tone: "warn", label: "支払い遅延" },
    banner: { tone: "warn", icon: "alert", message: "7月15日の**カード決済に失敗しました**。Jarvisを継続利用するには更新してください。7月18日に再試行します。", action: { label: "カードを更新", to: "active" } },
    planName: "Hosted + AI", price: "€29 / mo", meta: "支払い失敗 · 7月22日まで頭脳はオンラインのまま",
  },
  canceled: {
    chip: { tone: "neutral", label: "解約中" },
    banner: { tone: "neutral", icon: "info", message: "サブスクリプションは**解約済み**です。7月15日までアクセス可能です。", action: { label: "再開", to: "active" } },
    planName: "Hosted + AI", price: "€29 / mo", meta: "2026年7月15日終了 · その後ホスト型頭脳は利用不可に",
  },
  expired: {
    chip: { tone: "danger", label: "期限切れ" },
    banner: { tone: "danger", icon: "alert", message: "サブスクリプションが**終了しました**。ホスト型頭脳はオフラインです。", action: { label: "再購読", to: "active" } },
    planName: "有効なプランなし", price: "", meta: "データは安全です。再購読でJarvisを復帰するか、セルフホストしてください。",
  },
};

const KEY = "jarvis-billing-state";
const EVT = "jarvis:billing-state";

function readState(): BillingState {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "trialing" || v === "active" || v === "past_due" || v === "canceled" || v === "expired") return v;
  } catch { /* no storage */ }
  return "active";
}

export function useBillingState(): { state: BillingState; setState: (s: BillingState) => void } {
  const [state, setLocal] = useState<BillingState>(readState);
  useEffect(() => {
    const reRead = () => setLocal(readState());
    const onStorage = (e: StorageEvent) => { if (e.key === KEY) reRead(); };
    window.addEventListener("storage", onStorage);
    window.addEventListener(EVT, reRead);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(EVT, reRead);
    };
  }, []);
  const setState = (s: BillingState) => {
    try { localStorage.setItem(KEY, s); } catch { /* no storage */ }
    setLocal(s);
    window.dispatchEvent(new Event(EVT)); // update the banner + tab live in this tab
  };
  return { state, setState };
}

/** Split `**bold**` copy into React nodes. */
export function renderBold(text: string): React.ReactNode[] {
  return text.split("**").map((part, i) =>
    i % 2 === 1 ? <strong key={i}>{part}</strong> : <React.Fragment key={i}>{part}</React.Fragment>,
  );
}
