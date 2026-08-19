import React from "react";
import { Mic } from "lucide-react";
import { Button, Icon } from "../ui";
import type { Impact } from "./types";
import "./ApprovalCard.css";

const IMPACT_LABEL: Record<Impact, string> = {
  read: "読み取り",
  write: "書き込み",
  destructive: "破壊的",
  external: "外部",
};

export interface ApprovalCardProps {
  /** Imperative sentence. Example: "Delete 14 files in ~/Downloads". */
  intent: string;
  category: string;
  impact: Impact;
  /** Substrings inside `intent` to highlight in accent — matched literally. */
  highlights?: string[];
  voiceHint?: string;
  onApprove?: () => void;
  onCancel?: () => void;
}

/**
 * Inline approval gate. Destructive intents ALWAYS route through this component
 * per the Authority engine — no destructive tool call bypasses it.
 *
 * Structure mirrors prototype hearth3.jsx:571-614:
 *  - Accent attribution row ("● JARVIS · needs your OK") with impact chip on the right
 *  - Intent sentence in display serif 16/1.45
 *  - Category as mono caption below the intent
 *  - Actions row: accent Approve, ghost Cancel, voice hint on the right
 */
export function ApprovalCard({
  intent,
  category,
  impact,
  highlights,
  voiceHint = `または「はい」と言ってください`,
  onApprove,
  onCancel,
}: ApprovalCardProps) {
  return (
    <article
      className="v2-approval"
      role="alertdialog"
      aria-label={`承認が必要: ${intent}`}
    >
      <div className="v2-approval__attribution">
        <span className="v2-approval__attribution-dot" aria-hidden="true" />
        Jarvis
        <span className="v2-approval__attribution-tag">· 承認が必要</span>
        <span className={`v2-approval__impact v2-approval__impact--${impact}`}>
          {IMPACT_LABEL[impact]}
        </span>
      </div>

      <h3 className="v2-approval__intent">
        {renderWithHighlights(intent, highlights)}
      </h3>

      <div className="v2-approval__category">{category}</div>

      <div className="v2-approval__actions">
        <Button variant="primary" size="md" onClick={onApprove}>
          はい · 承認
        </Button>
        <Button variant="ghost" size="md" onClick={onCancel}>
          キャンセル
        </Button>

        <span className="v2-approval__voice-hint" aria-hidden="true">
          <Icon icon={Mic} size="sm" />
          <span className="v2-approval__voice-hint-text">{voiceHint}</span>
        </span>
      </div>
    </article>
  );
}

function renderWithHighlights(text: string, highlights?: string[]): React.ReactNode {
  if (!highlights || highlights.length === 0) return text;

  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(${highlights.map(esc).join("|")})`, "g");
  const parts = text.split(pattern);

  return parts.map((part, i) => {
    if (!part) return null;
    const isMatch = highlights.some((h) => h === part);
    return isMatch ? <mark key={i}>{part}</mark> : <span key={i}>{part}</span>;
  });
}
