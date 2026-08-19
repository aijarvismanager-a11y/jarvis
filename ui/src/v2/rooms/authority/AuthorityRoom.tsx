import React, { useCallback, useEffect, useMemo, useState } from "react";
import { specLevelLabel } from "../agents/specLevel";
import {
  AlertTriangle,
  BarChart3,
  Check,
  GraduationCap,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  Square,
  Trash2,
  X,
  type LucideIcon,
} from "lucide-react";
import { Chip, Icon } from "../../ui";
import { RoomShell } from "../RoomShell";
import { useRoomActions } from "../useRoomActionBus";
import { useRovingTabs } from "../useRovingTabs";
import {
  ACTION_CATEGORIES,
  useAuthorityData,
  type ActionCategory,
  type AuditEntry,
  type AuthorityDecisionType,
  type ContextRule,
  type EmergencyState,
  type LearningSuggestion,
  type PerActionOverride,
} from "./useAuthorityData";
import "./AuthorityRoom.css";

type TabId = "approvals" | "audit" | "grants" | "learning";

const TAB_LABEL: Record<TabId, string> = {
  approvals: "承認",
  audit: "監査",
  grants: "権限付与",
  learning: "学習",
};

const TAB_ICON: Record<TabId, LucideIcon> = {
  approvals: ShieldAlert,
  audit: BarChart3,
  grants: ShieldCheck,
  learning: GraduationCap,
};

type AuditFilter = "all" | AuthorityDecisionType;

const AUDIT_FILTER_LABEL: Record<AuditFilter, string> = {
  all: "すべて",
  allowed: "許可",
  denied: "拒否",
  approval_required: "承認要",
};

const APPROVAL_STATUS_LABEL: Record<"pending" | "approved" | "denied" | "expired" | "executed", string> = {
  pending: "保留中",
  approved: "承認済み",
  denied: "拒否済み",
  expired: "期限切れ",
  executed: "実行済み",
};

const IMPACT_LABEL: Record<"read" | "write" | "external" | "destructive", string> = {
  read: "読み取り",
  write: "書き込み",
  external: "外部",
  destructive: "破壊的",
};

export type RoomBodyMode = "inline" | "expanded";

export function AuthorityRoomBody({ mode }: { mode: RoomBodyMode }) {
  const data = useAuthorityData();
  const [activeTab, setActiveTab] = useState<TabId>("approvals");
  const TAB_KEYS = useMemo(() => Object.keys(TAB_LABEL) as TabId[], []);
  const tabsApi = useRovingTabs<TabId>(TAB_KEYS, activeTab, setActiveTab, "v2-auth");
  const [auditFilter, setAuditFilter] = useState<AuditFilter>("all");
  const [toast, setToast] = useState<{ text: string; tone: "ok" | "warn" } | null>(null);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 4000);
    return () => window.clearTimeout(id);
  }, [toast]);

  const filteredAudit = useMemo(() => {
    if (auditFilter === "all") return data.auditEntries;
    return data.auditEntries.filter((e) => e.authority_decision === auditFilter);
  }, [data.auditEntries, auditFilter]);

  // Phase 6.3.5 — voice room actions for Authority. Emergency commands
  // are intentionally excluded (per the safety constraint locked in
  // Phase 6.6 plan): pause/kill/reset only via the buttons.
  useRoomActions("authority", (action, args) => {
    switch (action) {
      case "switch_tab": {
        const t = String(args.tab);
        if (t === "approvals" || t === "audit" || t === "grants" || t === "learning") {
          setActiveTab(t);
          return true;
        }
        return false;
      }
      case "set_filter": {
        const f = String(args.decision);
        if (f === "all" || f === "allowed" || f === "denied" || f === "approval_required") {
          setAuditFilter(f);
          setActiveTab("audit");
          return true;
        }
        return false;
      }
      case "grant_access":
      case "revoke_access": {
        const cat = String(args.action) as ActionCategory;
        if (!ACTION_CATEGORIES.includes(cat)) return false;
        const allow = action === "grant_access";
        (async () => {
          const r = await data.quickOverride(cat, allow);
          setToast({ text: r.message, tone: r.ok ? "ok" : "warn" });
        })();
        return true;
      }
      default:
        return false;
    }
  });

  return (
    <div className={`v2-auth v2-auth--${mode}`}>
      {/* Always-visible Emergency band */}
      <EmergencyBand
        state={data.status?.emergency_state ?? "normal"}
        onTransition={async (t) => {
          const r = await data.setEmergency(t);
          setToast({ text: r.message, tone: r.ok ? "ok" : "warn" });
        }}
      />

      {/* Stats strip */}
      <div className="v2-auth__stats">
        <StatCard label="保留中" value={data.stats.pending} sub="判断待ち" tone={data.stats.pending > 0 ? "accent" : "neutral"} />
        <StatCard label="デフォルトレベル" value={data.config?.default_level ?? "—"} sub={data.config ? `権限下限 1-10 · ${specLevelLabel(data.config.default_level)}` : "権限下限 1-10"} />
        <StatCard label="許可(直近)" value={data.stats.allowed} sub={`全 ${data.stats.total} 件中`} />
        <StatCard label="拒否(直近)" value={data.stats.denied} sub="直近20件の判断" />
      </div>

      {/* Tabs */}
      {mode === "expanded" && (
        <div
          className="v2-auth__tabs"
          role="tablist"
          aria-label="権限表示"
          ref={tabsApi.tablistRef}
        >
          {TAB_KEYS.map((t) => (
            <button
              key={t}
              type="button"
              className="v2-auth__tab"
              data-active={activeTab === t}
              {...tabsApi.getTabProps(t)}
            >
              <Icon icon={TAB_ICON[t]} size="sm" />
              <span>{TAB_LABEL[t]}</span>
              {t === "approvals" && data.stats.pending > 0 && (
                <span className="v2-auth__tab-badge" data-tone="accent">
                  {data.stats.pending}
                </span>
              )}
              {t === "learning" && data.suggestions.length > 0 && (
                <span className="v2-auth__tab-badge">{data.suggestions.length}</span>
              )}
            </button>
          ))}
          <button
            type="button"
            className="v2-auth__refresh"
            onClick={data.refresh}
            aria-label="更新"
            title="更新"
          >
            <Icon icon={RefreshCw} size="sm" />
          </button>
        </div>
      )}

      {data.error && <div className="v2-auth__error">{data.error}</div>}

      {/* Content */}
      {(mode === "inline" || activeTab === "approvals") && (
        <ApprovalsTab
          pending={data.pendingApprovals}
          history={data.historyApprovals}
          loading={data.loading}
          onApprove={async (id) => {
            const r = await data.approve(id);
            setToast({ text: r.message, tone: r.ok ? "ok" : "warn" });
          }}
          onDeny={async (id) => {
            const r = await data.deny(id);
            setToast({ text: r.message, tone: r.ok ? "ok" : "warn" });
          }}
        />
      )}
      {mode === "expanded" && activeTab === "audit" && (
        <AuditTab
          entries={filteredAudit}
          totalCount={data.auditEntries.length}
          stats={data.auditStats}
          filter={auditFilter}
          onFilterChange={setAuditFilter}
        />
      )}
      {mode === "expanded" && activeTab === "grants" && data.config && (
        <GrantsTab
          config={data.config}
          onUpdate={async (patch) => {
            const r = await data.updateConfig(patch);
            setToast({ text: r.message, tone: r.ok ? "ok" : "warn" });
          }}
          onQuickOverride={async (action, allow) => {
            const r = await data.quickOverride(action, allow);
            setToast({ text: r.message, tone: r.ok ? "ok" : "warn" });
          }}
        />
      )}
      {mode === "expanded" && activeTab === "learning" && data.config && (
        <LearningTab
          enabled={data.config.learning.enabled}
          threshold={data.config.learning.suggest_threshold}
          suggestions={data.suggestions}
          onUpdate={async (patch) => {
            const r = await data.updateConfig({
              learning: { ...data.config!.learning, ...patch },
            });
            setToast({ text: r.message, tone: r.ok ? "ok" : "warn" });
          }}
          onAccept={async (action, tool_name) => {
            const r = await data.acceptSuggestion(action, tool_name);
            setToast({ text: r.message, tone: r.ok ? "ok" : "warn" });
          }}
          onDismiss={async (action, tool_name) => {
            const r = await data.dismissSuggestion(action, tool_name);
            setToast({ text: r.message, tone: r.ok ? "ok" : "warn" });
          }}
        />
      )}

      {toast && (
        <div role="status" aria-live="polite" className="v2-auth__toast" data-tone={toast.tone}>
          {toast.text}
        </div>
      )}
    </div>
  );
}

export function AuthorityRoom() {
  return (
    <RoomShell
      title="権限"
      subtitle="承認 · 監査 · 権限付与 · 学習"
      breadcrumb={["権限"]}
    >
      <AuthorityRoomBody mode="expanded" />
    </RoomShell>
  );
}

/* ─────────── Emergency band ─────────── */

function EmergencyBand({
  state,
  onTransition,
}: {
  state: EmergencyState;
  onTransition: (t: "pause" | "resume" | "kill" | "reset") => void;
}) {
  return (
    <div className="v2-auth__emergency" data-state={state}>
      <div className="v2-auth__emergency-meta">
        <span className="v2-auth__emergency-dot" aria-hidden="true" />
        <span className="v2-auth__emergency-label">
          緊急 · {state === "normal" ? "全システム正常" : state === "paused" ? "実行停止中" : "強制停止済み"}
        </span>
      </div>
      <div className="v2-auth__emergency-actions">
        {state === "normal" && (
          <>
            <button
              type="button"
              className="v2-auth__emergency-btn"
              onClick={() => onTransition("pause")}
            >
              <Icon icon={Pause} size="sm" />
              一時停止
            </button>
            <button
              type="button"
              className="v2-auth__emergency-btn v2-auth__emergency-btn--danger"
              onClick={() => onTransition("kill")}
            >
              <Icon icon={Square} size="sm" />
              強制停止
            </button>
          </>
        )}
        {state === "paused" && (
          <>
            <button
              type="button"
              className="v2-auth__emergency-btn"
              onClick={() => onTransition("resume")}
            >
              <Icon icon={Play} size="sm" />
              再開
            </button>
            <button
              type="button"
              className="v2-auth__emergency-btn v2-auth__emergency-btn--danger"
              onClick={() => onTransition("kill")}
            >
              <Icon icon={Square} size="sm" />
              強制停止
            </button>
          </>
        )}
        {state === "killed" && (
          <button
            type="button"
            className="v2-auth__emergency-btn"
            onClick={() => onTransition("reset")}
          >
            <Icon icon={RotateCcw} size="sm" />
            リセット
          </button>
        )}
      </div>
    </div>
  );
}

/* ─────────── Stat card ─────────── */

function StatCard({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: number | string;
  sub: string;
  tone?: "neutral" | "accent" | "warn";
}) {
  return (
    <div className="v2-auth__stat" data-tone={tone ?? "neutral"}>
      <div className="v2-auth__stat-label">{label}</div>
      <div className="v2-auth__stat-value">{value}</div>
      <div className="v2-auth__stat-sub">{sub}</div>
    </div>
  );
}

/* ─────────── Approvals tab ─────────── */

function ApprovalsTab({
  pending,
  history,
  loading,
  onApprove,
  onDeny,
}: {
  pending: ReturnType<typeof useAuthorityData>["pendingApprovals"];
  history: ReturnType<typeof useAuthorityData>["historyApprovals"];
  loading: boolean;
  onApprove: (id: string) => void;
  onDeny: (id: string) => void;
}) {
  const recentDecisions = history.filter((a) => a.status !== "pending").slice(0, 20);

  return (
    <div className="v2-auth__approvals">
      <section className="v2-auth__section">
        <div className="v2-auth__section-head">
          <h3 className="v2-auth__section-title">保留中</h3>
          <span className="v2-auth__section-count">{pending.length}</span>
        </div>
        {loading && pending.length === 0 ? (
          <div className="v2-auth__empty">読み込み中…</div>
        ) : pending.length === 0 ? (
          <div className="v2-auth__empty">保留中の承認はありません。</div>
        ) : (
          <ul className="v2-auth__pending-list">
            {pending.map((a) => (
              <li key={a.id}>
                <PendingApprovalCard approval={a} onApprove={onApprove} onDeny={onDeny} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="v2-auth__section">
        <div className="v2-auth__section-head">
          <h3 className="v2-auth__section-title">直近の判断</h3>
          <span className="v2-auth__section-count">{recentDecisions.length}</span>
        </div>
        {recentDecisions.length === 0 ? (
          <div className="v2-auth__empty">直近の判断はありません。</div>
        ) : (
          <ul className="v2-auth__history-list">
            {recentDecisions.map((a) => (
              <li key={a.id} className="v2-auth__history-row-wrap">
                <div className="v2-auth__history-row">
                  <span className="v2-auth__history-time">{formatTime(a.created_at)}</span>
                  <span className="v2-auth__history-agent">{a.agent_name}</span>
                  <span className="v2-auth__history-tool">{a.tool_name}</span>
                  <Chip
                    tone={a.status === "approved" || a.status === "executed" ? "ok" : a.status === "denied" ? "accent" : "neutral"}
                    dot
                  >
                    {APPROVAL_STATUS_LABEL[a.status]}
                  </Chip>
                </div>
                {/* Phase 18-A: context/tool_arguments/execution_result were
                    already fetched and typed but never rendered. */}
                {a.context && <div className="v2-auth__history-context">{a.context}</div>}
                {/* Phase 19-B: decided_by/decided_at/executed_at were already
                    fetched and typed but never rendered. */}
                {a.decided_by && (
                  <div className="v2-auth__history-decided">
                    {a.decided_by} が判断
                    {a.decided_at ? `(${formatTime(a.decided_at)})` : ""}
                  </div>
                )}
                {a.status === "executed" && a.executed_at && (
                  <div className="v2-auth__history-executed">
                    {formatTime(a.executed_at)} に実行
                  </div>
                )}
                {a.execution_result && (
                  <div className="v2-auth__history-result">{a.execution_result}</div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function PendingApprovalCard({
  approval,
  onApprove,
  onDeny,
}: {
  approval: ReturnType<typeof useAuthorityData>["pendingApprovals"][number];
  onApprove: (id: string) => void;
  onDeny: (id: string) => void;
}) {
  const tone =
    approval.impact === "destructive"
      ? "accent"
      : approval.impact === "external"
        ? "warn"
        : "neutral";
  // Phase 18-A: tool_arguments is a JSON string of the tool's call params -
  // parse into a compact key:value list rather than dumping raw JSON.
  const argEntries = parseToolArguments(approval.tool_arguments);
  return (
    <article className="v2-auth__pending" data-urgency={approval.urgency} data-tone={tone}>
      <header className="v2-auth__pending-head">
        <div className="v2-auth__pending-meta">
          <Chip tone={tone === "accent" ? "accent" : tone === "warn" ? "warn" : "neutral"} dot>
            {IMPACT_LABEL[approval.impact ?? "write"]}
          </Chip>
          {approval.urgency === "urgent" && (
            <span className="v2-auth__pending-urgent">緊急</span>
          )}
          <span className="v2-auth__pending-time">{formatTime(approval.created_at)}</span>
        </div>
        <span className="v2-auth__pending-agent">{approval.agent_name}</span>
      </header>
      <div className="v2-auth__pending-intent">{approval.intent ?? approval.reason}</div>
      <div className="v2-auth__pending-meta-row">
        <span className="v2-auth__pending-tool">{approval.tool_name}</span>
        <span className="v2-auth__pending-cat">{approval.action_category}</span>
      </div>
      {/* Phase 18-A: tool_arguments/context are already written by the
          server (e.g. repo_path/title/head/base for GitHub actions) but
          were never rendered - a card used to show only the tool name. */}
      {approval.context && <div className="v2-auth__pending-context">{approval.context}</div>}
      {argEntries.length > 0 && (
        <dl className="v2-auth__pending-args">
          {argEntries.map(([key, value]) => (
            <div key={key} className="v2-auth__pending-args-row">
              <dt>{key}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      )}
      <div className="v2-auth__pending-actions">
        <button
          type="button"
          className="v2-auth__btn v2-auth__btn--secondary"
          onClick={() => onDeny(approval.id)}
        >
          <Icon icon={X} size="sm" />
          拒否
        </button>
        <button
          type="button"
          className="v2-auth__btn v2-auth__btn--primary"
          onClick={() => onApprove(approval.id)}
        >
          <Icon icon={Check} size="sm" />
          承認
        </button>
      </div>
    </article>
  );
}

/* ─────────── Audit tab ─────────── */

function AuditTab({
  entries,
  totalCount,
  stats,
  filter,
  onFilterChange,
}: {
  entries: AuditEntry[];
  totalCount: number;
  stats: ReturnType<typeof useAuthorityData>["auditStats"];
  filter: AuditFilter;
  onFilterChange: (f: AuditFilter) => void;
}) {
  return (
    <div className="v2-auth__audit">
      {stats && (
        <div className="v2-auth__audit-stats">
          <StatCard label="合計" value={stats.total} sub="すべての判断" />
          <StatCard label="許可" value={stats.allowed} sub="自動承認" />
          <StatCard label="拒否" value={stats.denied} sub="却下" tone={stats.denied > 0 ? "warn" : "neutral"} />
          <StatCard label="承認要" value={stats.approvalRequired} sub="ユーザー判断" />
        </div>
      )}

      {/* Phase 19-A: byCategory was already fetched/typed but never rendered. */}
      {stats && Object.keys(stats.byCategory).length > 0 && (
        <ul className="v2-auth__audit-bycat">
          {Object.entries(stats.byCategory)
            .sort(([, a], [, b]) => b - a)
            .map(([category, count]) => (
              <li key={category} className="v2-auth__audit-bycat-row">
                <span className="v2-auth__audit-bycat-label">{category}</span>
                <span className="v2-auth__audit-bycat-count">{count}</span>
              </li>
            ))}
        </ul>
      )}

      <div className="v2-auth__filter-row" role="tablist" aria-label="監査エントリを絞り込む">
        {(Object.keys(AUDIT_FILTER_LABEL) as AuditFilter[]).map((f) => (
          <button
            key={f}
            type="button"
            className="v2-auth__filter-btn"
            data-active={filter === f}
            onClick={() => onFilterChange(f)}
          >
            {AUDIT_FILTER_LABEL[f]}
          </button>
        ))}
        <span className="v2-auth__filter-meta">
          {totalCount} 件中 {entries.length} 件
        </span>
      </div>

      {entries.length === 0 ? (
        <div className="v2-auth__empty">現在の絞り込み条件に一致する監査エントリはありません。</div>
      ) : (
        <ul className="v2-auth__audit-list">
          {entries.map((e) => (
            <li key={e.id} className="v2-auth__audit-row" data-decision={e.authority_decision}>
              <span className="v2-auth__audit-time">{formatTime(e.created_at)}</span>
              <Chip
                tone={
                  e.authority_decision === "allowed"
                    ? "ok"
                    : e.authority_decision === "denied"
                      ? "accent"
                      : "warn"
                }
                dot
              >
                {AUDIT_FILTER_LABEL[e.authority_decision]}
              </Chip>
              <span className="v2-auth__audit-agent">{e.agent_name}</span>
              <span className="v2-auth__audit-tool">{e.tool_name}</span>
              <span className="v2-auth__audit-cat">{e.action_category}</span>
              {/* Phase 19-A: channel was already returned by the API but never typed/rendered. */}
              {e.channel && <span className="v2-auth__audit-channel">{e.channel}</span>}
              {/* Phase 20-C: executed was already typed/fetched but never rendered. Shares the
                  last grid cell with execution_time_ms (same wrap technique as 19-C). */}
              <span className="v2-auth__audit-ms-wrap">
                {e.execution_time_ms != null && (
                  <span className="v2-auth__audit-ms">{e.execution_time_ms}ms</span>
                )}
                {e.executed === 0 && <span className="v2-auth__audit-notexec">未実行</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ─────────── Grants tab ─────────── */

function GrantsTab({
  config,
  onUpdate,
  onQuickOverride,
}: {
  config: ReturnType<typeof useAuthorityData>["config"];
  onUpdate: (patch: Partial<NonNullable<ReturnType<typeof useAuthorityData>["config"]>>) => void;
  onQuickOverride: (action: ActionCategory, allow: boolean) => void;
}) {
  if (!config) return <div className="v2-auth__empty">設定を読み込み中…</div>;

  return (
    <div className="v2-auth__grants">
      {/* Default authority level */}
      <section className="v2-auth__section">
        <div className="v2-auth__section-head">
          <h3 className="v2-auth__section-title">デフォルト権限レベル</h3>
          <span className="v2-auth__section-count">{config.default_level} / 10 ({specLevelLabel(config.default_level)})</span>
        </div>
        <input
          type="range"
          min={1}
          max={10}
          step={1}
          value={config.default_level}
          onChange={(e) => onUpdate({ default_level: parseInt(e.target.value, 10) })}
          className="v2-auth__slider"
          data-zone={levelZone(config.default_level)}
          aria-label="デフォルト権限レベル"
        />
        <div className="v2-auth__slider-scale">
          <span>1 慎重</span>
          <span>5 バランス</span>
          <span>10 信頼</span>
        </div>
      </section>

      {/* Governed categories */}
      <section className="v2-auth__section">
        <div className="v2-auth__section-head">
          <h3 className="v2-auth__section-title">管理対象カテゴリ</h3>
          <span className="v2-auth__section-count">{config.governed_categories.length}</span>
        </div>
        <p className="v2-auth__section-desc">
          これらのカテゴリは権限レベルに関わらず常に承認が必要です。
        </p>
        <div className="v2-auth__chip-row">
          {ACTION_CATEGORIES.map((cat) => {
            const active = config.governed_categories.includes(cat);
            return (
              <button
                key={cat}
                type="button"
                className="v2-auth__chip"
                data-active={active}
                onClick={() => {
                  const next = active
                    ? config.governed_categories.filter((c) => c !== cat)
                    : [...config.governed_categories, cat];
                  onUpdate({ governed_categories: next });
                }}
              >
                {cat.replace(/_/g, " ")}
              </button>
            );
          })}
        </div>
      </section>

      {/* Per-action overrides */}
      <section className="v2-auth__section">
        <div className="v2-auth__section-head">
          <h3 className="v2-auth__section-title">上書き設定</h3>
          <span className="v2-auth__section-count">{config.overrides.length}</span>
        </div>
        <p className="v2-auth__section-desc">
          アクションごとの明示的な許可/拒否ルール。ロール指定の上書きはグローバル設定より優先されます。
        </p>
        <OverrideTable
          overrides={config.overrides}
          onRemove={(idx) => {
            const next = config.overrides.filter((_, i) => i !== idx);
            onUpdate({ overrides: next });
          }}
          onQuickOverride={onQuickOverride}
        />
      </section>

      {/* Context rules */}
      <section className="v2-auth__section">
        <div className="v2-auth__section-head">
          <h3 className="v2-auth__section-title">コンテキストルール</h3>
          <span className="v2-auth__section-count">{config.context_rules.length}</span>
        </div>
        <p className="v2-auth__section-desc">
          条件付きルール — 条件が一致したときに発動します(時間帯、特定のツール、常時など)。
        </p>
        <ContextRuleTable
          rules={config.context_rules}
          onRemove={(id) => {
            const next = config.context_rules.filter((r) => r.id !== id);
            onUpdate({ context_rules: next });
          }}
        />
      </section>
    </div>
  );
}

function OverrideTable({
  overrides,
  onRemove,
  onQuickOverride,
}: {
  overrides: PerActionOverride[];
  onRemove: (idx: number) => void;
  onQuickOverride: (action: ActionCategory, allow: boolean) => void;
}) {
  const [pickAction, setPickAction] = useState<ActionCategory>("send_email");

  return (
    <div>
      {overrides.length === 0 ? (
        <div className="v2-auth__empty-line">上書き設定はまだありません。</div>
      ) : (
        <table className="v2-auth__table">
          <thead>
            <tr>
              <th>アクション</th>
              <th>ロール</th>
              <th>効果</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {overrides.map((o, idx) => (
              <tr key={`${o.action}-${o.role_id ?? "global"}-${idx}`}>
                <td>{o.action.replace(/_/g, " ")}</td>
                <td>{o.role_id ?? <em>グローバル</em>}</td>
                <td>
                  <Chip
                    tone={
                      !o.allowed
                        ? "accent"
                        : o.requires_approval
                          ? "warn"
                          : "ok"
                    }
                    dot
                  >
                    {!o.allowed ? "拒否" : o.requires_approval ? "承認要" : "許可"}
                  </Chip>
                </td>
                <td>
                  <button
                    type="button"
                    className="v2-auth__icon-btn"
                    aria-label="上書き設定を削除"
                    onClick={() => onRemove(idx)}
                  >
                    <Icon icon={Trash2} size="sm" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="v2-auth__add-row">
        <select
          className="v2-auth__select"
          value={pickAction}
          onChange={(e) => setPickAction(e.target.value as ActionCategory)}
        >
          {ACTION_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c.replace(/_/g, " ")}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="v2-auth__btn v2-auth__btn--secondary"
          onClick={() => onQuickOverride(pickAction, false)}
        >
          拒否
        </button>
        <button
          type="button"
          className="v2-auth__btn v2-auth__btn--primary"
          onClick={() => onQuickOverride(pickAction, true)}
        >
          許可
        </button>
      </div>
    </div>
  );
}

function ContextRuleTable({
  rules,
  onRemove,
}: {
  rules: ContextRule[];
  onRemove: (id: string) => void;
}) {
  if (rules.length === 0) {
    return <div className="v2-auth__empty-line">コンテキストルールはまだありません。</div>;
  }
  return (
    <table className="v2-auth__table">
      <thead>
        <tr>
          <th>アクション</th>
          <th>条件</th>
          <th>効果</th>
          <th>説明</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {rules.map((r) => (
          <tr key={r.id}>
            <td>{r.action.replace(/_/g, " ")}</td>
            <td>{r.condition.replace(/_/g, " ")}</td>
            <td>
              <Chip
                tone={r.effect === "deny" ? "accent" : r.effect === "require_approval" ? "warn" : "ok"}
                dot
              >
                {r.effect === "deny" ? "拒否" : r.effect === "require_approval" ? "承認要" : "許可"}
              </Chip>
            </td>
            <td>{r.description}</td>
            <td>
              <button
                type="button"
                className="v2-auth__icon-btn"
                aria-label="ルールを削除"
                onClick={() => onRemove(r.id)}
              >
                <Icon icon={Trash2} size="sm" />
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* ─────────── Learning tab ─────────── */

function LearningTab({
  enabled,
  threshold,
  suggestions,
  onUpdate,
  onAccept,
  onDismiss,
}: {
  enabled: boolean;
  threshold: number;
  suggestions: LearningSuggestion[];
  onUpdate: (patch: { enabled?: boolean; suggest_threshold?: number }) => void;
  onAccept: (action: ActionCategory, tool_name: string) => void;
  onDismiss: (action: ActionCategory, tool_name: string) => void;
}) {
  return (
    <div className="v2-auth__learning">
      <section className="v2-auth__section">
        <div className="v2-auth__section-head">
          <h3 className="v2-auth__section-title">学習</h3>
          <button
            type="button"
            className="v2-auth__chip"
            data-active={enabled}
            onClick={() => onUpdate({ enabled: !enabled })}
          >
            {enabled ? "有効" : "無効"}
          </button>
        </div>
        <p className="v2-auth__section-desc">
          同じアクションを繰り返し承認していると、自動承認の上書きを提案します。
        </p>

        <div className="v2-auth__threshold-row">
          <label className="v2-auth__label">
            {threshold}回連続で承認したら提案
          </label>
          <input
            type="range"
            min={1}
            max={50}
            step={1}
            value={threshold}
            onChange={(e) => onUpdate({ suggest_threshold: parseInt(e.target.value, 10) })}
            className="v2-auth__slider"
            disabled={!enabled}
            aria-label="提案しきい値"
          />
        </div>
      </section>

      <section className="v2-auth__section">
        <div className="v2-auth__section-head">
          <h3 className="v2-auth__section-title">提案</h3>
          <span className="v2-auth__section-count">{suggestions.length}</span>
        </div>
        {suggestions.length === 0 ? (
          <div className="v2-auth__empty">まだ提案はありません — 承認を続けるとパターンが見つかります。</div>
        ) : (
          <ul className="v2-auth__suggestions">
            {suggestions.map((s) => (
              <li key={`${s.actionCategory}-${s.toolName}`} className="v2-auth__suggestion">
                <div className="v2-auth__suggestion-meta">
                  <Chip tone="ok" dot>{s.consecutiveApprovals}回承認</Chip>
                  <span className="v2-auth__suggestion-tool">{s.toolName}</span>
                </div>
                <div className="v2-auth__suggestion-text">
                  <code>{s.toolName}</code> 経由で呼ばれたときの<strong>{s.actionCategory.replace(/_/g, " ")}</strong>を自動許可しますか?
                </div>
                <div className="v2-auth__suggestion-actions">
                  <button
                    type="button"
                    className="v2-auth__btn v2-auth__btn--secondary"
                    onClick={() => onDismiss(s.actionCategory, s.toolName)}
                  >
                    却下
                  </button>
                  <button
                    type="button"
                    className="v2-auth__btn v2-auth__btn--primary"
                    onClick={() => onAccept(s.actionCategory, s.toolName)}
                  >
                    承認
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/* ─────────── helpers ─────────── */

function formatTime(ts: number): string {
  if (!Number.isFinite(ts)) return "";
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/**
 * Phase 18-A: `ApprovalRequest.tool_arguments` is stored as a JSON string
 * (see `ApprovalManager.createRequest`). Parses it into a short, stable
 * list of primitive key:value pairs for display - skips nested
 * objects/arrays rather than trying to render them, and fails soft on
 * malformed/empty input.
 */
function parseToolArguments(raw: string | null): Array<[string, string]> {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
    return Object.entries(parsed as Record<string, unknown>)
      .filter(([, v]) => v !== null && v !== undefined && typeof v !== "object")
      .map(([k, v]) => [k, String(v)]);
  } catch {
    return [];
  }
}

function levelZone(level: number): "ok" | "neutral" | "warn" | "accent" {
  if (level <= 3) return "ok";
  if (level <= 6) return "neutral";
  if (level <= 8) return "warn";
  return "accent";
}

// silence unused-import lints
void AlertTriangle;
