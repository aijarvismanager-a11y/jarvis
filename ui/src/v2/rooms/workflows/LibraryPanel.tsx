/**
 * Library panel: tiered list of activepieces community pieces a Jarvis user
 * can opt into installing. Rendered as two sections:
 *
 *   - Verified  -- hand-reviewed by a maintainer, no preamble needed.
 *   - Community -- pulled from npm; runs in the engine sandbox but has not
 *                  been individually reviewed. Collapsed by default behind
 *                  a one-line "third-party code" notice so users opt in
 *                  with their eyes open.
 *
 * Each row shows piece metadata, vetted version, license, source link, and
 * an Install / Uninstall button. Search filters across both tiers.
 *
 * Pieces install via npm at runtime into `~/.jarvis/pieces/`; this panel
 * only triggers the install/uninstall + reflects state, it doesn't bundle
 * any piece code itself.
 */

import React, { useMemo, useState } from "react";
import { confirmDialog } from "../../ui/ConfirmDialog";
import { Button, Chip, Icon } from "../../ui";
import { ChevronRight, RefreshCw, Download, Trash2, ExternalLink, ShieldCheck } from "lucide-react";
import { useLibrary, type LibraryEntry, type LibraryActionState } from "./useLibrary";

export function LibraryPanel(): React.ReactElement {
  const lib = useLibrary();
  const [toast, setToast] = useState<{ tone: "ok" | "warn"; text: string } | null>(null);
  const [query, setQuery] = useState("");
  const [communityOpen, setCommunityOpen] = useState(false);

  const flash = (tone: "ok" | "warn", text: string): void => {
    setToast({ tone, text });
    window.setTimeout(() => setToast(null), 4000);
  };

  const installedCount = lib.entries.filter((e) => e.installed !== null).length;

  // Filtered + tier-split view. Search is case-insensitive against
  // displayName + npmPackage + description so users typing "gmail" find
  // gmail regardless of which field carries the match.
  const { verified, community } = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = (e: LibraryEntry): boolean =>
      !q ||
      e.displayName.toLowerCase().includes(q) ||
      e.npmPackage.toLowerCase().includes(q) ||
      e.description.toLowerCase().includes(q) ||
      e.id.includes(q);
    const verified: LibraryEntry[] = [];
    const community: LibraryEntry[] = [];
    for (const e of lib.entries) {
      if (!matches(e)) continue;
      if (e.tier === "verified") verified.push(e);
      else community.push(e);
    }
    return { verified, community };
  }, [lib.entries, query]);

  // Auto-expand the community list when the user is actively searching so
  // their typed query isn't hidden behind the collapsed disclosure.
  const showCommunity = communityOpen || query.trim().length > 0;

  return (
    <div className="wf-lib">
      <header className="wf-lib__header">
        <div>
          <h3 className="wf-lib__title">ピースライブラリ</h3>
          <p className="wf-lib__subtitle">
            {lib.loading
              ? "読み込み中..."
              : `${lib.entries.length}件中${installedCount}件インストール済み`}
            {lib.error ? ` - ${lib.error}` : null}
          </p>
        </div>
        <div className="wf-lib__actions">
          <Button variant="ghost" size="sm" onClick={() => void lib.refresh()} title="更新">
            <Icon icon={RefreshCw} size={14} /> 更新
          </Button>
        </div>
      </header>

      <input
        className="wf-lib__search"
        type="search"
        placeholder="名前・パッケージ・説明でピースを検索"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="ピースを検索"
      />

      {toast ? <div className={`wf-toast wf-toast--${toast.tone}`}>{toast.text}</div> : null}

      {lib.entries.length === 0 && !lib.loading ? (
        <div className="wf-lib__empty">カタログは空です。</div>
      ) : (
        <>
          {/* Verified section -- always visible, no warning preamble. */}
          <section className="wf-lib__section">
            <h4 className="wf-lib__section-title">
              <Icon icon={ShieldCheck} size={14} /> 検証済み
              <span className="wf-lib__section-count">{verified.length}</span>
            </h4>
            <p className="wf-lib__section-hint">
              Jarvisメンテナーによって手動レビューされ、エンジンでの動作確認済みです。
            </p>
            {verified.length === 0 ? (
              <div className="wf-lib__empty-section">
                {query ? "検索条件に一致する検証済みピースはありません。" : "検証済みピースはありません。"}
              </div>
            ) : (
              <ul className="wf-lib__list">
                {verified.map((entry) => (
                  <LibraryRowWired
                    key={entry.id}
                    entry={entry}
                    actionState={lib.actionState[entry.id] ?? "idle"}
                    lib={lib}
                    flash={flash}
                  />
                ))}
              </ul>
            )}
          </section>

          {/* Community section -- collapsed by default, with preamble. */}
          <section className="wf-lib__section">
            <button
              type="button"
              className="wf-lib__section-toggle"
              onClick={() => setCommunityOpen((v) => !v)}
              aria-expanded={showCommunity}
            >
              <Icon
                icon={ChevronRight}
                size={14}
                style={{
                  transform: showCommunity ? "rotate(90deg)" : "rotate(0deg)",
                  transition: "transform var(--dur-fast) var(--ease-out)",
                }}
              />
              コミュニティ
              <span className="wf-lib__section-count">{community.length}</span>
            </button>
            {showCommunity ? (
              <>
                <p className="wf-lib__section-hint wf-lib__section-hint--warn">
                  コミュニティピースはnpmからインストールされ、エンジンのサンドボックス内で
                  動作します。Jarvisによる個別レビューは行われていません -- 有効にする前に
                  各ピースのソースリンクを確認してください。
                </p>
                {community.length === 0 ? (
                  <div className="wf-lib__empty-section">
                    {query ? "検索条件に一致するコミュニティピースはありません。" : "コミュニティピースはありません。"}
                  </div>
                ) : (
                  <ul className="wf-lib__list">
                    {community.map((entry) => (
                      <LibraryRowWired
                        key={entry.id}
                        entry={entry}
                        actionState={lib.actionState[entry.id] ?? "idle"}
                        lib={lib}
                        flash={flash}
                      />
                    ))}
                  </ul>
                )}
              </>
            ) : null}
          </section>
        </>
      )}
    </div>
  );
}

/**
 * Thin wrapper around LibraryRow that wires the install/uninstall handlers.
 * Pulled out so the two tier sections don't duplicate the handler logic.
 */
function LibraryRowWired({
  entry,
  actionState,
  lib,
  flash,
}: {
  entry: LibraryEntry;
  actionState: LibraryActionState;
  lib: ReturnType<typeof useLibrary>;
  flash: (tone: "ok" | "warn", text: string) => void;
}): React.ReactElement {
  return (
    <LibraryRow
      entry={entry}
      actionState={actionState}
      onInstall={async () => {
        if (entry.estimatedSizeMb !== null && entry.estimatedSizeMb >= 100) {
          if (
            !await confirmDialog(
              `${entry.displayName}をインストールすると、約${entry.estimatedSizeMb}MBのディスク容量を使用します。続行しますか?`,
            )
          ) {
            return;
          }
        }
        const r = await lib.install(entry.id);
        flash(
          r.ok ? (r.partial ? "warn" : "ok") : "warn",
          r.ok ? `${entry.displayName}: ${r.message}` : `インストールに失敗しました: ${r.message}`,
        );
      }}
      onUninstall={async () => {
        if (
          !await confirmDialog(
            `${entry.displayName}をアンインストールしますか? これを使用している既存のワークフローは再インストールするまで動作しなくなります。`,
          )
        )
          return;
        const r = await lib.uninstall(entry.id);
        flash(
          r.ok ? "ok" : "warn",
          r.ok ? `${entry.displayName}をアンインストールしました` : `アンインストールに失敗しました: ${r.message}`,
        );
      }}
    />
  );
}

function LibraryRow({
  entry,
  actionState,
  onInstall,
  onUninstall,
}: {
  entry: LibraryEntry;
  actionState: LibraryActionState;
  onInstall: () => void;
  onUninstall: () => void;
}): React.ReactElement {
  const isInstalled = entry.installed !== null;
  // Shared-catalog pieces are managed by the host, not the user: no install
  // (it already works), no uninstall (the tree is read-only), no update chip
  // (updates arrive with the host's version upgrades).
  const isShared = entry.installed?.source === "shared";
  const busy = actionState !== "idle";
  // Compare resolved vs vetted to surface the right hint:
  //   resolved < vetted -> "Update available" (we vetted a newer version)
  //   resolved > vetted -> "Newer than vetted" (user upgraded past our audit)
  //   resolved == vetted -> no chip
  const versionRel = isInstalled && !isShared
    ? compareSemver(entry.installed!.resolvedVersion, entry.vettedVersion)
    : 0;
  const updateAvailable = versionRel < 0;
  const newerThanVetted = versionRel > 0;

  return (
    <li className="wf-lib__row">
      <div className="wf-lib__row-main">
        <div className="wf-lib__row-title">
          <span className="wf-lib__row-name">{entry.displayName}</span>
          {isShared ? (
            <Chip tone="ok" title="このJarvisインストールに同梱 — すぐに使用でき、管理は不要です">
              同梱 {entry.installed!.resolvedVersion}
            </Chip>
          ) : isInstalled ? (
            <Chip tone="ok">インストール済み {entry.installed!.resolvedVersion}</Chip>
          ) : (
            <Chip tone="neutral">{entry.versionRange}</Chip>
          )}
          {updateAvailable ? (
            <Chip
              tone="warn"
              title={`インストール済み ${entry.installed!.resolvedVersion} -- カタログ検証済み ${entry.vettedVersion}。「インストール」を再度クリックしてアップグレードしてください。`}
            >
              {`更新 -> ${entry.vettedVersion}`}
            </Chip>
          ) : null}
          {newerThanVetted ? (
            <Chip tone="warn" title={`検証済みバージョンは${entry.vettedVersion}です; より新しいバージョンがインストールされています`}>
              検証済み{entry.vettedVersion}より新しい
            </Chip>
          ) : null}
          {entry.licenseSpdx ? <Chip tone="neutral">{entry.licenseSpdx}</Chip> : null}
          {entry.estimatedSizeMb !== null ? (
            <Chip tone="neutral" title="インストール後のおおよそのディスク使用量">
              ~{entry.estimatedSizeMb}MB
            </Chip>
          ) : null}
        </div>
        {entry.description ? (
          <p className="wf-lib__row-desc">{entry.description}</p>
        ) : null}
        <div className="wf-lib__row-meta">
          <code className="wf-lib__row-pkg">{entry.npmPackage}</code>
          <a
            className="wf-lib__row-source"
            href={entry.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Icon icon={ExternalLink} size={11} /> ソース
          </a>
          {entry.vettedAt ? <span>検証日 {entry.vettedAt}</span> : null}
        </div>
      </div>
      <div className="wf-lib__row-actions">
        {isShared ? null : isInstalled ? (
          <>
            {updateAvailable ? (
              <Button variant="primary" size="sm" onClick={onInstall} disabled={busy}>
                <Icon icon={Download} size={12} />{" "}
                {actionState === "installing" ? "更新中..." : "更新"}
              </Button>
            ) : null}
            <Button variant="danger" size="sm" onClick={onUninstall} disabled={busy}>
              <Icon icon={Trash2} size={12} />{" "}
              {actionState === "uninstalling" ? "アンインストール中..." : "アンインストール"}
            </Button>
          </>
        ) : (
          <Button variant="primary" size="sm" onClick={onInstall} disabled={busy}>
            <Icon icon={Download} size={12} />{" "}
            {actionState === "installing" ? "インストール中..." : "インストール"}
          </Button>
        )}
      </div>
    </li>
  );
}

/**
 * Loose semver comparison: returns negative if `a < b`, 0 if equal, positive
 * if `a > b`. Stops at the first numeric mismatch; ignores prerelease tags
 * (catalog entries shouldn't carry them).
 */
function compareSemver(a: string, b: string): number {
  const pa = a.split(".").map((p) => parseInt(p, 10) || 0);
  const pb = b.split(".").map((p) => parseInt(p, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}
