import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { CreditCard } from "lucide-react";
import type { SettingsHook } from "../useSettingsData";
import { confirmDialog } from "../../../ui/ConfirmDialog";
import { useBillingState, STATE_META, renderBold, BILLING_ENABLED, type BillingState } from "../../../billing/useBillingState";
import "../../../billing/billing.css";

/* Settings → Billing. The plan card carries the subscription state; the
   change-plan modal shows the prorated math before you commit. No processor is
   wired (the design's candor note), so state changes are local demo
   transitions until a billing backend drives them. No dark patterns: cancel is
   reversible, downgrades keep paid access, invoices say what's real. */

type Toast = (text: string, tone?: "ok" | "warn") => void;

const PRORATE = {
  up: "本日 **€33.20が請求されます**。今サイクルの残り10日分の日割りです。その後は7月15日から **€79/月**。",
  down: "本日の請求はありません。7月15日の更新時にプランが **Hosted** に変更され、それまでは現在の内容をそのままお使いいただけます。以降は **€9.99/月**。",
};
const CONFIRM = { up: "Maxに切り替え", down: "ダウングレードを予約" };

function ChangePlanModal({ onClose, onConfirm }: { onClose: () => void; onConfirm: (choice: "up" | "down") => void }) {
  const [choice, setChoice] = useState<"up" | "down">("up");
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); onClose(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  return createPortal(
    <div className="bl-modal" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bl-modal__box" role="dialog" aria-modal="true" aria-label="プランを変更">
        <div className="bl-modal__head">
          <div className="bl-modal__title">プランを変更</div>
          <div className="bl-modal__sub">現在のプラン: Hosted + AI · €29/月</div>
        </div>
        <div className="bl-opts" role="radiogroup" aria-label="プラン">
          <button type="button" role="radio" aria-checked={choice === "up"} className="bl-opt" onClick={() => setChoice("up")}>
            <span className="rad" /><span className="ot"><span className="otn">Hosted + AI · Max</span><span className="otd">トークン量5倍、最優先処理</span></span><span className="op">€79</span>
          </button>
          <button type="button" role="radio" aria-checked={choice === "down"} className="bl-opt" onClick={() => setChoice("down")}>
            <span className="rad" /><span className="ot"><span className="otn">Hosted</span><span className="otd">自分のモデルキーを使用</span></span><span className="op">€9.99</span>
          </button>
        </div>
        <div className="bl-prorate">{renderBold(PRORATE[choice])}</div>
        <div className="bl-modal__foot">
          <button className="bl-btn" onClick={onClose}>キャンセル</button>
          <button className="bl-btn bl-btn--pri" onClick={() => onConfirm(choice)}>{CONFIRM[choice]}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function BillingTab({ onToast }: { data: SettingsHook; onToast: Toast }) {
  const { state, setState } = useBillingState();
  const [modal, setModal] = useState(false);

  // Hosted billing isn't live yet — show a coming-soon state rather than a
  // plan card that would look like a real subscription (the design's candor).
  if (!BILLING_ENABLED) {
    return (
      <div className="bl-soon">
        <div className="bl-soon__mark"><CreditCard size={22} strokeWidth={1.6} /></div>
        <div className="bl-soon__title">請求機能は近日公開</div>
        <div className="bl-soon__sub">Hostedプランやサブスクリプションはここに表示される予定です。現時点ではJarvisは無料で、自分のモデルキーまたはセルフホストで動作します。</div>
        <span className="bl-chip info"><span className="d" />近日公開</span>
      </div>
    );
  }

  const info = STATE_META[state];

  const cancel = async () => {
    if (await confirmDialog(
      "サブスクリプションを解約しますか?\n\n現在の期間が終了するまではすべての機能を利用でき、それまではいつでも再開できます。",
      { confirmLabel: "サブスクリプションを解約" },
    )) {
      setState("canceled");
      onToast("期間終了時に解約されるよう設定しました。", "ok");
    }
  };
  const go = (to: BillingState, msg: string) => () => { setState(to); onToast(msg, "ok"); };

  const actions = (() => {
    switch (state) {
      case "trialing":
        return (<><button className="bl-btn bl-btn--pri" onClick={go("active", "支払い方法を追加しました — トライアルを本登録に切り替えました。")}>支払い方法を追加</button><button className="bl-btn" onClick={() => setModal(true)}>プランを比較</button></>);
      case "active":
        return (<><button className="bl-btn" onClick={() => setModal(true)}>プランを変更</button><button className="bl-btn bl-btn--red" onClick={cancel}>キャンセル</button></>);
      case "past_due":
        return (<><button className="bl-btn bl-btn--pri" onClick={go("active", "カード情報を更新しました — 支払いを再試行しました。")}>カードを更新</button><button className="bl-btn" onClick={go("active", "再試行に成功しました。")}>今すぐ再試行</button></>);
      case "canceled":
        return (<button className="bl-btn bl-btn--pri" onClick={go("active", "サブスクリプションを再開しました。")}>サブスクリプションを再開</button>);
      case "expired":
        return (<><button className="bl-btn bl-btn--pri" onClick={go("active", "再登録しました — 頭脳が戻ってきました。")}>再登録</button><button className="bl-btn" onClick={() => window.open("https://usejarvis.com/docs/self-hosting", "_blank", "noopener")}>セルフホストガイド</button></>);
    }
  })();

  const showRecords = state === "active" || state === "past_due" || state === "trialing";
  const invoiceToast = () => onToast("請求書のダウンロードには課金バックエンドが必要です。", "warn");

  return (
    <div>
      <div className="bl-sublabel" style={{ marginTop: 4 }}>プラン</div>
      <div className="bl-plan">
        <div className="bl-plan__head">
          <span className="bl-plan__name">{info.planName}</span>
          <span className={`bl-chip ${info.chip.tone}`}><span className="d" />{info.chip.label}</span>
          {info.price && <span className="bl-plan__price">{info.price}</span>}
        </div>
        <div className="bl-plan__meta">{info.meta}</div>
        <div className="bl-plan__act">{actions}</div>
      </div>
      {state === "active" && <div className="bl-allgood"><span className="dot" />問題ありません。特に対応は不要です。</div>}

      {showRecords && (
        <>
          <div className="bl-sublabel">支払い方法</div>
          <div className="bl-receipt">
            <div className="bl-receipt__row"><span>カード</span><span className="v">Visa •••• 4242</span></div>
            <div className="bl-receipt__row"><span>有効期限</span><span className="v">08 / 27</span></div>
          </div>
          <div className="bl-sublabel">請求履歴</div>
          <div className="bl-receipt">
            <div className="bl-receipt__row"><span>2026年6月15日 · Hosted + AI</span><span className="v">€29.00 <button className="link" onClick={invoiceToast}>請求書</button></span></div>
            <div className="bl-receipt__row"><span>2026年5月15日 · Hosted + AI</span><span className="v">€29.00 <button className="link" onClick={invoiceToast}>請求書</button></span></div>
          </div>
        </>
      )}

      {modal && (
        <ChangePlanModal
          onClose={() => setModal(false)}
          onConfirm={(c) => { setModal(false); onToast(c === "up" ? "Maxに切り替えました。" : "更新時にダウングレードするよう予約しました。", "ok"); }}
        />
      )}
    </div>
  );
}
