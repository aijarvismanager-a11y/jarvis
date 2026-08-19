import React, { useState } from "react";
import { CreditCard } from "lucide-react";
import { STATE_META, renderBold, type BillingState } from "../billing/useBillingState";
import "../billing/billing.css";
import "./BillingShowcase.css";

/**
 * Billing-states gallery. The plan card in all five states, the four banners,
 * and the change-plan modal, framed in both themes. Route: #/_billing. No
 * billing backend is wired (the design's candor) — this previews the state
 * vocabulary; the live surfaces are Settings → Billing + the shell banner.
 */

const STATES: BillingState[] = ["trialing", "active", "past_due", "canceled", "expired"];

const CardActions: Record<BillingState, React.ReactNode> = {
  trialing: (<><button className="bl-btn bl-btn--pri">支払い方法を追加</button><button className="bl-btn">プランを比較</button></>),
  active: (<><button className="bl-btn">プランを変更</button><button className="bl-btn bl-btn--red">解約</button></>),
  past_due: (<><button className="bl-btn bl-btn--pri">カードを更新</button><button className="bl-btn">今すぐ再試行</button></>),
  canceled: (<button className="bl-btn bl-btn--pri">サブスクリプションを再開</button>),
  expired: (<><button className="bl-btn bl-btn--pri">再購読</button><button className="bl-btn">セルフホストガイド</button></>),
};

const Clock = () => (<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="8" cy="8" r="6" /><path d="M8 4.8V8l2.2 1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>);
const Alert = () => (<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M8 2.5 14.5 13.5h-13z" /><path d="M8 6.6v3" /><circle cx="8" cy="11.5" r="0.35" fill="currentColor" stroke="none" /></svg>);
const Info = () => (<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="8" cy="8" r="6" /><path d="M8 7.4v3.2" strokeLinecap="round" /><circle cx="8" cy="5.1" r="0.4" fill="currentColor" stroke="none" /></svg>);
const ICON = { clock: Clock, alert: Alert, info: Info } as const;

function PlanCard({ state }: { state: BillingState }) {
  const info = STATE_META[state];
  return (
    <div>
      <div className="bl-plan">
        <div className="bl-plan__head">
          <span className="bl-plan__name">{info.planName}</span>
          <span className={`bl-chip ${info.chip.tone}`}><span className="d" />{info.chip.label}</span>
          {info.price && <span className="bl-plan__price">{info.price}</span>}
        </div>
        <div className="bl-plan__meta">{info.meta}</div>
        <div className="bl-plan__act">{CardActions[state]}</div>
      </div>
      {state === "active" && <div className="bl-allgood"><span className="dot" />問題なし。対応は不要です。</div>}
      <div className="blx-lab">{state.replace("_", " ")}</div>
    </div>
  );
}

function Banner({ state }: { state: BillingState }) {
  const banner = STATE_META[state].banner;
  if (!banner) return null;
  const Icon = ICON[banner.icon];
  return (
    <div className="blx-bnrframe">
      <div className={`bl-bnr ${banner.tone}`}>
        <span className="bi"><Icon /></span>
        <span className="bm">{renderBold(banner.message)}</span>
        <span className="ba"><button className="bl-btn bl-btn--pri">{banner.action.label}</button></span>
      </div>
    </div>
  );
}

export function BillingShowcase(): React.ReactElement {
  const [theme, setTheme] = useState<string>(() => (typeof document !== "undefined" && document.documentElement.getAttribute("data-theme")) || "light");
  const flip = (t: string) => { document.documentElement.setAttribute("data-theme", t); setTheme(t); };
  const [choice, setChoice] = useState<"up" | "down">("up");
  const PRORATE = {
    up: "本日、今サイクルの残り10日分を日割りした**€33.20が請求されます**。その後7月15日から**€79/月**。",
    down: "本日の請求はありません。7月15日の更新時にプランは**Hosted**に変わり、それまでは現在の内容を維持します。その後は**€9.99/月**。",
  };

  return (
    <div className="blx">
      <header className="blx-head">
        <div>
          <h1>課金状態</h1>
          <p>サブスクリプションのライフサイクル: 設定 → 課金の状態別プランカード、アプリ上部のバナー、プラン変更モーダル。言葉より先にトーンが真実を語ります。</p>
        </div>
        <div className="blx-seg" role="group" aria-label="テーマ">
          <button className={theme !== "dark" ? "on" : ""} onClick={() => flip("light")}>ライト</button>
          <button className={theme === "dark" ? "on" : ""} onClick={() => flip("dark")}>ダーク</button>
        </div>
      </header>

      <div className="blx-sec">現在 · 設定 → 課金(課金機能は未有効)</div>
      <div className="blx-soonframe">
        <div className="bl-soon">
          <div className="bl-soon__mark"><CreditCard size={22} strokeWidth={1.6} /></div>
          <div className="bl-soon__title">課金機能は近日公開</div>
          <div className="bl-soon__sub">ホスト型プランとサブスクリプションはここに表示されます。現在Jarvisは無料で、あなた自身のモデルキーまたはセルフホストで動作しています。</div>
          <span className="bl-chip info"><span className="d" />近日公開</span>
        </div>
      </div>

      <div className="blx-sec">プランカード · 課金機能公開時</div>
      <div className="blx-grid">{STATES.map((s) => <PlanCard key={s} state={s} />)}</div>

      <div className="blx-sec">状態バナー · アプリ上部</div>
      <div className="blx-banners">{STATES.map((s) => <Banner key={s} state={s} />)}</div>

      <div className="blx-sec">プラン変更 · モーダル</div>
      <div className="blx-modalframe">
        <div className="bl-modal__box" style={{ position: "static", transform: "none" }}>
          <div className="bl-modal__head">
            <div className="bl-modal__title">プランを変更</div>
            <div className="bl-modal__sub">現在 Hosted + AI · €29/月</div>
          </div>
          <div className="bl-opts" role="radiogroup" aria-label="プラン">
            <button type="button" role="radio" aria-checked={choice === "up"} className="bl-opt" onClick={() => setChoice("up")}>
              <span className="rad" /><span className="ot"><span className="otn">Hosted + AI · Max</span><span className="otd">トークン5倍、最優先</span></span><span className="op">€79</span>
            </button>
            <button type="button" role="radio" aria-checked={choice === "down"} className="bl-opt" onClick={() => setChoice("down")}>
              <span className="rad" /><span className="ot"><span className="otn">Hosted</span><span className="otd">自前のモデルキーを使用</span></span><span className="op">€9.99</span>
            </button>
          </div>
          <div className="bl-prorate">{renderBold(PRORATE[choice])}</div>
          <div className="bl-modal__foot">
            <button className="bl-btn">キャンセル</button>
            <button className="bl-btn bl-btn--pri">{choice === "up" ? "Maxに切り替え" : "ダウングレードを予約"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
