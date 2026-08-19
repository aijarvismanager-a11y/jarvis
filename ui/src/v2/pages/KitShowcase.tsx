import React, { useState } from "react";
import {
  StatusChip, StatsStrip, Tabs, Toolbar, FilterBar, FLabel, FilterChip, Segmented, LiveToggle,
  Table, Row, StatusIcon, Drawer, DrawerLabel, DrawerText, DeepLink, Shape, EmptyState, Skeleton,
  Toast, Input, Select, Switch, Check, type ShapeKind,
} from "../ui/roomkit";

/**
 * Phase 3 — room-kit gallery. A live showcase of every shared primitive so
 * the kit can be QA'd in both themes before Phase-4 rooms consume it.
 * Route: #/_kit
 */

const SHAPES: { kind: ShapeKind; label: string }[] = [
  { kind: "circle", label: "人物" }, { kind: "drop", label: "プロジェクト" }, { kind: "square", label: "ツール" },
  { kind: "peak", label: "場所" }, { kind: "ring", label: "概念" }, { kind: "diamond", label: "イベント" },
];

function Section({ label, children, span2 }: { label: string; children: React.ReactNode; span2?: boolean }) {
  return (
    <section className="kit-sec" style={span2 ? { gridColumn: "span 2" } : undefined}>
      <div className="kit-sec__label">{label}</div>
      <div className="kit-sec__body">{children}</div>
    </section>
  );
}

export function KitShowcase(): React.ReactElement {
  const [tab, setTab] = useState("board");
  const [status, setStatus] = useState("all");
  const [win, setWin] = useState("24h");
  const [live, setLive] = useState(true);
  const [sw, setSw] = useState(true);
  const [chk, setChk] = useState(true);
  const [sel, setSel] = useState("a2");

  return (
    <div className="kit-page">
      <style>{KIT_CSS}</style>
      <header className="kit-head">
        <div className="kit-head__eyebrow">Brand Book III · room kit</div>
        <h1 className="kit-head__title">ひとつの語彙、すべてのルームで。</h1>
        <p className="kit-head__sub">Phase-4のルームが継承する共有コンポジット。色は5つの状態トーンのみ、インクがすべての主操作を担い、ドロップの鋭い角は右上に配置されます。</p>
      </header>

      <div className="kit-grid">
        <Section label="ステータスチップ · 5つのトーンのみ">
          <div className="kit-row">
            <StatusChip tone="run" dot>実行中</StatusChip>
            <StatusChip tone="ok" dot>成功</StatusChip>
            <StatusChip tone="hold" dot>対応待ち</StatusChip>
            <StatusChip tone="fail" dot>失敗</StatusChip>
            <StatusChip tone="mut" dot>待機中</StatusChip>
          </div>
        </Section>

        <Section label="タブ">
          <Tabs
            tabs={[{ key: "board", label: "ボード" }, { key: "list", label: "リスト" }, { key: "archive", label: "アーカイブ" }]}
            active={tab} onChange={setTab}
          />
        </Section>

        <Section label="統計ストリップ · KPI" span2>
          <StatsStrip items={[
            { k: "実行中", n: 4 },
            { k: "本日完了", n: 3, tone: "ok" },
            { k: "期限超過", n: 1, tone: "amber" },
            { k: "失敗", n: 0, tone: "alert" },
            { k: "合計", n: <>11<small> タスク</small></> },
          ]} />
        </Section>

        <Section label="ツールバー + フィルター" span2>
          <div className="kit-frame">
            <Toolbar title="タスク">
              <Tabs tabs={[{ key: "board", label: "ボード" }, { key: "list", label: "リスト" }]} active={tab} onChange={setTab} />
              <span className="rk-toolbar__spacer" />
              <Input mono placeholder="タスクを検索…" style={{ width: 150 }} />
            </Toolbar>
            <FilterBar>
              <FLabel>ステータス</FLabel>
              {["all", "pending", "completed"].map((s) => <FilterChip key={s} on={status === s} onClick={() => setStatus(s)}>{{ all: "すべて", pending: "保留中", completed: "完了" }[s]}</FilterChip>)}
              <span style={{ width: 10 }} />
              <FLabel>期間</FLabel>
              <Segmented options={[{ key: "1h", label: "1時間" }, { key: "24h", label: "24時間" }, { key: "7d", label: "7日" }]} value={win} onChange={setWin} />
              <span className="rk-toolbar__spacer" />
              <LiveToggle on={live} onClick={() => setLive((v) => !v)} />
            </FilterBar>
          </div>
        </Section>

        <Section label="テーブル文法" span2>
          <div className="kit-frame">
            <Table>
              <Row cols="26px 1fr 90px 70px" head><span /><span>イベント</span><span className="rk-num">トークン</span><span className="rk-num">時刻</span></Row>
              {[
                { id: "a1", tone: "ok", t: "モーニングブリーフ", s: "Telegramへ配信済み", n: "3.1k", w: "07:00" },
                { id: "a2", tone: "run", t: "受信トレイの振り分け", s: "夜間の14件のメール", n: "8.4k", w: "2分前" },
                { id: "a3", tone: "hold", t: "make_payment", s: "承認へルーティング", n: "—", w: "9分前" },
                { id: "a4", tone: "fail", t: "バックアップ同期", s: "失敗 · 14:00に再試行", n: "—", w: "12:40" },
              ].map((r) => (
                <Row key={r.id} cols="26px 1fr 90px 70px" selected={sel === r.id} onClick={() => setSel(r.id)}>
                  <StatusIcon tone={r.tone as any} />
                  <span><span className="rk-cell-strong">{r.t}</span> <span className="rk-cell-mut">· {r.s}</span></span>
                  <span className="rk-num">{r.n}</span>
                  <span className="rk-num">{r.w}</span>
                </Row>
              ))}
            </Table>
          </div>
        </Section>

        <Section label="詳細ドロワー">
          <div className="kit-frame" style={{ height: 240 }}>
            <Drawer
              title="authority · 承認が必要"
              meta={<><StatusChip tone="hold">authority</StatusChip><span>6月13日 12:58</span></>}
              actions={<DeepLink>→ Authorityで開く</DeepLink>}
            >
              <DrawerLabel>詳細</DrawerLabel>
              <DrawerText>personal-assistantがmake_paymentを要求; あなたの承認へルーティングされました。</DrawerText>
              <DrawerLabel>raw</DrawerLabel>
              <div className="rk-drawer__raw"><span className="k">decision</span>: "approval_required",{"\n"}<span className="k">amount</span>: "€128.40"</div>
            </Drawer>
          </div>
        </Section>

        <Section label="空状態 · 教える、決して謝らない">
          <EmptyState title="ワークフローはまだありません" action={<button className="v2-btn v2-btn--primary v2-btn--sm">新規ワークフロー</button>}>
            Jarvisに説明してください: 「平日は毎日8時にメールを要約して」、または手動で作成します。
          </EmptyState>
        </Section>

        <Section label="シェイプ文法 · エンティティと目標" span2>
          <div className="kit-row" style={{ gap: 20 }}>
            {SHAPES.map((s) => (
              <span key={s.kind} style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--ink2)" }}>
                <Shape kind={s.kind} />{s.label} · {s.kind}
              </span>
            ))}
          </div>
        </Section>

        <Section label="読み込み中 · スケルトン、スピナーは使わない">
          <Skeleton widths={["72%", "88%", "55%"]} />
          <div style={{ marginTop: 16 }}><Toast tone="ok">ワークフローを保存しました · モーニングブリーフ</Toast></div>
        </Section>

        <Section label="トースト · 5つのトーン">
          <div className="kit-row" style={{ flexDirection: "column", alignItems: "flex-start", gap: 8 }}>
            <Toast tone="run">research-analystを開始しました</Toast>
            <Toast tone="hold">対応待ち · Lufthansa €128.40</Toast>
            <Toast tone="fail">バックアップ同期に失敗しました</Toast>
          </div>
        </Section>

        <Section label="フォームコントロール" span2>
          <div className="kit-row" style={{ gap: 18 }}>
            <Input placeholder="Vaultを検索…" />
            <Select defaultValue="marin"><option value="marin">marin</option><option value="native">native</option></Select>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--ink2)" }}>
              <Switch on={sw} onClick={() => setSw((v) => !v)} label="TTS" /> 音声応答
            </span>
            <Check on={chk} onClick={() => setChk((v) => !v)}>エラーのみ</Check>
          </div>
        </Section>
      </div>
    </div>
  );
}

const KIT_CSS = `
.kit-page { min-height: 100vh; background: var(--bg); color: var(--ink); font-family: var(--sans); padding: 40px 44px 80px; box-sizing: border-box; }
.kit-head { max-width: 760px; margin: 0 auto 32px; }
.kit-head__eyebrow { font-family: var(--mono); font-size: 10px; letter-spacing: .18em; text-transform: uppercase; color: var(--ink3); margin-bottom: 12px; }
.kit-head__title { font-size: 34px; font-weight: 700; letter-spacing: -.025em; margin: 0 0 10px; line-height: 1.08; }
.kit-head__sub { font-size: 14px; color: var(--ink2); line-height: 1.6; max-width: 66ch; margin: 0; }
.kit-grid { max-width: 1080px; margin: 0 auto; display: grid; grid-template-columns: 1fr 1fr; gap: 18px; align-items: start; }
.kit-sec { border: 1px solid var(--rule); border-radius: var(--corner); background: var(--raise); box-shadow: var(--sh-sm); overflow: hidden; }
.kit-sec__label { font-family: var(--mono); font-size: 9px; letter-spacing: .14em; text-transform: uppercase; color: var(--ink3); padding: 12px 16px 0; }
.kit-sec__body { padding: 16px; }
.kit-row { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
.kit-frame { border: 1px solid var(--rule); border-radius: var(--corner-sm); overflow: hidden; background: var(--bg); }
@media (max-width: 760px){ .kit-grid { grid-template-columns: 1fr; } .kit-sec[style] { grid-column: span 1 !important; } }
`;
