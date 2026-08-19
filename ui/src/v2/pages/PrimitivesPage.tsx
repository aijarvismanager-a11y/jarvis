import React from "react";
import { ArrowRight, Check, Mic, Search, Send, Sparkles } from "lucide-react";
import { Button, Chip, Icon, KBD, Meta, Rule } from "../ui";
import { navigateV2 } from "../router";
import "./primitives.css";

export function PrimitivesPage() {
  return (
    <div className="v2-primitives">
      <header className="v2-primitives__topbar">
        <div className="v2-primitives__brand">
          <span className="v2-primitives__brand-dot" aria-hidden="true" />
          <h1 className="v2-primitives__title">プリミティブ</h1>
        </div>
        <Button variant="ghost" size="sm" onClick={() => navigateV2({ kind: "home" })}>
          ← シェルに戻る
        </Button>
      </header>

      <div className="v2-primitives__content">
        <div className="v2-primitives__grid">

          <Section
            title="Button"
            note="Primaryは--accentを使い、画面ごとに一度だけ現れます。Ghostは主力です。Dangerは破壊的な単独操作に--warnを使用します(システムを変更する意図は引き続きApprovalCardを経由します)。"
          >
            <div className="v2-demo v2-demo--col">
              <div className="v2-demo__row">
                <span className="v2-demo__label">Primary</span>
                <Button variant="primary" size="sm">承認</Button>
                <Button variant="primary" size="md">
                  送信
                  <Icon icon={Send} size="sm" />
                </Button>
              </div>
              <div className="v2-demo__row">
                <span className="v2-demo__label">Ghost</span>
                <Button variant="ghost" size="sm">キャンセル</Button>
                <Button variant="ghost" size="md">
                  <Icon icon={ArrowRight} size="sm" />
                  開く
                </Button>
              </div>
              <div className="v2-demo__row">
                <span className="v2-demo__label">Danger</span>
                <Button variant="danger" size="sm">取り消し</Button>
                <Button variant="danger" size="md">ワークフローを削除</Button>
              </div>
              <div className="v2-demo__row">
                <span className="v2-demo__label">Disabled</span>
                <Button variant="primary" size="sm" disabled>送信</Button>
                <Button variant="ghost" size="sm" disabled>キャンセル</Button>
              </div>
            </div>
          </Section>

          <Section
            title="Chip"
            note="ステータス表示。accentトーンは稀 — Buttonと同じ規律です。"
          >
            <div className="v2-demo">
              <Chip tone="neutral">待機中</Chip>
              <Chip tone="ok">実行中</Chip>
              <Chip tone="warn">承認待ち</Chip>
              <Chip tone="accent">ライブ</Chip>
              <Chip tone="neutral" dot={false}>ドットなし</Chip>
            </div>
          </Section>

          <Section
            title="KBD"
            note="キーボードキー。パレットのトリガーとツールチップで使用。"
          >
            <div className="v2-demo">
              <KBD>⌘K</KBD>
              <KBD>/</KBD>
              <KBD>Esc</KBD>
              <KBD>Enter</KBD>
              <KBD>⇧⌘P</KBD>
            </div>
          </Section>

          <Section
            title="Rule"
            note="極細の区切り線。ページセクション用のBoldバリアントあり。"
          >
            <div className="v2-demo v2-demo--col" style={{ alignItems: "stretch" }}>
              <span className="v2-demo__label">デフォルト</span>
              <Rule />
              <span className="v2-demo__label" style={{ marginTop: "var(--s-3)" }}>Bold</span>
              <Rule bold />
            </div>
          </Section>

          <Section
            title="Meta"
            note="タイムスタンプと帰属情報の行。等幅、大文字、三次インク。"
          >
            <div className="v2-demo v2-demo--col">
              <Meta>今日 · 13:42 · Researcher</Meta>
              <Meta inline>
                <Icon icon={Sparkles} size="sm" />
                4件のソース · 18分経過
              </Meta>
              <Meta as="time" dateTime="2026-04-23T13:42:00Z">
                13:42 · 4分前
              </Meta>
            </div>
          </Section>

          <Section
            title="Icon"
            note="lucide-reactのラッパー。サイズはsm (14) / md (16) / lg (20)、または任意の数値。currentColorで親から色を継承します。"
          >
            <div className="v2-demo">
              <Icon icon={Mic} size="sm" label="マイク" />
              <Icon icon={Search} size="md" label="検索" />
              <Icon icon={Check} size="lg" label="確認済み" />
              <Icon icon={Send} size={24} label="送信" />
              <span style={{ color: "var(--accent)" }}>
                <Icon icon={Sparkles} size="md" label="提案" />
              </span>
              <span style={{ color: "var(--warn)" }}>
                <Icon icon={Mic} size="md" label="ミュート" />
              </span>
            </div>
          </Section>

        </div>
      </div>
    </div>
  );
}

function Section({
  title,
  note,
  children,
}: {
  title: string;
  note: string;
  children: React.ReactNode;
}) {
  return (
    <section className="v2-section">
      <div className="v2-section__head">
        <h2 className="v2-section__title">{title}</h2>
      </div>
      <p className="v2-section__note">{note}</p>
      {children}
    </section>
  );
}
