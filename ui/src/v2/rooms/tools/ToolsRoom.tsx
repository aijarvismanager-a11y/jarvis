import React, { useEffect, useMemo, useState } from "react";
import { Search, Terminal } from "lucide-react";
import { Icon } from "../../ui";
import { StatusChip, Drawer, DrawerLabel, DrawerText, DeepLink, FilterChip, EmptyState, Skeleton, type Tone } from "../../ui/roomkit";
import { RoomShell } from "../RoomShell";
import { openRoom } from "../../router";
import { useRoomActions } from "../useRoomActionBus";
import "./ToolsRoom.css";

type Impact = "read" | "write" | "destructive" | "external";

type Tool = {
  name: string;
  category: string;
  actionCategory: string;
  impact: Impact;
  description: string;
  parameters: Array<{ name: string; type: string; description: string; required: boolean }>;
};

// Blast radius → tone (tools §02): read green, write neutral, external amber, destructive red.
const IMPACT_TONE: Record<Impact, Tone> = { read: "ok", write: "mut", external: "hold", destructive: "fail" };
const IMPACT_ORDER: Record<Impact, number> = { read: 0, write: 1, external: 2, destructive: 3 };

type Filter = "all" | Impact;
const FILTER_ORDER: Filter[] = ["all", "read", "write", "external", "destructive"];
const FILTER_LABEL: Record<Filter, string> = { all: "すべて", read: "読み取り", write: "書き込み", external: "外部", destructive: "破壊的" };

export type RoomBodyMode = "inline" | "expanded";

export function ToolsRoomBody({ mode }: { mode: RoomBodyMode }) {
  const [tools, setTools] = useState<Tool[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [selectedName, setSelectedName] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/tools")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data: Tool[]) => { if (!cancelled) setTools(Array.isArray(data) ? data : []); })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : "ツールの読み込みに失敗しました"); });
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    if (!tools) return [];
    const q = query.trim().toLowerCase();
    return tools
      .filter((t) => filter === "all" || t.impact === filter)
      .filter((t) => !q || t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q) || t.category.toLowerCase().includes(q))
      .sort((a, b) => { const di = IMPACT_ORDER[a.impact] - IMPACT_ORDER[b.impact]; return di !== 0 ? di : a.name.localeCompare(b.name); });
  }, [tools, query, filter]);

  useEffect(() => {
    if (mode !== "expanded") return;
    if (filtered.length === 0) { setSelectedName(null); return; }
    if (!selectedName || !filtered.some((t) => t.name === selectedName)) setSelectedName(filtered[0]!.name);
  }, [filtered, selectedName, mode]);

  const selected = useMemo(
    () => (selectedName ? filtered.find((t) => t.name === selectedName) ?? null : null),
    [filtered, selectedName],
  );

  useRoomActions("tools", (action, args) => {
    switch (action) {
      case "set_filter": { const f = String(args.filter); if (f === "all" || f === "read" || f === "write" || f === "external" || f === "destructive") { setFilter(f as Filter); return true; } return false; }
      case "search": setQuery(typeof args.query === "string" ? args.query : ""); return true;
      case "select": {
        const name = typeof args.name === "string" ? args.name : ""; if (!name) return false;
        const exact = (tools ?? []).find((t) => t.name === name);
        const fuzzy = exact ?? (tools ?? []).find((t) => t.name.toLowerCase().includes(name.toLowerCase()));
        if (!fuzzy) return false; setSelectedName(fuzzy.name); return true;
      }
      default: return false;
    }
  });

  return (
    <div className={`rk-tools rk-tools--${mode}`}>
      <div className="rk-tools__list">
        <div className="rk-tools__bar">
          <div className="rk-tools__search">
            <Icon icon={Search} size="sm" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ツールを検索…" aria-label="ツールを検索" />
          </div>
          <div className="rk-tools__filters" role="tablist" aria-label="影響範囲で絞り込み">
            {FILTER_ORDER.map((f) => (
              <FilterChip key={f} on={filter === f} onClick={() => setFilter(f)}>{FILTER_LABEL[f]}</FilterChip>
            ))}
          </div>
        </div>

        <div className="rk-tools__scroll" role="listbox" aria-label="ツール">
          {error ? (
            <div className="rk-tools__msg">{error}</div>
          ) : tools === null ? (
            <div className="rk-tools__empty"><Skeleton lines={6} /></div>
          ) : filtered.length === 0 ? (
            <div className="rk-tools__empty">
              <EmptyState title="一致するツールがありません">
                {query ? <>"{query}" に一致するものがありません。</> : <>この影響範囲にツールはありません。</>}フィルタを解除するか別の名前で検索してください。
              </EmptyState>
            </div>
          ) : (
            filtered.map((t) => {
              const active = selectedName === t.name;
              return (
                <button key={t.name} className={`rk-toolrow${active ? " rk-toolrow--sel" : ""}`} onClick={() => setSelectedName(active ? null : t.name)} role="option" aria-selected={active}>
                  <span className="rk-toolrow__icon"><Icon icon={Terminal} size="sm" /></span>
                  <span className="rk-toolrow__body">
                    <span className="rk-toolrow__head">
                      <span className="rk-toolrow__name">{t.name}</span>
                      <StatusChip tone={IMPACT_TONE[t.impact]}>{t.impact}</StatusChip>
                    </span>
                    <span className="rk-toolrow__desc">{t.description}</span>
                    <span className="rk-toolrow__meta"><span>{t.category}</span><span>·</span><span>{t.actionCategory}</span></span>
                    {mode === "inline" && active && (
                      <div style={{ marginTop: 6 }}>{t.parameters.length === 0 ? <div className="rk-tool-noparams">パラメータなし。</div> : <ParamList params={t.parameters} />}</div>
                    )}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </div>

      {mode === "expanded" && (
        <div className="rk-tools__detail">
          {selected ? <ToolDetail tool={selected} /> : <Drawer empty="ツールを選択するとパラメータを確認できます。" />}
        </div>
      )}
    </div>
  );
}

export function ToolsRoom() {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/tools").then((r) => (r.ok ? r.json() : null)).then((data) => { if (!cancelled && Array.isArray(data)) setCount(data.length); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);
  const subtitle = count === null ? "読み込み中…" : `${count} 件のツール`;
  return (
    <RoomShell title="ツール" subtitle={subtitle} breadcrumb={["ツール"]}>
      <ToolsRoomBody mode="expanded" />
    </RoomShell>
  );
}

function ToolDetail({ tool }: { tool: Tool }) {
  return (
    <Drawer
      title={<span style={{ fontFamily: "var(--mono)" }}>{tool.name}</span>}
      meta={<><StatusChip tone={IMPACT_TONE[tool.impact]}>{tool.impact}</StatusChip><span>{tool.category} · {tool.actionCategory}</span></>}
      actions={<DeepLink onClick={() => openRoom("authority")}>→ 権限で管理 · {tool.impact}</DeepLink>}
    >
      <DrawerText>{tool.description}</DrawerText>
      <DrawerLabel>パラメータ</DrawerLabel>
      {tool.parameters.length === 0 ? <div className="rk-tool-noparams">パラメータなし。</div> : <ParamList params={tool.parameters} />}
    </Drawer>
  );
}

function ParamList({ params }: { params: Tool["parameters"] }) {
  return (
    <ul className="rk-tool-params">
      {params.map((p) => (
        <li key={p.name}>
          <div className="rk-tool-param__head">
            <code className="rk-tool-param__name">{p.name}</code>
            <span className="rk-tool-param__type">{p.type}</span>
            {p.required && <span className="rk-tool-param__req">必須</span>}
          </div>
          {p.description && <div className="rk-tool-param__desc">{p.description}</div>}
        </li>
      ))}
    </ul>
  );
}
