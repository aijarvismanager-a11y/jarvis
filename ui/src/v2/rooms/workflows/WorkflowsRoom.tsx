/**
 * Workflows room (Phase 4 stage 1).
 *
 * Shows the user's saved workflows with status + last-run summary, and a
 * detail panel for the selected flow with its run history. Runs can be
 * triggered manually; flows can be enabled/disabled, published, or deleted.
 *
 * Limitations of this stage (intentional):
 *   - No visual builder. Flow creation happens via the API or assistant.
 *   - No NL-create chip. That lands when the assistant tools for workflows
 *     ship in Phase 5.
 *   - Step outputs are rendered as JSON. A pretty per-piece renderer is
 *     deferred until pieces have stable output shapes.
 */

import React, { useEffect, useMemo, useState } from "react";
import { confirmDialog } from "../../ui/ConfirmDialog";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
  X,
  XCircle,
} from "lucide-react";
import { WorkflowEditor } from "./WorkflowEditor";
import { Button, Chip, Icon } from "../../ui";
import { RoomShell } from "../RoomShell";
import { useRoomActions } from "../useRoomActionBus";
import {
  useWorkflowsData,
  type Flow,
  type FlowRun,
  type FlowRunStatus,
  type FlowStatus,
} from "./useWorkflowsData";
import "./WorkflowsRoom.css";
import { ConnectionsPanel } from "./ConnectionsPanel";
import { LibraryPanel } from "./LibraryPanel";

const STATUS_TONE: Record<FlowStatus, "ok" | "neutral"> = {
  ENABLED: "ok",
  DISABLED: "neutral",
};

const RUN_STATUS_TONE: Record<FlowRunStatus, "ok" | "neutral" | "warn" | "accent"> = {
  QUEUED: "neutral",
  RUNNING: "warn",
  SUCCEEDED: "ok",
  FAILED: "accent",
  // PAUSED is awaiting an external signal (a hit on the resume webhook).
  // We render with the `warn` tone instead of neutral so it visually stands
  // out from idle-but-not-running runs.
  PAUSED: "warn",
  TIMEOUT: "accent",
  INTERNAL_ERROR: "accent",
  QUOTA_EXCEEDED: "accent",
  STOPPED: "neutral",
  MEMORY_LIMIT_EXCEEDED: "accent",
  SCHEDULE_FAILURE: "accent",
};

const RUN_STATUS_LABEL: Record<FlowRunStatus, string> = {
  QUEUED: "待機中",
  RUNNING: "実行中",
  SUCCEEDED: "成功",
  FAILED: "失敗",
  PAUSED: "一時停止",
  TIMEOUT: "タイムアウト",
  INTERNAL_ERROR: "内部エラー",
  QUOTA_EXCEEDED: "上限超過",
  STOPPED: "停止",
  MEMORY_LIMIT_EXCEEDED: "メモリ上限超過",
  SCHEDULE_FAILURE: "スケジュール失敗",
};

const TERMINAL_STATUSES = new Set<FlowRunStatus>([
  "SUCCEEDED",
  "FAILED",
  "STOPPED",
  "TIMEOUT",
  "INTERNAL_ERROR",
  "QUOTA_EXCEEDED",
  "MEMORY_LIMIT_EXCEEDED",
  "SCHEDULE_FAILURE",
]);

type RoomTab = "flows" | "connections" | "library";

export function WorkflowsRoomBody(): React.ReactElement {
  const data = useWorkflowsData();
  const [actionMessage, setActionMessage] = useState<{ tone: "ok" | "warn"; text: string } | null>(null);
  const [tab, setTab] = useState<RoomTab>("flows");

  const handleAction = async (label: string, fn: () => Promise<{ ok: boolean; message: string }>): Promise<void> => {
    const result = await fn();
    setActionMessage({
      tone: result.ok ? "ok" : "warn",
      text: result.ok ? `${label}: ${result.message}` : `${label}に失敗しました: ${result.message}`,
    });
    window.setTimeout(() => setActionMessage(null), 3000);
  };

  /**
   * Create a new flow + jump straight into the visual editor. Rename happens
   * inside the editor; we don't prompt for a name up front because the user's
   * intent at this point is to start building, not to bikeshed a label.
   */
  const handleCreate = async (): Promise<void> => {
    const result = await data.createFlow();
    if (result.ok && result.flowId) {
      data.setEditingFlowId(result.flowId);
    } else {
      setActionMessage({ tone: "warn", text: `作成に失敗しました: ${result.message}` });
      window.setTimeout(() => setActionMessage(null), 3000);
    }
  };

  // Voice / text-classifier `create_from_nl` room action. With an empty
  // prompt this is "just give me a new blank workflow" -- same path as the
  // header button. With a non-empty prompt the user described what the
  // flow should do; we can't compose from here (no LLM client in the UI),
  // so we still open a fresh draft and surface a hint pointing them at the
  // chat agent (which calls `manage_workflow:compose`). Text chat is
  // already routed there directly by ws-service.
  useRoomActions("workflows", (action, args) => {
    if (action !== "create_from_nl") return false;
    const prompt = typeof args?.prompt === "string" ? args.prompt.trim() : "";
    void (async () => {
      await handleCreate();
      if (prompt) {
        setActionMessage({
          tone: "ok",
          text: `空のワークフローを作成しました。Jarvisに「${prompt}」を組み立ててもらうには、チャットで「${prompt}ワークフローを作って」と依頼してください。`,
        });
        window.setTimeout(() => setActionMessage(null), 6000);
      }
    })();
    return true;
  });

  return (
    <div className="wf-room">
      {data.editingFlowId ? (
        <WorkflowEditor
          flowId={data.editingFlowId}
          onClose={() => {
            data.setEditingFlowId(null);
            // The editor may have renamed the flow or otherwise mutated
            // the version; force an immediate refresh so the list reflects
            // those edits without waiting for the polling tick.
            void data.refresh();
          }}
        />
      ) : null}
      <header className="wf-room__header">
        <div className="wf-room__tabs">
          <button
            type="button"
            className={`wf-room__tab ${tab === "flows" ? "wf-room__tab--active" : ""}`}
            onClick={() => setTab("flows")}
          >
            ワークフロー
          </button>
          <button
            type="button"
            className={`wf-room__tab ${tab === "connections" ? "wf-room__tab--active" : ""}`}
            onClick={() => setTab("connections")}
          >
            接続
          </button>
          <button
            type="button"
            className={`wf-room__tab ${tab === "library" ? "wf-room__tab--active" : ""}`}
            onClick={() => setTab("library")}
          >
            ライブラリ
          </button>
        </div>
        <div className="wf-room__actions">
          {tab === "flows" ? (
            <>
              <span className="wf-room__count">
                {data.loading ? "…" : `${data.flows.length}件のワークフロー`}
                {data.error ? ` · ${data.error}` : null}
              </span>
              <Button variant="ghost" size="sm" onClick={() => void data.refresh()} title="更新">
                <Icon icon={RefreshCw} size={14} /> 更新
              </Button>
              <Button variant="primary" size="sm" onClick={() => void handleCreate()} title="新規ワークフロー">
                <Icon icon={Plus} size={14} /> 新規ワークフロー
              </Button>
            </>
          ) : null}
        </div>
      </header>

      {actionMessage ? (
        <div className={`wf-toast wf-toast--${actionMessage.tone}`}>{actionMessage.text}</div>
      ) : null}

      {tab === "connections" ? <ConnectionsPanel /> : null}
      {tab === "library" ? <LibraryPanel /> : null}

      {tab === "flows" ? (
      <div className="wf-room__layout">
        <section className="wf-room__list" aria-label="ワークフロー一覧">
          {data.flows.length === 0 && !data.loading ? (
            <EmptyState onCreate={() => void handleCreate()} />
          ) : (
            <ul className="wf-list">
              {data.flows.map((flow) => (
                <FlowRow
                  key={flow.id}
                  flow={flow}
                  selected={data.selectedFlowId === flow.id}
                  triggerWarning={data.triggerWarnings[flow.id]?.warning}
                  onSelect={() => data.setSelectedFlowId(flow.id)}
                  onEdit={() => data.setEditingFlowId(flow.id)}
                  onRun={() => handleAction("実行", () => data.runFlow(flow.id))}
                  onToggle={() =>
                    handleAction(
                      flow.status === "ENABLED" ? "無効化" : "有効化",
                      () => data.setStatus(flow.id, flow.status === "ENABLED" ? "DISABLED" : "ENABLED"),
                    )
                  }
                  onPublish={() => handleAction("公開", () => data.publishFlow(flow.id))}
                  onDelete={async () => {
                    // Spell out what disappears: not just the flow row but
                    // every draft on it (including per-step sample data the
                    // user invested time configuring for test-from-here).
                    // Mentioning sample data explicitly catches the case where
                    // a user has been iterating in the editor but hasn't
                    // realized a flow delete wipes the whole version chain.
                    const hasDraftOnly = !flow.publishedVersionId;
                    const msg = hasDraftOnly
                      ? `「${flow.displayName ?? flow.id}」を削除しますか?\n\nこのフローには公開バージョンがありません -- 下書き(各ステップのサンプルデータを含む)は完全に失われます。`
                      : `「${flow.displayName ?? flow.id}」を削除しますか?\n\n公開バージョンと下書き(各ステップのサンプルデータを含む)はすべて完全に失われます。`;
                    if (await confirmDialog(msg)) {
                      void handleAction("削除", () => data.deleteFlow(flow.id));
                    }
                  }}
                />
              ))}
            </ul>
          )}
        </section>

        <section className="wf-room__detail" aria-label="選択中のフロー詳細">
          {data.selectedFlow ? (
            <FlowDetail
              flow={data.selectedFlow}
              runs={data.selectedRuns}
              onRefreshRuns={() => void data.refreshRuns(data.selectedFlow!.id)}
              onCancelRun={(runId) => handleAction("キャンセル", () => data.cancelRun(runId))}
              onClose={() => data.setSelectedFlowId(null)}
            />
          ) : (
            <DetailPlaceholder />
          )}
        </section>
      </div>
      ) : null}
    </div>
  );
}

export function WorkflowsRoom(): React.ReactElement {
  return (
    <RoomShell title="ワークフロー" subtitle="保存済みの自動化 · 実行履歴 · ステータス" breadcrumb={["ワークフロー"]}>
      <WorkflowsRoomBody />
    </RoomShell>
  );
}

/* --------------------------------------------------------------------- rows */

interface FlowRowProps {
  flow: Flow;
  selected: boolean;
  /** Set when TriggerManager reported a partial-state warning for this flow. */
  triggerWarning?: string;
  onSelect: () => void;
  onEdit: () => void;
  onRun: () => void;
  onToggle: () => void;
  onPublish: () => void;
  onDelete: () => void;
}

function FlowRow({ flow, selected, triggerWarning, onSelect, onEdit, onRun, onToggle, onPublish, onDelete }: FlowRowProps): React.ReactElement {
  const stop = (e: React.MouseEvent): void => e.stopPropagation();
  return (
    <li
      className={`wf-list__row ${selected ? "wf-list__row--selected" : ""}`}
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
    >
      <div className="wf-list__main">
        <div className="wf-list__title">{flow.displayName ?? flow.id}</div>
        <div className="wf-list__meta">
          <Chip tone={STATUS_TONE[flow.status]}>{flow.status === "ENABLED" ? "有効" : "無効"}</Chip>
          {flow.publishedVersionId ? (
            <Chip tone="ok" dot={false}>公開済み</Chip>
          ) : (
            <Chip tone="warn" dot={false}>下書きのみ</Chip>
          )}
          {triggerWarning ? (
            // Click toggles an expanded detail below the meta row. Default
            // collapsed state shows a 50-char preview; expanded shows the
            // full message inline. Avoids the slow native tooltip + lets
            // long messages wrap cleanly.
            <TriggerWarningChip text={triggerWarning} />
          ) : null}
          <span className="wf-list__hint">更新: {fmtRelative(flow.updated)}</span>
        </div>
      </div>
      <div className="wf-list__buttons" onClick={stop}>
        <Button variant="ghost" size="sm" onClick={onEdit} title="ビジュアルエディタを開く">
          <Icon icon={Pencil} size={14} /> 編集
        </Button>
        <Button variant="primary" size="sm" onClick={onRun} title="今すぐ実行">
          <Icon icon={Play} size={14} /> 実行
        </Button>
        <Button variant="ghost" size="sm" onClick={onToggle} title={flow.status === "ENABLED" ? "無効化" : "有効化"}>
          {flow.status === "ENABLED" ? <Icon icon={Pause} size={14} /> : <Icon icon={Play} size={14} />}
        </Button>
        {!flow.publishedVersionId ? (
          <Button variant="ghost" size="sm" onClick={onPublish} title="最新の下書きを公開">
            <Icon icon={Upload} size={14} />
          </Button>
        ) : null}
        <Button variant="danger" size="sm" onClick={onDelete} title="削除">
          <Icon icon={Trash2} size={14} />
        </Button>
      </div>
    </li>
  );
}

/**
 * Inline-expanding trigger warning. Replaces the native `title` tooltip
 * (slow appearance, platform-styled, hard to read with long warnings).
 * Collapsed: warn-toned chip with "! <50-char preview>". Click expands to
 * a wrapping detail row below the chip. Click again collapses.
 *
 * `stopPropagation` is necessary because the parent flow row uses
 * `onClick` to select the flow -- without it, expanding the warning would
 * also select the row.
 */
function TriggerWarningChip({ text }: { text: string }): React.ReactElement {
  const [expanded, setExpanded] = useState(false);
  const preview = text.length > 50 ? text.slice(0, 47) + "..." : text;
  return (
    <span className="wf-list__warning-wrap">
      <Chip
        tone="warn"
        dot={false}
        onClick={(e: React.MouseEvent) => {
          e.stopPropagation();
          setExpanded((v) => !v);
        }}
      >
        ! {preview}
      </Chip>
      {expanded ? (
        <span className="wf-list__warning-full" onClick={(e) => e.stopPropagation()}>
          {text}
        </span>
      ) : null}
    </span>
  );
}

/* ------------------------------------------------------------------ detail */

interface FlowDetailProps {
  flow: Flow;
  runs: FlowRun[];
  onRefreshRuns: () => void;
  onCancelRun: (runId: string) => void;
  onClose: () => void;
}

function FlowDetail({ flow, runs, onRefreshRuns, onCancelRun, onClose }: FlowDetailProps): React.ReactElement {
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const succeeded = useMemo(() => runs.filter((r) => r.status === "SUCCEEDED").length, [runs]);
  const failed = useMemo(() => runs.filter((r) => r.status === "FAILED" || r.status === "INTERNAL_ERROR").length, [runs]);
  return (
    <div className="wf-detail">
      <header className="wf-detail__header">
        <div className="wf-detail__title">
          <h3>{flow.displayName ?? flow.id}</h3>
          <p>
            <code>{flow.id}</code>
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose} aria-label="詳細を閉じる">
          <Icon icon={X} size={14} />
        </Button>
      </header>

      <div className="wf-detail__stats">
        <Stat label="実行" value={String(runs.length)} />
        <Stat label="成功" value={String(succeeded)} tone="ok" />
        <Stat label="失敗" value={String(failed)} tone={failed > 0 ? "accent" : "neutral"} />
      </div>

      <div className="wf-detail__runs-header">
        <h4>実行履歴</h4>
        <Button variant="ghost" size="sm" onClick={onRefreshRuns}>
          <Icon icon={RefreshCw} size={12} />
        </Button>
      </div>

      {runs.length === 0 ? (
        <p className="wf-detail__empty">まだ実行履歴がありません。フローの「実行」を押して実行してください。</p>
      ) : (
        <ul className="wf-runs">
          {runs.map((run) => (
            <RunRow
              key={run.id}
              run={run}
              expanded={expandedRunId === run.id}
              onToggle={() => setExpandedRunId(expandedRunId === run.id ? null : run.id)}
              onCancel={() => onCancelRun(run.id)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

/* --------------------------------------------------------------------- run */

interface RunRowProps {
  run: FlowRun;
  expanded: boolean;
  onToggle: () => void;
  onCancel: () => void;
}

function RunRow({ run, expanded, onToggle, onCancel }: RunRowProps): React.ReactElement {
  const isTerminal = TERMINAL_STATUSES.has(run.status);
  const duration = run.startTime && run.finishTime ? `${(run.finishTime - run.startTime) / 1000}s` : "—";
  return (
    <li className="wf-runs__row">
      <button type="button" className="wf-runs__head" onClick={onToggle}>
        <div className="wf-runs__head-left">
          <RunStatusIcon status={run.status} />
          <Chip tone={RUN_STATUS_TONE[run.status]} dot={false}>{RUN_STATUS_LABEL[run.status]}</Chip>
          {run.failedStep ? <span className="wf-runs__failed-step">@ {run.failedStep.displayName}</span> : null}
        </div>
        <div className="wf-runs__head-right">
          <span className="wf-runs__time">{run.startTime ? fmtClock(run.startTime) : "—"}</span>
          <span className="wf-runs__duration">{duration}</span>
        </div>
      </button>
      {expanded ? (
        <div className="wf-runs__body">
          <dl className="wf-runs__kv">
            <dt>実行ID</dt>
            <dd><code>{run.id}</code></dd>
            <dt>ステップ数</dt>
            <dd>{run.stepsCount ?? 0}</dd>
            <dt>実行トリガー</dt>
            <dd>{run.triggeredBy ?? "手動"}</dd>
          </dl>
          {run.status === "PAUSED" ? <PausedRunCallout runId={run.id} /> : null}
          {run.steps && Object.keys(run.steps).length > 0 ? (
            <details className="wf-runs__steps">
              <summary>ステップ出力JSON</summary>
              <pre>{JSON.stringify(run.steps, null, 2)}</pre>
            </details>
          ) : null}
          {!isTerminal ? (
            <Button variant="danger" size="sm" onClick={onCancel}>
              <Icon icon={X} size={12} /> 実行をキャンセル
            </Button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function RunStatusIcon({ status }: { status: FlowRunStatus }): React.ReactElement {
  if (status === "SUCCEEDED") return <Icon icon={CheckCircle2} size={14} />;
  if (status === "FAILED" || status === "INTERNAL_ERROR" || status === "TIMEOUT") return <Icon icon={XCircle} size={14} />;
  if (status === "RUNNING" || status === "QUEUED") return <Icon icon={Clock} size={14} />;
  return <Icon icon={AlertTriangle} size={14} />;
}

/**
 * Paused-run callout: fetches active waitpoints for this run and renders the
 * resume URL(s) so the user can copy/paste into curl or hit from a webhook
 * sender. Loads on mount; no re-fetch (the panel is short-lived per
 * expand). Falls back to a generic message if the run has no active
 * waitpoint -- which can happen briefly while the engine is between
 * uploadRunLog calls, or if the run was paused via a non-webhook path.
 */
function PausedRunCallout({ runId }: { runId: string }): React.ReactElement {
  const [waitpoints, setWaitpoints] = useState<
    Array<{ id: string; stepName: string; type: string; resumeUrl: string }> | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const r = await fetch(`/api/workflow-runs/${runId}/waitpoints`);
        if (!r.ok) {
          setError(`HTTPエラー ${r.status}`);
          return;
        }
        const body = (await r.json()) as {
          waitpoints: Array<{ id: string; stepName: string; type: string; resumeUrl: string }>;
        };
        if (!cancelled) setWaitpoints(body.waitpoints);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [runId]);
  return (
    <div className="wf-runs__paused">
      <strong>一時停止中:</strong> 外部シグナルを待機しています。{" "}
      {error ? (
        <span className="wf-runs__paused-err">待機ポイントを読み込めませんでした: {error}</span>
      ) : waitpoints === null ? (
        <span>待機ポイントを読み込み中…</span>
      ) : waitpoints.length === 0 ? (
        <span>
          この実行にはアクティブな待機ポイントがありません -- Webhook以外の一時停止
          (TIMER、MANUAL)で止まっているか、状態遷移中の可能性があります。
        </span>
      ) : (
        <ul className="wf-runs__paused-list">
          {waitpoints.map((wp) => (
            <li key={wp.id}>
              <span className="wf-runs__paused-step">ステップ <code>{wp.stepName}</code></span>{" "}
              ({wp.type}) -- 再開するには任意のJSONボディを{" "}
              <code>{wp.resumeUrl}</code> にPOSTしてください。
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ------------------------------------------------------------- placeholders */

function EmptyState({ onCreate }: { onCreate: () => void }): React.ReactElement {
  return (
    <div className="wf-empty">
      <p>まだワークフローがありません。</p>
      <p className="wf-empty__hint">
        空のキャンバスから始めて、少しずつステップを追加していきましょう。
      </p>
      <Button variant="primary" size="sm" onClick={onCreate}>
        <Icon icon={Plus} size={14} /> 新規ワークフロー
      </Button>
    </div>
  );
}

function DetailPlaceholder(): React.ReactElement {
  return (
    <div className="wf-detail-placeholder">
      <p>ワークフローを選択すると実行履歴が表示されます。</p>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "ok" | "neutral" | "accent" }): React.ReactElement {
  return (
    <div className={`wf-stat wf-stat--${tone ?? "neutral"}`}>
      <div className="wf-stat__value">{value}</div>
      <div className="wf-stat__label">{label}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ format */

function fmtRelative(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 60_000) return "たった今";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}分前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}時間前`;
  return `${Math.floor(diff / 86_400_000)}日前`;
}

function fmtClock(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
