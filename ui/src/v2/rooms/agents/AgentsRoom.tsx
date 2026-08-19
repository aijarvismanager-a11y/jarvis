import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  Code2,
  FlaskConical,
  PenTool,
  BarChart3,
  Server,
  Scale,
  Wallet,
  Users,
  ClipboardList,
  Megaphone,
  Headphones,
  Plus,
  Search,
  X,
  ArrowRight,
  type LucideIcon,
} from "lucide-react";
import { Chip, Icon } from "../../ui";
import { StatusChip, type Tone } from "../../ui/roomkit";
import { RoomShell } from "../RoomShell";
import { openRoom } from "../../router";
import { useRoomActions } from "../useRoomActionBus";
import { useRovingTabs } from "../useRovingTabs";
import { specLevelLabel } from "./specLevel";
import {
  useAgentsData,
  useFullTaskResponse,
  formatAgentActivityText,
  agentInitials,
  type AgentRosterEntry,
  type SpecialistInfo,
} from "./useAgentsData";
import "./AgentsRoom.css";

/** Each role gets a quiet lucide glyph in place of the legacy emojis. */
const ROLE_ICON: Record<string, LucideIcon> = {
  "personal-assistant": Bot,
  "software-engineer": Code2,
  "research-analyst": FlaskConical,
  "content-writer": PenTool,
  "data-analyst": BarChart3,
  "system-administrator": Server,
  "legal-advisor": Scale,
  "financial-analyst": Wallet,
  "hr-specialist": Users,
  "project-coordinator": ClipboardList,
  "marketing-strategist": Megaphone,
  "customer-support": Headphones,
};

type TabId = "command" | "orbital" | "builder";
const AGENTS_TAB_KEYS: ReadonlyArray<TabId> = ["command", "orbital", "builder"];

export type RoomBodyMode = "inline" | "expanded";

/**
 * Agents Room body — works in both inline (RoomWindow card) and expanded
 * (RoomShell overlay) presentations. Inline mode collapses to roster-only
 * (no tabs, no orbital), keeping the inline card scannable.
 */
export function AgentsRoomBody({ mode }: { mode: RoomBodyMode }) {
  const data = useAgentsData();
  const [activeTab, setActiveTab] = useState<TabId>("command");
  const tabsApi = useRovingTabs<TabId>(
    AGENTS_TAB_KEYS,
    activeTab,
    setActiveTab,
    "v2-agents",
  );
  const [search, setSearch] = useState("");
  const [spawnOpen, setSpawnOpen] = useState(false);
  const [toast, setToast] = useState<{ text: string; tone: "ok" | "warn" } | null>(null);

  // Auto-clear toasts.
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 4000);
    return () => window.clearTimeout(id);
  }, [toast]);

  const filteredRoster = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return data.roster;
    return data.roster.filter((a) => a.name.toLowerCase().includes(q));
  }, [data.roster, search]);

  const handleSpawn = useCallback(
    async (input: { specialist: string; task: string; context: string }) => {
      const result = await data.spawn(input);
      setToast({ text: result.message, tone: result.ok ? "ok" : "warn" });
      if (result.ok) setSpawnOpen(false);
      return result.ok;
    },
    [data],
  );

  // Phase 6.3.5 — voice-driven Room actions. Each action mirrors a UI
  // affordance the user could click; the daemon's classifier emits these
  // when an utterance maps cleanly. Returns false on unknown action so
  // the bus can log it instead of pretending it succeeded.
  useRoomActions("agents", (action, args) => {
    switch (action) {
      case "switch_tab": {
        const tab = String(args.tab);
        if (tab === "command" || tab === "orbital" || tab === "builder") {
          setActiveTab(tab);
          return true;
        }
        return false;
      }
      case "open_spawn_dialog":
        setSpawnOpen(true);
        return true;
      case "close_dialog":
        setSpawnOpen(false);
        return true;
      case "set_search":
        setSearch(typeof args.query === "string" ? args.query : "");
        return true;
      case "spawn_agent": {
        const specialist = typeof args.specialist === "string" ? args.specialist : "";
        if (!specialist) return false;
        // Fire and forget — the spawn helper toasts on success/failure.
        // We do NOT open the dialog: voice spawn is fully autonomous.
        handleSpawn({
          specialist,
          task: typeof args.task === "string" ? args.task : "",
          context: typeof args.context === "string" ? args.context : "",
        });
        return true;
      }
      default:
        return false;
    }
  });

  return (
    <div className={`v2-agents v2-agents--${mode}`}>
      {/* Stats bar — shown in both modes */}
      <StatsBar
        active={data.stats.active}
        total={data.stats.total}
        completed24h={data.stats.completed24h}
        delegationDepth={data.stats.delegationDepth}
      />

      {/* Tab bar — expanded only. Inline goes straight to roster. */}
      {mode === "expanded" && (
        <div
          className="v2-agents__tabs"
          role="tablist"
          aria-label="エージェント表示"
          ref={tabsApi.tablistRef}
        >
          <TabButton tabProps={tabsApi.getTabProps("command")} active={activeTab === "command"}>
            コマンドセンター
            <span className="v2-agents__tab-badge">{data.stats.total}</span>
          </TabButton>
          <TabButton tabProps={tabsApi.getTabProps("orbital")} active={activeTab === "orbital"}>
            オービタルビュー
            <span className="v2-agents__tab-badge">実行中 {data.stats.active}</span>
          </TabButton>
          <TabButton tabProps={tabsApi.getTabProps("builder")} active={activeTab === "builder"}>
            エージェントビルダー
            <span className="v2-agents__tab-badge">→ ワークフロー</span>
          </TabButton>
        </div>
      )}

      {/* Toolbar — search + spawn */}
      <div className="v2-agents__toolbar">
        <div className="v2-agents__search">
          <Icon icon={Search} size="sm" />
          <input
            className="v2-agents__search-input"
            type="text"
            placeholder="エージェントを検索…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="エージェントを検索"
          />
        </div>
        <button
          type="button"
          className="v2-agents__spawn-btn"
          onClick={() => setSpawnOpen(true)}
        >
          <Icon icon={Plus} size="sm" />
          エージェントを起動
        </button>
      </div>

      {data.error && <div className="v2-agents__error">{data.error}</div>}

      {/* Tab content. Inline mode = always roster. */}
      {(mode === "inline" || activeTab === "command") && (
        <CommandCenter roster={filteredRoster} />
      )}
      {mode === "expanded" && activeTab === "orbital" && (
        <Orbital roster={data.roster} liveActivity={data.liveActivity} />
      )}
      {mode === "expanded" && activeTab === "builder" && <BuilderRedirect />}

      {spawnOpen && (
        <SpawnDialog
          specialists={data.specialists}
          onClose={() => setSpawnOpen(false)}
          onSpawn={handleSpawn}
        />
      )}

      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="v2-agents__toast"
          data-tone={toast.tone}
        >
          {toast.text}
        </div>
      )}
    </div>
  );
}

/** Overlay-mode wrapper. Direct URL / palette Shift+Enter / explicit "expand". */
export function AgentsRoom() {
  return (
    <RoomShell title="エージェント" subtitle="名簿 · 状態 · 委任" breadcrumb={["エージェント"]}>
      <AgentsRoomBody mode="expanded" />
    </RoomShell>
  );
}

/* ─────────── Subcomponents ─────────── */

function StatsBar({
  active,
  total,
  completed24h,
  delegationDepth,
}: {
  active: number;
  total: number;
  completed24h: number;
  delegationDepth: number;
}) {
  return (
    <div className="v2-agents__stats">
      <StatCard label="稼働中" value={`${active}`} sub={`全 ${total} 中`} />
      <StatCard
        label="完了タスク"
        value={`${completed24h}`}
        sub="このセッション"
      />
      <StatCard label="平均応答" value="—" sub="中央値" />
      <StatCard
        label="委任の深さ"
        value={`${delegationDepth}`}
        sub="アクティブな階層"
      />
    </div>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="v2-agents__stat">
      <div className="v2-agents__stat-label">{label}</div>
      <div className="v2-agents__stat-value">{value}</div>
      <div className="v2-agents__stat-sub">{sub}</div>
    </div>
  );
}

function TabButton({
  tabProps,
  active,
  children,
}: {
  /** Result of `useRovingTabs.getTabProps(key)` — supplies all the
   *  WAI-ARIA attributes (role, id, aria-selected, aria-controls,
   *  tabIndex) plus the click handler and roving-tab data attribute. */
  tabProps: Record<string, unknown>;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className="v2-agents__tab"
      data-active={active}
      {...tabProps}
    >
      {children}
    </button>
  );
}

function CommandCenter({ roster }: { roster: AgentRosterEntry[] }) {
  const active = roster.filter((a) => a.isActive);
  const idle = roster.filter((a) => !a.isActive);

  return (
    <div className="v2-agents__command">
      {active.length > 0 && (
        <Section label="稼働中">
          <div className="v2-agents__grid">
            {active.map((a) => (
              <AgentCard key={a.roleId} agent={a} />
            ))}
          </div>
        </Section>
      )}
      {idle.length > 0 && (
        <Section label="待機中">
          <div className="v2-agents__grid">
            {idle.map((a) => (
              <AgentCard key={a.roleId} agent={a} />
            ))}
          </div>
        </Section>
      )}
      {roster.length === 0 && (
        <div className="v2-agents__empty">検索条件に一致するエージェントがありません。</div>
      )}
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="v2-agents__section">
      <div className="v2-agents__section-label">{label}</div>
      {children}
    </section>
  );
}

function AgentCard({ agent }: { agent: AgentRosterEntry }) {
  const IconComp = ROLE_ICON[agent.roleId] ?? Bot;
  const currentTask =
    agent.live?.current_task ?? agent.live?.latest_task?.task ?? null;
  const sinceTs = agent.live?.created_at ?? null;
  const latestTask = agent.live?.latest_task ?? null;
  // Show the finished task's answer once the agent is no longer busy —
  // this is where the user actually reads what the sub-agent produced.
  const finishedResult =
    !agent.live?.busy && latestTask?.result ? latestTask.result : null;
  // The roster poll caps long responses; fetch the full text only once
  // the user actually expands the result.
  const [resultOpen, setResultOpen] = useState(false);
  const fullResponse = useFullTaskResponse(latestTask, resultOpen);

  // Status remap (agents §01): primary is the one red accent in the room,
  // active is BLUE (in-motion, not green), idle is neutral.
  let statusLabel: string;
  let statusTone: Tone;
  if (agent.isPrimary) {
    statusLabel = "プライマリ";
    statusTone = "fail";
  } else if (agent.live?.busy) {
    statusLabel = "稼働中";
    statusTone = "run";
  } else {
    statusLabel = "待機中";
    statusTone = "mut";
  }

  let timeLabel = "";
  if (sinceTs) {
    timeLabel = agent.isActive
      ? `${formatTime(sinceTs)} から`
      : `最終: ${formatRelative(sinceTs)}`;
  }

  return (
    <article className="v2-agents__card" data-active={agent.isActive}>
      <div className="v2-agents__card-head">
        <div className="v2-agents__card-icon">
          <span className="v2-agents__avatar-txt">{agentInitials(agent.name)}</span>
        </div>
        <div className="v2-agents__card-id">
          <div className="v2-agents__card-name">{agent.name}</div>
          <div className="v2-agents__card-task" data-empty={!currentTask}>
            {currentTask ?? "タスク待ち…"}
          </div>
        </div>
        <StatusChip tone={statusTone} dot>
          {statusLabel}
        </StatusChip>
      </div>
      {finishedResult && (
        <details
          className="v2-agents__card-result"
          onToggle={(e) => setResultOpen((e.target as HTMLDetailsElement).open)}
        >
          <summary className="v2-agents__card-result-summary">
            <StatusChip tone={finishedResult.success ? "ok" : "hold"} dot>
              {finishedResult.success ? "結果あり" : "タスク失敗"}
            </StatusChip>
            <span className="v2-agents__card-result-hint">
              {latestTask?.completed_at
                ? formatRelative(latestTask.completed_at)
                : ""}
            </span>
          </summary>
          <div className="v2-agents__card-result-body">
            {fullResponse ?? finishedResult.response}
          </div>
        </details>
      )}
      <div className="v2-agents__card-foot">
        <AuthorityBar authority={agent.authority} active={agent.isActive} />
        <div className="v2-agents__card-foot-spacer" />
        <span className="v2-agents__tools">ツール {agent.tools}</span>
        {timeLabel && <span className="v2-agents__since">{timeLabel}</span>}
      </div>
    </article>
  );
}

function AuthorityBar({ authority, active }: { authority: number; active: boolean }) {
  return (
    <div className="v2-agents__authority" aria-label={`権限 10 段階中 ${authority}`}>
      {Array.from({ length: 10 }, (_, i) => (
        <span
          key={i}
          className="v2-agents__pip"
          data-filled={i < authority}
          data-active={active}
        />
      ))}
      <span className="v2-agents__authority-label">権限 {authority}</span>
    </div>
  );
}

/* ─────────── Orbital View ─────────── */

function Orbital({
  roster,
  liveActivity,
}: {
  roster: AgentRosterEntry[];
  liveActivity: ReturnType<typeof useAgentsData>["liveActivity"];
}) {
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);

  const pa = roster.find((a) => a.isPrimary);
  const nodes = roster.filter((a) => !a.isPrimary);
  const selected = selectedRoleId
    ? roster.find((a) => a.roleId === selectedRoleId) ?? null
    : null;
  // The detail panel shows the result as soon as an agent is selected,
  // so fetch the full text right away when the poll truncated it.
  const selectedResultShown = Boolean(
    selected && !selected.live?.busy && selected.live?.latest_task?.result,
  );
  const selectedFullResponse = useFullTaskResponse(
    selected?.live?.latest_task,
    selectedResultShown,
  );

  // Ticker: most recent 20 events. Duplicated for seamless loop scroll.
  const tickerEvents = liveActivity.slice(0, 20);
  const looped = [...tickerEvents, ...tickerEvents];

  return (
    <div className="v2-agents__orbital">
      {/* Stage holds the scrollable canvas viewport AND the overlay
          detail card. The viewport scrolls when the canvas is bigger
          than it (small screens / narrow Room windows); the detail card
          is positioned on the stage itself so it stays put while the
          canvas pans. */}
      <div className="v2-agents__orbital-stage">
        <div className="v2-agents__orbital-viewport">
          <div className="v2-agents__orbital-canvas">
            {/* Decorative concentric rings */}
            <div className="v2-agents__ring v2-agents__ring--inner" aria-hidden="true" />
            <div className="v2-agents__ring v2-agents__ring--outer" aria-hidden="true" />

            {/* PA center */}
            {pa && (
              <button
                type="button"
                className="v2-agents__orb v2-agents__orb--center"
                data-active={pa.isActive}
                data-selected={selectedRoleId === pa.roleId}
                style={{ left: pa.orbital.left, top: pa.orbital.top }}
                onClick={() =>
                  setSelectedRoleId((prev) => (prev === pa.roleId ? null : pa.roleId))
                }
                title={pa.name}
              >
                <Icon icon={ROLE_ICON[pa.roleId] ?? Bot} size="md" />
                <span className="v2-agents__orb-name">{pa.name}</span>
              </button>
            )}

            {/* Specialists */}
            {nodes.map((a) => {
              const IconComp = ROLE_ICON[a.roleId] ?? Bot;
              return (
                <button
                  key={a.roleId}
                  type="button"
                  className="v2-agents__orb"
                  data-ring={a.ring}
                  data-active={a.isActive}
                  data-selected={selectedRoleId === a.roleId}
                  style={{ left: a.orbital.left, top: a.orbital.top }}
                  onClick={() =>
                    setSelectedRoleId((prev) => (prev === a.roleId ? null : a.roleId))
                  }
                  title={a.name}
                >
                  <span className="v2-agents__avatar-txt">{agentInitials(a.name)}</span>
                  <span className="v2-agents__orb-name">{a.name}</span>
                </button>
              );
            })}
          </div>
        </div>

        {selected && (
          <div className="v2-agents__orbital-detail">
            <div className="v2-agents__orbital-detail-head">
              <span className="v2-agents__orbital-detail-name">{selected.name}</span>
              <StatusChip tone={selected.isActive ? "run" : "mut"} dot>
                {selected.isPrimary ? "プライマリ" : selected.isActive ? "稼働中" : "待機中"}
              </StatusChip>
            </div>
            {selected.live?.current_task && (
              <div className="v2-agents__orbital-detail-task">
                {selected.live.current_task}
              </div>
            )}
            {!selected.live?.busy && selected.live?.latest_task?.result && (
              <div className="v2-agents__orbital-detail-result">
                <div className="v2-agents__orbital-detail-result-label">
                  {selected.live.latest_task.result.success
                    ? "最新の結果"
                    : "直近のタスクが失敗"}
                </div>
                {selectedFullResponse ?? selected.live.latest_task.result.response}
              </div>
            )}
            <div className="v2-agents__orbital-detail-meta">
              権限 {selected.authority} · ツール {selected.tools} · {selected.ring === "center" ? "中心" : selected.ring === "inner" ? "内周" : "外周"}
            </div>
          </div>
        )}
      </div>

      {/* Activity ticker */}
      <div className="v2-agents__ticker">
        <span className="v2-agents__ticker-label">ライブ</span>
        <div className="v2-agents__ticker-track">
          {looped.length > 0 ? (
            <div className="v2-agents__ticker-scroll">
              {looped.map((e, i) => (
                <span key={`${e.id}-${i}`} className="v2-agents__ticker-event">
                  <span
                    className="v2-agents__ticker-dot"
                    data-event={e.eventType}
                    aria-hidden="true"
                  />
                  <span className="v2-agents__ticker-time">{formatTime(e.timestamp)}</span>
                  <span>
                    <span className="v2-agents__ticker-agent">{e.agentName}</span>{" "}
                    {formatAgentActivityText(e)}
                  </span>
                </span>
              ))}
            </div>
          ) : (
            <span className="v2-agents__ticker-empty">最近のアクティビティはありません。</span>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─────────── Builder redirect ─────────── */

function BuilderRedirect() {
  return (
    <div className="v2-agents__builder-redirect">
      <h3 className="v2-agents__builder-title">エージェント構成はワークフローで管理します</h3>
      <p className="v2-agents__builder-body">
        旧来のノードベース<em>エージェントビルダー</em>は、同じxyflowキャンバスで
        エージェントの委任・自動化・トリガーなどすべての構成グラフを扱う
        ワークフロー室(フェーズ6.4)に統合されつつあります。
      </p>
      <button
        type="button"
        className="v2-agents__builder-cta"
        onClick={() => openRoom("workflows")}
      >
        ワークフローを開く
        <Icon icon={ArrowRight} size="sm" />
      </button>
    </div>
  );
}

/* ─────────── Spawn dialog ─────────── */

function SpawnDialog({
  specialists,
  onClose,
  onSpawn,
}: {
  specialists: SpecialistInfo[];
  onClose: () => void;
  onSpawn: (input: { specialist: string; task: string; context: string }) => Promise<boolean>;
}) {
  const [selectedId, setSelectedId] = useState<string>(
    () => specialists[0]?.id ?? "",
  );
  const [task, setTask] = useState("");
  const [context, setContext] = useState("");
  const [spawning, setSpawning] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Re-pick if the loaded specialist list changes after dialog mount.
  useEffect(() => {
    if (specialists.length === 0) return;
    if (!specialists.some((s) => s.id === selectedId)) {
      setSelectedId(specialists[0]!.id);
    }
  }, [specialists, selectedId]);

  // Move focus into dialog on open.
  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  // Esc closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !spawning) onClose();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [spawning, onClose]);

  const selectedMeta = specialists.find((s) => s.id === selectedId) ?? null;

  const handleSubmit = async () => {
    if (!selectedId) return;
    setSpawning(true);
    await onSpawn({ specialist: selectedId, task, context });
    setSpawning(false);
  };

  return (
    <div
      className="v2-agents__overlay"
      onClick={() => !spawning && onClose()}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="v2-agents-spawn-title"
        className="v2-agents__dialog"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="v2-agents__dialog-head">
          <div>
            <div id="v2-agents-spawn-title" className="v2-agents__dialog-title">
              エージェントを起動
            </div>
            <div className="v2-agents__dialog-subtitle">
              永続的なスペシャリストを作成し、必要ならタスクを割り当てます。
            </div>
          </div>
          <button
            type="button"
            className="v2-agents__dialog-close"
            onClick={onClose}
            disabled={spawning}
            aria-label="閉じる"
          >
            <Icon icon={X} size="sm" />
          </button>
        </div>

        <div className="v2-agents__dialog-body">
          <label className="v2-agents__field">
            <span className="v2-agents__field-label">スペシャリスト</span>
            <div className="v2-agents__specialist-list">
              {specialists.length === 0 ? (
                <span className="v2-agents__empty-line">スペシャリストを読み込み中…</span>
              ) : (
                specialists.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className="v2-agents__specialist-btn"
                    data-active={selectedId === s.id}
                    onClick={() => setSelectedId(s.id)}
                  >
                    {s.name}
                  </button>
                ))
              )}
            </div>
          </label>

          {selectedMeta && (
            <div className="v2-agents__specialist-meta">
              {selectedMeta.description}
              {" · "}権限 {selectedMeta.authority_level} ({specLevelLabel(selectedMeta.authority_level)}) · ツール {selectedMeta.tools.length}
            </div>
          )}

          <label className="v2-agents__field">
            <span className="v2-agents__field-label">タスク</span>
            <textarea
              className="v2-agents__textarea"
              value={task}
              onChange={(e) => setTask(e.target.value)}
              rows={2}
              placeholder="任意。空欄の場合は待機状態で起動します。"
            />
          </label>

          <label className="v2-agents__field">
            <span className="v2-agents__field-label">コンテキスト</span>
            <textarea
              className="v2-agents__textarea"
              value={context}
              onChange={(e) => setContext(e.target.value)}
              rows={2}
              placeholder="任意。タスクの背景情報。"
            />
          </label>
        </div>

        <div className="v2-agents__dialog-foot">
          <button
            type="button"
            className="v2-agents__btn-secondary"
            onClick={onClose}
            disabled={spawning}
          >
            キャンセル
          </button>
          <button
            type="button"
            className="v2-agents__btn-primary"
            onClick={handleSubmit}
            disabled={spawning || !selectedMeta}
          >
            {spawning ? "起動中…" : task.trim() ? "起動して割り当て" : "エージェントを起動"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─────────── helpers ─────────── */

function formatTime(ts: number): string {
  if (!Number.isFinite(ts)) return "";
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "たった今";
  if (min < 60) return `${min}分前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}時間前`;
  const day = Math.floor(hr / 24);
  if (day === 1) return "昨日";
  return `${day}日前`;
}
