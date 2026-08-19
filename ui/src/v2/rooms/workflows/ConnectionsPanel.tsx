/**
 * Connections panel: list `app_connection` rows + registered Jarvis sources,
 * add / delete connections. Renders inline below the workflows list when the
 * "Connections" tab is active.
 *
 * Secrets stay server-side (the API never returns `value`); this panel only
 * shows metadata + accepts new values via the add form.
 */

import React, { useState } from "react";
import { confirmDialog } from "../../ui/ConfirmDialog";
import { Button, Chip, Icon } from "../../ui";
import { RefreshCw, Trash2, Plus, KeyRound } from "lucide-react";
import {
  useConnections,
  type AppConnectionType,
  type ConnectionMeta,
} from "./useConnections";

export function ConnectionsPanel(): React.ReactElement {
  const conn = useConnections();
  const [showForm, setShowForm] = useState(false);
  const [toast, setToast] = useState<{ tone: "ok" | "warn"; text: string } | null>(null);

  const flash = (tone: "ok" | "warn", text: string): void => {
    setToast({ tone, text });
    window.setTimeout(() => setToast(null), 3000);
  };

  return (
    <div className="wf-conn">
      <header className="wf-conn__header">
        <div>
          <h3 className="wf-conn__title">ピース接続</h3>
          <p className="wf-conn__subtitle">
            {conn.loading
              ? "読み込み中…"
              : `保存済み${conn.connections.length}件 · 登録済みJarvisソース${conn.jarvisSources.length}件`}
            {conn.error ? ` · ${conn.error}` : null}
          </p>
        </div>
        <div className="wf-conn__actions">
          <Button variant="ghost" size="sm" onClick={() => void conn.refresh()} title="更新">
            <Icon icon={RefreshCw} size={14} /> 更新
          </Button>
          <Button variant="primary" size="sm" onClick={() => setShowForm((s) => !s)}>
            <Icon icon={Plus} size={14} /> {showForm ? "キャンセル" : "追加"}
          </Button>
        </div>
      </header>

      {toast ? <div className={`wf-toast wf-toast--${toast.tone}`}>{toast.text}</div> : null}

      {conn.jarvisSources.length > 0 ? (
        <div className="wf-conn__sources">
          <span className="wf-conn__sources-label">再利用可能なJarvis認証情報:</span>
          {conn.jarvisSources.map((s) => (
            <Chip key={s.id} tone="ok">
              <code>jarvis:{s.id}</code>
            </Chip>
          ))}
          <span className="wf-conn__sources-help">
            -- ピースはこれらの外部IDを、保存済み行なしで認証フィールドに直接使用できます。
          </span>
        </div>
      ) : null}

      {showForm ? (
        <AddConnectionForm
          onSubmit={async (input) => {
            const r = await conn.create(input);
            flash(r.ok ? "ok" : "warn", r.ok ? `接続「${input.displayName}」を追加しました` : `追加に失敗しました: ${r.message}`);
            if (r.ok) setShowForm(false);
          }}
        />
      ) : null}

      {conn.connections.length === 0 && !conn.loading ? (
        <div className="wf-conn__empty">
          接続が保存されていません。「追加」からピース用のOAuthトークン/APIキーを設定してください。
        </div>
      ) : (
        <ul className="wf-conn__list">
          {conn.connections.map((c) => (
            <ConnectionRow
              key={c.id}
              connection={c}
              onDelete={async () => {
                if (!await confirmDialog(`接続「${c.displayName}」を削除しますか? シークレットは完全に削除されます。`)) return;
                const r = await conn.remove(c.id);
                flash(r.ok ? "ok" : "warn", r.ok ? `「${c.displayName}」を削除しました` : `削除に失敗しました: ${r.message}`);
              }}
              onUpdate={async (patch) => {
                const r = await conn.update(c.id, patch);
                flash(
                  r.ok ? "ok" : "warn",
                  r.ok ? `「${c.displayName}」を更新しました` : `更新に失敗しました: ${r.message}`,
                );
                return r.ok;
              }}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function ConnectionRow({
  connection,
  onDelete,
  onUpdate,
}: {
  connection: ConnectionMeta;
  onDelete: () => void;
  onUpdate: (patch: {
    displayName?: string;
    value?: Record<string, unknown>;
    status?: "ACTIVE" | "MISSING" | "ERROR";
  }) => Promise<boolean>;
}): React.ReactElement {
  const [editing, setEditing] = useState(false);
  return (
    <li className="wf-conn__row">
      <div className="wf-conn__row-summary">
        <div className="wf-conn__row-main">
          <span className="wf-conn__row-name">{connection.displayName}</span>
          <Chip tone="neutral">{connection.type}</Chip>
          <Chip tone={connection.status === "ACTIVE" ? "ok" : "warn"}>{connection.status}</Chip>
          <code className="wf-conn__row-extid">{connection.externalId}</code>
        </div>
        <div className="wf-conn__row-meta">
          <span>ピース: <code>{connection.pieceName}</code></span>
          <span>更新日時: {new Date(connection.updated).toLocaleString()}</span>
        </div>
        <div className="wf-conn__row-actions">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setEditing((e) => !e)}
            title="シークレットをローテート / メタデータを編集"
          >
            <Icon icon={KeyRound} size={12} /> {editing ? "キャンセル" : "ローテート"}
          </Button>
          <Button variant="danger" size="sm" onClick={onDelete} title="接続を削除">
            <Icon icon={Trash2} size={12} /> 削除
          </Button>
        </div>
      </div>
      {editing ? (
        <EditConnectionForm
          connection={connection}
          onSubmit={async (patch) => {
            const ok = await onUpdate(patch);
            if (ok) setEditing(false);
          }}
        />
      ) : null}
    </li>
  );
}

function EditConnectionForm({
  connection,
  onSubmit,
}: {
  connection: ConnectionMeta;
  onSubmit: (patch: {
    displayName?: string;
    value?: Record<string, unknown>;
    status?: "ACTIVE" | "MISSING" | "ERROR";
  }) => Promise<void>;
}): React.ReactElement {
  const [displayName, setDisplayName] = useState<string>(connection.displayName);
  const [status, setStatus] = useState<ConnectionMeta["status"]>(connection.status);
  const [valueText, setValueText] = useState<string>("");
  const [parseError, setParseError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (): Promise<void> => {
    const patch: {
      displayName?: string;
      value?: Record<string, unknown>;
      status?: ConnectionMeta["status"];
    } = {};
    if (displayName.trim() && displayName.trim() !== connection.displayName) {
      patch.displayName = displayName.trim();
    }
    if (status !== connection.status) {
      patch.status = status;
    }
    if (valueText.trim().length > 0) {
      try {
        const parsed = JSON.parse(valueText);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new Error("value must be a JSON object");
        }
        patch.value = parsed as Record<string, unknown>;
      } catch (e) {
        setParseError((e as Error).message);
        return;
      }
    }
    setParseError(null);
    if (Object.keys(patch).length === 0) {
      setParseError("更新する内容がありません");
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit(patch);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="wf-conn__form wf-conn__form--inline">
      <div className="wf-conn__form-row">
        <label>
          表示名
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="空欄で現在の値を維持"
          />
        </label>
        <label>
          ステータス
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as ConnectionMeta["status"])}
          >
            <option value="ACTIVE">ACTIVE</option>
            <option value="MISSING">MISSING</option>
            <option value="ERROR">ERROR</option>
          </select>
        </label>
      </div>
      <label className="wf-conn__form-value">
        新しい値 (JSON; 空欄で既存の値を維持)
        <textarea
          rows={5}
          value={valueText}
          onChange={(e) => setValueText(e.target.value)}
          placeholder='{"access_token": "...", "refresh_token": "..."}'
        />
        {parseError ? <span className="wf-conn__form-err">{parseError}</span> : null}
      </label>
      <div className="wf-conn__form-actions">
        <Button
          variant="primary"
          size="sm"
          onClick={() => void handleSubmit()}
          disabled={submitting}
        >
          {submitting ? "保存中..." : "保存"}
        </Button>
      </div>
    </div>
  );
}

const TYPES: AppConnectionType[] = [
  "OAUTH2",
  "PLATFORM_OAUTH2",
  "CLOUD_OAUTH2",
  "SECRET_TEXT",
  "BASIC_AUTH",
  "CUSTOM_AUTH",
  "NO_AUTH",
];

function AddConnectionForm({
  onSubmit,
}: {
  onSubmit: (input: {
    externalId: string;
    displayName: string;
    type: AppConnectionType;
    pieceName: string;
    pieceVersion: string;
    value: Record<string, unknown>;
  }) => Promise<void>;
}): React.ReactElement {
  const [externalId, setExternalId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [type, setType] = useState<AppConnectionType>("OAUTH2");
  const [pieceName, setPieceName] = useState("");
  const [pieceVersion, setPieceVersion] = useState("0.0.0");
  const [valueText, setValueText] = useState('{"access_token": ""}');
  const [submitting, setSubmitting] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);

  const handleSubmit = async (): Promise<void> => {
    let value: Record<string, unknown>;
    try {
      const parsed = JSON.parse(valueText);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("value must be a JSON object");
      }
      value = parsed as Record<string, unknown>;
    } catch (e) {
      setParseError((e as Error).message);
      return;
    }
    setParseError(null);
    setSubmitting(true);
    try {
      await onSubmit({
        externalId: externalId.trim(),
        displayName: displayName.trim(),
        type,
        pieceName: pieceName.trim(),
        pieceVersion: pieceVersion.trim() || "0.0.0",
        value,
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="wf-conn__form">
      <div className="wf-conn__form-row">
        <label>
          外部ID
          <input
            value={externalId}
            onChange={(e) => setExternalId(e.target.value)}
            placeholder="my-gmail"
          />
        </label>
        <label>
          表示名
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="My Gmail"
          />
        </label>
      </div>
      <div className="wf-conn__form-row">
        <label>
          種別
          <select value={type} onChange={(e) => setType(e.target.value as AppConnectionType)}>
            {TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </label>
        <label>
          ピース名
          <input
            value={pieceName}
            onChange={(e) => setPieceName(e.target.value)}
            placeholder="@activepieces/piece-gmail"
          />
        </label>
        <label>
          ピースバージョン
          <input
            value={pieceVersion}
            onChange={(e) => setPieceVersion(e.target.value)}
            placeholder="0.0.0"
          />
        </label>
      </div>
      <label className="wf-conn__form-value">
        値 (JSON)
        <textarea
          rows={5}
          value={valueText}
          onChange={(e) => setValueText(e.target.value)}
          placeholder='{"access_token": "...", "refresh_token": "..."}'
        />
        {parseError ? <span className="wf-conn__form-err">{parseError}</span> : null}
      </label>
      <div className="wf-conn__form-actions">
        <Button
          variant="primary"
          size="sm"
          onClick={() => void handleSubmit()}
          disabled={submitting || !externalId.trim() || !displayName.trim() || !pieceName.trim()}
        >
          {submitting ? "追加中…" : "接続を追加"}
        </Button>
      </div>
    </div>
  );
}
