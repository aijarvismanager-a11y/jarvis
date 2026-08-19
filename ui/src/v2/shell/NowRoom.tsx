import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { openRoom, type RoomKey } from "../router";
import { useLiveData, type LiveData } from "./LiveDataContext";
import type { ConnectionState } from "./Header";

/**
 * Now — the home surface you compose. A grid of widgets, each a room's
 * headline. Arrange enters editing: drag to reorder, resize between half
 * and full width, remove, or add from the catalog (one+ widget per room).
 * Layout (order + sizes + which are present) persists per user.
 *
 * waiting-on-you can't be removed while it's amber — safety outranks taste.
 */

type WSize = 1 | 2;
type LayoutItem = { id: string; size: WSize };
type RenderCtx = { live: LiveData; onApprove: (id: string) => void; onCancel: (id: string) => void };
type WidgetDef = {
  id: string;
  group: "run" | "know" | "guard" | "build" | "system";
  dot?: string;
  desc: string;
  defaultSize: WSize;
  render: (ctx: RenderCtx) => React.ReactNode;
};

const LAYOUT_KEY = "jarvis-now-layout-v2";

function rel(ts: number): string {
  const d = Date.now() - ts;
  if (d < 0) return "";
  const m = Math.floor(d / 60000);
  if (m < 1) return "今";
  if (m < 60) return `${m}分`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}時間`;
  return `${Math.floor(h / 24)}日`;
}

/* ── shared header + empty-state helpers ── */
function WHeader({ label, room, tone }: { label: string; room?: RoomKey; tone?: "hold" }) {
  return (
    <div className={`rs-ch${tone ? " " + tone : ""}`}>
      {label}
      {room && <button className="lnk" onClick={() => openRoom(room)}>{room} →</button>}
    </div>
  );
}
function Empty({ children }: { children: React.ReactNode }) {
  return <div className="rs-empty">{children}</div>;
}
function Row({ dot, room, children, tm }: { dot: string; room: RoomKey; children: React.ReactNode; tm?: string }) {
  return (
    <button className="rs-row" onClick={() => openRoom(room)}>
      <span className="rs-dot" style={{ background: dot }} />
      <span className="tx">{children}</span>
      {tm != null && <span className="tm">{tm}</span>}
    </button>
  );
}

/* ── live data shaping ── */
function agentRows(live: LiveData) {
  const byAgent = new Map<string, { name: string; what: string; ts: number; running: boolean }>();
  for (const e of live.agentActivity) {
    const what = e.eventType === "tool_call" ? "ツール実行中" : e.eventType === "done" ? "完了" : "作業中";
    byAgent.set(e.agentName, { name: e.agentName, what, ts: e.timestamp, running: e.eventType !== "done" });
  }
  return [...byAgent.values()].sort((a, b) => b.ts - a.ts).slice(0, 4);
}
function todayRows(live: LiveData) {
  const rows: { id: string; dot: string; text: string; ts: number }[] = [];
  for (const t of live.taskEvents) rows.push({ id: `t${t.task.id}${t.timestamp}`, dot: t.task.status === "done" ? "var(--ok)" : "var(--speak)", text: t.task.what, ts: t.timestamp });
  for (const c of live.contentEvents) rows.push({ id: `c${c.item.id}${c.timestamp}`, dot: "var(--ok)", text: `${c.item.title} · ${c.item.stage}`, ts: c.timestamp });
  for (const n of live.notices) rows.push({ id: `n${n.id}`, dot: "var(--listen)", text: n.title, ts: Date.now() });
  return rows.sort((a, b) => b.ts - a.ts).slice(0, 5);
}
function taskRows(live: LiveData) {
  const seen = new Map<string, { id: string; what: string; status: string; due: number | null }>();
  for (const t of live.taskEvents) {
    if (t.action === "deleted") { seen.delete(t.task.id); continue; }
    if (t.task.status !== "done") seen.set(t.task.id, { id: t.task.id, what: t.task.what, status: t.task.status, due: t.task.when_due });
  }
  return [...seen.values()].slice(0, 4);
}

/* ── async room-data widgets ──
   The rooms below aren't in the live stream, so each widget fetches its room's
   API directly and polls. Every one degrades to its honest empty state on a
   fresh install (no data) or a failed request — nothing fake ever renders. */
function useWidgetData<T>(url: string, pollMs = 15000): { data: T | null; loaded: boolean } {
  const [data, setData] = useState<T | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      if (document.hidden) return; // don't poll hidden tabs; refresh on return
      fetch(url)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => { if (!cancelled) { setData((d ?? null) as T | null); setLoaded(true); } })
        .catch(() => { if (!cancelled) setLoaded(true); });
    };
    load();
    const t = window.setInterval(load, pollMs);
    const onVisible = () => { if (!document.hidden) load(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { cancelled = true; window.clearInterval(t); document.removeEventListener("visibilitychange", onVisible); };
  }, [url, pollMs]);
  return { data, loaded };
}

function relPast(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return "たった今";
  const m = Math.round(s / 60); if (m < 60) return `${m}分前`;
  const h = Math.round(m / 60); if (h < 24) return `${h}時間前`;
  return `${Math.round(h / 24)}日前`;
}
function relSoon(ts: number): string {
  const s = Math.round((ts - Date.now()) / 1000);
  if (s < 60) return "まもなく";
  const m = Math.round(s / 60); if (m < 60) return `${m}分後`;
  const h = Math.round(m / 60); if (h < 24) return `${h}時間後`;
  return `${Math.round(h / 24)}日後`;
}
const deslug = (s: string) => s.replace(/[_-]+/g, " ").trim();

function Stat({ n, unit, sub }: { n: React.ReactNode; unit?: string; sub?: React.ReactNode }) {
  return (
    <div className="rs-wstat">
      <div className="rs-wstat-n">{n}{unit != null && <span> {unit}</span>}</div>
      {sub != null && <div className="rs-wstat-s">{sub}</div>}
    </div>
  );
}
function Loading() { return <Empty><span className="dim">読み込み中…</span></Empty>; }

function CalendarWidget() {
  const now = Date.now();
  const { data, loaded } = useWidgetData<Array<{ title: string; timestamp: number }>>(
    `/api/calendar?range_start=${now}&range_end=${now + 7 * 86400000}`);
  const up = Array.isArray(data) ? data.filter((e) => e.timestamp >= now).sort((a, b) => a.timestamp - b.timestamp) : [];
  const next = up[0];
  return (<><WHeader label="カレンダー · 次" room="calendar" />
    {next ? <Stat n={up.length} unit="件の予定" sub={<>次: <b>{next.title}</b> · {relSoon(next.timestamp)}</>} />
      : loaded ? <Empty>今週の予定はありません。<span className="dim">設定でカレンダーを連携できます。</span></Empty> : <Loading />}</>);
}

function MemoryWidget() {
  const { data, loaded } = useWidgetData<Array<{ predicate: string; object: string; created_at: number }>>("/api/vault/facts");
  const facts = Array.isArray(data) ? [...data].sort((a, b) => b.created_at - a.created_at) : [];
  const newest = facts[0];
  return (<><WHeader label="記憶 · 新着" room="memory" />
    {newest ? <Stat n={facts.length} unit="件の事実" sub={<>最新: {deslug(newest.predicate)} <b>{newest.object}</b></>} />
      : loaded ? <Empty>Jarvisが学んだ新しい事実がここに表示されます。<span className="dim">記憶でボールトを確認できます。</span></Empty> : <Loading />}</>);
}

function GoalsWidget() {
  const { data, loaded } = useWidgetData<Array<{ status: string; health: string }>>("/api/goals");
  const goals = Array.isArray(data) ? data : [];
  const active = goals.filter((g) => g.status === "active");
  const onTrack = active.filter((g) => g.health === "on_track").length;
  return (<><WHeader label="目標 · 状態" room="goals" />
    {goals.length ? <Stat n={active.length} unit="件の進行中目標" sub={active.length ? <>{onTrack}件が順調 · {active.length - onTrack}件が要注意</> : "進行中の目標なし"} />
      : loaded ? <Empty>まだ目標が設定されていません。<span className="dim">目標で目的を定義すると、ここに表示されます。</span></Empty> : <Loading />}</>);
}

function WorkflowsWidget() {
  const { data, loaded } = useWidgetData<Array<Record<string, unknown>>>("/api/workflows");
  const flows = Array.isArray(data) ? data : [];
  const live = flows.filter((f) => f.enabled === true || f.published === true || f.status === "published").length;
  return (<><WHeader label="ワークフロー" room="workflows" />
    {flows.length ? <Stat n={flows.length} unit="件のワークフロー" sub={live ? `${live}件が有効` : "有効なものはまだありません"} />
      : loaded ? <Empty>保存された自動化の状態がここに表示されます。<span className="dim">ワークフローで作成できます。</span></Empty> : <Loading />}</>);
}

function AuthorityAuditWidget() {
  const { data, loaded } = useWidgetData<Array<{ tool_name: string; authority_decision: string; created_at: number }>>("/api/authority/audit?limit=20");
  const rows = Array.isArray(data) ? [...data].sort((a, b) => b.created_at - a.created_at) : [];
  const latest = rows[0];
  return (<><WHeader label="権限 · 監査" room="authority" />
    {latest ? <Stat n={rows.length} unit="件の最近の記録" sub={<>最新: <b>{deslug(latest.tool_name)}</b> · {relPast(latest.created_at)}</>} />
      : loaded ? <Empty>承認済みアクションの監査履歴がここに表示されます。<span className="dim">権限で全ログを確認できます。</span></Empty> : <Loading />}</>);
}

function UsageWidget() {
  const now = Date.now();
  const { data, loaded } = useWidgetData<Record<string, unknown>>(
    `/api/usage?range_start=${now - 7 * 86400000}&range_end=${now}`);
  // Shape varies; defensively pull a token total from the likely fields.
  const d = (data ?? {}) as Record<string, any>;
  const tokens: number | null =
    typeof d.totalTokens === "number" ? d.totalTokens :
    typeof d.total?.tokens === "number" ? d.total.tokens :
    typeof d.tokens === "number" ? d.tokens :
    Array.isArray(d.rows) ? d.rows.reduce((s: number, r: any) => s + (Number(r?.tokens) || 0), 0) : null;
  const fmt = (n: number) => n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(n);
  return (<><WHeader label="使用量 · 週間" room="usage" />
    {tokens != null && tokens > 0 ? <Stat n={fmt(tokens)} unit="トークン" sub="過去7日間 · 全モデル" />
      : loaded ? <Empty>モデル別の週間トークン使用量がここに表示されます。<span className="dim">使用量で全メーターを確認できます。</span></Empty> : <Loading />}</>);
}

function WorkspacesWidget() {
  const { data, loaded } = useWidgetData<Array<{ status: string; gitDirty?: boolean }>>("/api/sites/projects");
  const projects = Array.isArray(data) ? data : [];
  const running = projects.filter((p) => p.status === "running").length;
  const dirty = projects.filter((p) => p.gitDirty).length;
  return (<><WHeader label="ワークスペース" room="workspaces" />
    {projects.length ? <Stat n={projects.length} unit="件のプロジェクト" sub={<>{running}件が稼働中{dirty ? ` · ${dirty}件に変更あり` : ""}</>} />
      : loaded ? <Empty>プロジェクトの開発サーバーとgit状態がここに表示されます。<span className="dim">ワークスペースを開く。</span></Empty> : <Loading />}</>);
}

function ToolsWidget() {
  const { data, loaded } = useWidgetData<Array<Record<string, unknown>>>("/api/tools");
  const tools = Array.isArray(data) ? data : [];
  const enabled = tools.filter((t) => t.enabled !== false).length;
  return (<><WHeader label="ツール" room="tools" />
    {tools.length ? <Stat n={tools.length} unit="件の機能" sub={`${enabled}件が有効`} />
      : loaded ? <Empty>機能カタログはツールにあります。<span className="dim">開いてフラグを管理できます。</span></Empty> : <Loading />}</>);
}

function SettingsWidget() {
  const { data, loaded } = useWidgetData<{ status?: string }>("/api/auth/google/status");
  const connected = data?.status === "connected";
  return (<><WHeader label="設定" room="settings" />
    {loaded ? <Stat n={connected ? "接続済み" : "未設定"} sub={connected ? "Google · プロバイダー、音声、チャンネル" : "Google、プロバイダー、音声、チャンネルを連携"} />
      : <Loading />}</>);
}

/* ── the widget catalog — one+ per room, broadly composable ── */
const WIDGETS: Record<string, WidgetDef> = {
  "right-now": {
    id: "right-now", group: "run", dot: "var(--speak)", desc: "稼働中のエージェントと作業内容。", defaultSize: 1,
    render: ({ live }) => {
      const a = agentRows(live);
      return (<><WHeader label="今の状況" room="agents" />
        {a.length ? a.map((x) => <Row key={x.name} dot={x.running ? "var(--speak)" : "var(--faint)"} room="agents" tm={rel(x.ts)}><b>{x.name}</b> · {x.what}</Row>)
          : <Empty>まだ何も稼働していません。<b>「Hey Jarvis」</b>と話しかけて何か任せるか、<b>ワークフロー</b>から始めましょう。</Empty>}</>);
    },
  },
  waiting: {
    id: "waiting", group: "guard", dot: "var(--hold)", desc: "保留中の承認、ここで対応できます。琥珀色の間は上部に固定。", defaultSize: 1,
    render: ({ live, onApprove, onCancel }) => (<><WHeader label={`あなたの確認待ち · ${live.approvals.length}`} room="authority" tone="hold" />
      {live.approvals.length ? live.approvals.slice(0, 3).map((a) => (
        <div className="rs-apr" key={a.id}>
          <div className="t1"><span className="rs-dot" />{a.category} · {a.toolName}</div>
          <div className="t2">{a.intent}</div>
          <div className="bs"><button className="b1" onClick={() => onApprove(a.id)}>はい · 承認</button><button className="b2" onClick={() => onCancel(a.id)}>キャンセル</button></div>
        </div>
      )) : <Empty>承認が必要なアクションはここに表示されます。<span className="dim">今は何も待っていません。</span></Empty>}</>),
  },
  today: {
    id: "today", group: "guard", dot: "var(--ok)", desc: "深夜0時からの実行と結果、トーン付き。", defaultSize: 2,
    render: ({ live }) => {
      const r = todayRows(live);
      return (<><WHeader label="今日" room="logs" />
        {r.length ? r.map((x) => <Row key={x.id} dot={x.dot} room="logs" tm={rel(x.ts)}>{x.text}</Row>)
          : <Empty>初日です。最初のモーニングブリーフは<b>明日7:00</b>に予定されており、ここに報告されます。</Empty>}</>);
    },
  },
  calendar: {
    id: "calendar", group: "know", dot: "var(--faint)", desc: "直近2件の予定、保留、集中ブロック。", defaultSize: 1,
    render: () => <CalendarWidget />,
  },
  vitals: {
    id: "vitals", group: "system", dot: "var(--faint)", desc: "稼働中エージェント、確認待ち承認、本日のイベント数。", defaultSize: 1,
    render: ({ live }) => {
      const active = agentRows(live).filter((a) => a.running).length;
      return (<><WHeader label="バイタル" /><div className="rs-vit">
        <div className="v"><span className="k">エージェント</span><div className="n">{active}<span> 稼働中</span></div></div>
        <div className="v"><span className="k">確認待ち</span><div className="n">{live.approvals.length}</div></div>
        <div className="v"><span className="k">イベント</span><div className="n">{todayRows(live).length}<span> 本日</span></div></div>
      </div></>);
    },
  },
  "tasks-due": {
    id: "tasks-due", group: "run", dot: "var(--faint)", desc: "本日期限・期限超過、優先度トーン付き。", defaultSize: 1,
    render: ({ live }) => {
      const t = taskRows(live);
      return (<><WHeader label="タスク · 期限" room="tasks" />
        {t.length ? t.map((x) => <Row key={x.id} dot={x.status === "in_progress" ? "var(--speak)" : "var(--faint)"} room="tasks" tm={x.due ? (x.due < Date.now() ? relPast(x.due) : relSoon(x.due)) : ""}>{x.what}</Row>)
          : <Empty>未完了のタスクはありません。<span className="dim">Jarvisに依頼するか、タスクで追加できます。</span></Empty>}</>);
    },
  },
  "agents-roster": {
    id: "agents-roster", group: "run", dot: "var(--speak)", desc: "全エージェント一覧と委任の深さ。", defaultSize: 1,
    render: ({ live }) => {
      const a = agentRows(live);
      return (<><WHeader label="エージェント · 一覧" room="agents" />
        {a.length ? a.map((x) => <Row key={x.name} dot={x.running ? "var(--speak)" : "var(--ok)"} room="agents" tm={x.running ? "稼働中" : ""}><b>{x.name}</b></Row>)
          : <Empty>専門エージェントは実行後にここに表示されます。<span className="dim">エージェントで一覧を確認できます。</span></Empty>}</>);
    },
  },
  goals: {
    id: "goals", group: "know", dot: "var(--ok)", desc: "目標とその状態トーン。要注意は表示優先。", defaultSize: 1,
    render: () => <GoalsWidget />,
  },
  pipeline: {
    id: "pipeline", group: "know", dot: "var(--faint)", desc: "レビュー中・予定中のカード。編集ゲート。", defaultSize: 1,
    render: ({ live }) => {
      const c = live.contentEvents.slice(-4).reverse();
      return (<><WHeader label="パイプライン" room="content" />
        {c.length ? c.map((x) => <Row key={`${x.item.id}${x.timestamp}`} dot="var(--faint)" room="content" tm={x.item.stage}>{x.item.title}</Row>)
          : <Empty>パイプラインに何もありません。<span className="dim">コンテンツで下書きを作成できます。</span></Empty>}</>);
    },
  },
  workflows: {
    id: "workflows", group: "run", dot: "var(--speak)", desc: "保存済み自動化と最終実行。", defaultSize: 1,
    render: () => <WorkflowsWidget />,
  },
  memory: {
    id: "memory", group: "know", dot: "var(--faint)", desc: "最近学習した事実とエンティティ。", defaultSize: 1,
    render: () => <MemoryWidget />,
  },
  "authority-audit": {
    id: "authority-audit", group: "guard", dot: "var(--faint)", desc: "最近の付与と監査済みアクション。", defaultSize: 1,
    render: () => <AuthorityAuditWidget />,
  },
  "usage-week": {
    id: "usage-week", group: "guard", dot: "var(--faint)", desc: "モデル別トークン使用量 — 数値で見るプライバシー。", defaultSize: 1,
    render: () => <UsageWidget />,
  },
  workspaces: {
    id: "workspaces", group: "build", dot: "var(--faint)", desc: "開発プロジェクト、git状態、稼働中サーバー。", defaultSize: 1,
    render: () => <WorkspacesWidget />,
  },
  tools: {
    id: "tools", group: "build", dot: "var(--faint)", desc: "機能カタログと最近の呼び出し。", defaultSize: 1,
    render: () => <ToolsWidget />,
  },
  settings: {
    id: "settings", group: "system", dot: "var(--faint)", desc: "プロバイダー、音声、チャンネル — すぐアクセス。", defaultSize: 1,
    render: () => <SettingsWidget />,
  },
};

const GROUP_LABEL: Record<WidgetDef["group"], string> = { run: "実行", know: "情報", guard: "監視", build: "構築", system: "システム" };
const CATALOG_ORDER = Object.keys(WIDGETS);

const DEFAULT_LAYOUT: LayoutItem[] = [
  { id: "right-now", size: 1 }, { id: "waiting", size: 1 }, { id: "today", size: 2 },
  { id: "calendar", size: 1 }, { id: "vitals", size: 1 },
];

function loadLayout(): LayoutItem[] {
  try {
    const raw = localStorage.getItem(LAYOUT_KEY);
    if (!raw) return DEFAULT_LAYOUT;
    const parsed = JSON.parse(raw) as LayoutItem[];
    const seen = new Set<string>(); // duplicate ids would collide as React keys
    const clean = parsed
      .filter((i) => WIDGETS[i.id] && !seen.has(i.id) && (seen.add(i.id), true))
      .map((i) => ({ id: i.id, size: (i.size === 2 ? 2 : 1) as WSize }));
    return clean.length ? clean : DEFAULT_LAYOUT;
  } catch { return DEFAULT_LAYOUT; }
}

export function NowRoom({
  connection, arranging, onApprove, onCancel,
}: {
  connection: ConnectionState;
  arranging: boolean;
  onApprove: (id: string) => void;
  onCancel: (id: string) => void;
}) {
  const live = useLiveData();
  const [layout, setLayout] = useState<LayoutItem[]>(loadLayout);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  const persist = (l: LayoutItem[]) => { try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(l)); } catch { /* ignore */ } };
  const commit = useCallback((l: LayoutItem[]) => { setLayout(l); persist(l); }, []);

  const offline = connection === "offline";
  const amberPinned = live.approvals.length > 0;

  // waiting-on-you is force-present (and immovable) while amber.
  const items = useMemo(() => {
    let l = layout.filter((i) => WIDGETS[i.id]);
    if (amberPinned && !l.some((i) => i.id === "waiting")) l = [{ id: "waiting", size: 1 }, ...l];
    return l;
  }, [layout, amberPinned]);

  const available = useMemo(() => CATALOG_ORDER.filter((id) => !items.some((i) => i.id === id)), [items]);

  const ctx: RenderCtx = { live, onApprove, onCancel };

  const remove = (id: string) => { if (id === "waiting" && amberPinned) return; commit(layout.filter((i) => i.id !== id)); };
  const resize = (id: string) => commit(layout.map((i) => (i.id === id ? { ...i, size: (i.size === 2 ? 1 : 2) as WSize } : i)));
  const add = (id: string) => { const def = WIDGETS[id]; if (!def || layout.some((i) => i.id === id)) return; commit([...layout, { id, size: def.defaultSize }]); };
  const resetDefault = () => { commit(DEFAULT_LAYOUT); setCatalogOpen(false); };

  // Native drag-reorder: live-reorder as the dragged widget passes over a target.
  const onDragStart = (id: string) => setDragId(id);
  const onDragOver = (e: React.DragEvent, id: string) => {
    if (!dragId) return;
    e.preventDefault();
    setOverId(id);
    if (id === dragId) return;
    setLayout((prev) => {
      const a = [...prev];
      const fi = a.findIndex((x) => x.id === dragId);
      const ti = a.findIndex((x) => x.id === id);
      if (fi < 0 || ti < 0 || fi === ti) return prev;
      const [m] = a.splice(fi, 1);
      if (!m) return prev;
      a.splice(ti, 0, m);
      return a;
    });
  };
  const onDragEnd = () => { setDragId(null); setOverId(null); persist(layoutRef.current); };

  return (
    <div className={`rs-surface${offline ? " dim" : ""}${arranging ? " editing" : ""}`}>
      {offline && (
        <div className="rs-notice">
          <div className="gd2" />
          <div className="t">デーモンに接続中…</div>
          <div className="s">ダッシュボードがランタイムに接続できません。サービスを確認するか、自分で起動してください:</div>
          <span className="mono2">jarvis start</span>
        </div>
      )}

      {items.map((item) => {
        const def = WIDGETS[item.id];
        if (!def) return null;
        const canRemove = !(item.id === "waiting" && amberPinned);
        // The force-pinned waiting widget isn't in `layout`, so drag/resize
        // would be silent no-ops — don't offer chrome that does nothing.
        const synthetic = !layout.some((i) => i.id === item.id);
        return (
          <div
            key={item.id}
            className={`rs-wid${item.size === 2 ? " w2" : ""}${dragId === item.id ? " dragging" : ""}${overId === item.id && dragId && dragId !== item.id ? " dragover" : ""}`}
            draggable={arranging && !synthetic}
            onDragStart={synthetic ? undefined : () => onDragStart(item.id)}
            onDragOver={synthetic ? undefined : (e) => onDragOver(e, item.id)}
            onDragEnd={synthetic ? undefined : onDragEnd}
          >
            {arranging && !synthetic && (
              <div className="rs-wtools">
                <button className="rs-wtool" onClick={() => resize(item.id)} title={item.size === 2 ? "半幅" : "全幅"} aria-label={item.size === 2 ? "半幅" : "全幅"}>{item.size === 2 ? "½" : "全幅"}</button>
                <button className="rs-wtool rm" onClick={() => remove(item.id)} disabled={!canRemove} title={canRemove ? "削除" : "確認待ちの間は削除できません"} aria-label="ウィジェットを削除">✕</button>
              </div>
            )}
            {def.render(ctx)}
          </div>
        );
      })}

      {arranging && !catalogOpen && (
        <button className="rs-addtile" onClick={() => setCatalogOpen(true)}>+ ウィジェットを追加</button>
      )}

      {arranging && catalogOpen && (
        <div className="rs-catalog">
          <div className="rs-catalog-h">ウィジェットカタログ · 各部屋の要約<button className="x" onClick={() => setCatalogOpen(false)}>完了</button></div>
          {available.length ? (
            <div className="rs-catalog-grid">
              {available.map((id) => {
                const def = WIDGETS[id];
                if (!def) return null;
                return (
                  <button key={id} className="rs-cwidget" onClick={() => add(id)}>
                    <div className="ct"><span className="rs-dot" style={{ background: def.dot ?? "var(--faint)" }} />{WIDGET_TITLE(id)}<small>{GROUP_LABEL[def.group]} · {def.defaultSize}×</small></div>
                    <div className="cs">{def.desc}</div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="rs-catalog-foot"><span className="none">すべてのウィジェットが追加済みです。</span></div>
          )}
          <div className="rs-catalog-foot"><button onClick={resetDefault}>デフォルト配置に戻す</button></div>
        </div>
      )}
    </div>
  );
}

/** Human title for a widget id (its first header word group), for the catalog. */
function WIDGET_TITLE(id: string): string {
  const map: Record<string, string> = {
    "right-now": "今の状況", waiting: "あなたの確認待ち", today: "今日", calendar: "カレンダー · 次",
    vitals: "バイタル", "tasks-due": "タスク · 期限", "agents-roster": "エージェント · 一覧", goals: "目標 · 状態",
    pipeline: "パイプライン", workflows: "ワークフロー", memory: "記憶 · 新着", "authority-audit": "権限 · 監査",
    "usage-week": "使用量 · 週間", workspaces: "ワークスペース", tools: "ツール", settings: "設定",
  };
  return map[id] ?? id;
}
