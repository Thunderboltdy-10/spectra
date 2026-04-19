"use client";

import { useEffect, useRef, useState } from "react";
import { Icon, type IconName } from "./icons";
import type { V2Item, V2Territory, QuickStart } from "./data";
import { KIND_META } from "./data";

/* ─────────────────────────────────────────────────────────────
 *  Unified TopRail — single surface that replaces multiple boxes
 * ───────────────────────────────────────────────────────────── */

export type ViewMode = "spatial" | "type" | "topic" | "timeline";

type TopRailProps = {
  workspace: V2Territory | null;
  zoom: number;
  trayCount: number;
  viewMode: ViewMode;
  widgetsHidden: boolean;
  theme: "light" | "dark";
  onViewMode: (m: ViewMode) => void;
  onOpenTray: () => void;
  onHome: () => void;
  onAtlas: () => void;
  onSpotlight: () => void;
  onToggleWidgets: () => void;
  onAddWidget: (kind: string) => void;
  onToggleTheme: () => void;
  onOpenInfo: () => void;
};

export function TopRail({
  workspace, zoom, trayCount, viewMode, widgetsHidden, theme,
  onViewMode, onOpenTray, onHome, onAtlas, onSpotlight,
  onToggleWidgets, onAddWidget, onToggleTheme, onOpenInfo,
}: TopRailProps) {
  const [widgetsMenu, setWidgetsMenu] = useState(false);
  const modes: { id: ViewMode; label: string; icon: IconName }[] = [
    { id: "spatial", label: "Spatial", icon: "layout" },
    { id: "type", label: "Type", icon: "grid" },
    { id: "topic", label: "Topic", icon: "topic" },
    { id: "timeline", label: "Timeline", icon: "timeline" },
  ];
  const addables: { kind: string; label: string; icon: IconName }[] = [
    { kind: "timer", label: "Focus timer", icon: "timer" },
    { kind: "planner", label: "Week planner", icon: "planner" },
    { kind: "today", label: "Today queue", icon: "schedule" },
    { kind: "scratch", label: "Scratchpad", icon: "note" },
    { kind: "library", label: "Library", icon: "reading" },
    { kind: "calendar", label: "Calendar", icon: "schedule" },
  ];

  return (
    <div className="absolute top-0 left-0 right-0 z-30 pointer-events-none">
      <div className="mx-auto max-w-[1600px] px-4 py-3 flex items-center justify-between gap-3">
        {/* LEFT: identity + breadcrumb */}
        <div className="flex items-center gap-2 pointer-events-auto">
          <button
            onClick={onHome}
            className="w-8 h-8 rounded-full flex items-center justify-center transition-colors"
            style={{ border: "1px solid var(--line)", background: "rgba(251,250,246,0.8)", backdropFilter: "blur(8px)" }}
            title="Home / Atlas"
          >
            <div className="w-2 h-2 rounded-full" style={{ background: "linear-gradient(135deg, var(--accent), var(--mint))" }} />
          </button>
          <div className="font-mono text-[10px] uppercase tracking-[0.16em]" style={{ color: "var(--ink-400)" }}>Spectra</div>
          <span style={{ color: "var(--ink-400)" }}>·</span>
          <button
            onClick={onAtlas}
            className="font-mono text-[10px] uppercase tracking-[0.16em] hover:underline"
            style={{ color: "var(--ink-300)" }}
          >
            Atlas
          </button>
          {workspace && (
            <>
              <Icon name="chevron" size={12} style={{ color: "var(--ink-400)" }} />
              <div className="flex items-center gap-1.5">
                <span className="text-[14px]">{workspace.glyph}</span>
                <span className="font-display text-[17px]" style={{ color: "var(--ink-100)" }}>{workspace.name}</span>
                <span className="text-[11px] font-mono ml-2" style={{ color: "var(--ink-400)" }}>{workspace.subtitle}</span>
              </div>
            </>
          )}
        </div>

        {/* RIGHT: view modes + unified actions */}
        <div className="flex items-center gap-2 pointer-events-auto">
          {workspace && (
            <div className="flex items-center p-0.5 rounded-full"
                 style={{ border: "1px solid var(--line)", background: "rgba(251,250,246,0.8)", backdropFilter: "blur(8px)" }}>
              {modes.map((m, i) => (
                <button
                  key={m.id}
                  onClick={() => onViewMode(m.id)}
                  className="px-2.5 h-7 rounded-full flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-[0.1em] transition-colors"
                  style={{
                    background: viewMode === m.id ? "var(--accent)" : "transparent",
                    color: viewMode === m.id ? "#fff" : "var(--ink-300)",
                  }}
                  title={`${m.label} (press ${i + 1})`}
                >
                  <Icon name={m.icon} size={11} />
                  <span>{m.label}</span>
                </button>
              ))}
            </div>
          )}

          {/* Widgets menu — add / toggle */}
          <div className="relative">
            <button
              onClick={() => setWidgetsMenu((v) => !v)}
              className="h-8 px-3 rounded-full flex items-center gap-1.5 transition-colors"
              style={{
                border: `1px solid ${widgetsHidden ? "var(--line)" : "rgba(14,142,232,0.4)"}`,
                background: widgetsHidden ? "rgba(251,250,246,0.8)" : "var(--paper)",
                color: widgetsHidden ? "var(--ink-300)" : "var(--accent)",
                backdropFilter: "blur(8px)",
              }}
              title="Widgets"
            >
              <Icon name="widget" size={12} />
              <span className="text-[10.5px] font-mono uppercase tracking-[0.12em]">Widgets</span>
            </button>
            {widgetsMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setWidgetsMenu(false)} />
                <div
                  className="absolute right-0 mt-1 rounded-xl py-1 z-50 min-w-[220px]"
                  style={{ background: "var(--paper)", border: "1px solid var(--line)", boxShadow: "0 18px 45px -28px rgba(8,22,40,0.2)" }}
                >
                  <button
                    onClick={() => { onToggleWidgets(); setWidgetsMenu(false); }}
                    className="w-full text-left px-3 py-2 flex items-center gap-2 text-[12px] hover:bg-[var(--bg2)]"
                    style={{ color: "var(--ink-200)" }}
                  >
                    <Icon name={widgetsHidden ? "expand" : "collapse"} size={11} />
                    {widgetsHidden ? "Show widgets" : "Hide widgets"}
                  </button>
                  <div className="h-px mx-2 my-1" style={{ background: "var(--line)" }} />
                  <div className="px-3 py-1 font-mono text-[9px] uppercase tracking-[0.16em]" style={{ color: "var(--ink-400)" }}>
                    Add widget
                  </div>
                  {addables.map((a) => (
                    <button
                      key={a.kind}
                      onClick={() => { onAddWidget(a.kind); setWidgetsMenu(false); }}
                      className="w-full text-left px-3 py-1.5 flex items-center gap-2 text-[12px] hover:bg-[var(--bg2)]"
                      style={{ color: "var(--ink-200)" }}
                    >
                      <Icon name={a.icon} size={11} style={{ color: "var(--ink-400)" }} />
                      {a.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          <button
            onClick={onSpotlight}
            className="flex items-center gap-2 px-3 h-8 rounded-full transition-colors"
            style={{
              border: "1px solid var(--line)",
              background: "rgba(251,250,246,0.8)",
              backdropFilter: "blur(8px)",
            }}
            title="Spotlight (⌘K)"
          >
            <Icon name="search" size={13} style={{ color: "var(--ink-400)" }} />
            <span className="text-[12px]" style={{ color: "var(--ink-300)" }}>Jump…</span>
            <span className="sv2-kbd">⌘K</span>
          </button>

          <button
            onClick={onOpenTray}
            className="relative h-8 px-3 rounded-full flex items-center gap-2"
            style={{ border: "1px solid var(--line)", background: "rgba(251,250,246,0.8)", backdropFilter: "blur(8px)" }}
          >
            <Icon name="tray" size={13} style={{ color: "var(--ink-400)" }} />
            <span className="text-[11px] font-mono uppercase tracking-[0.12em]" style={{ color: "var(--ink-300)" }}>Tray</span>
            {trayCount > 0 && (
              <span className="font-mono text-[10px]" style={{ color: "var(--accent)" }}>{trayCount}</span>
            )}
          </button>

          <button
            onClick={onToggleTheme}
            className="w-8 h-8 rounded-full flex items-center justify-center"
            style={{ border: "1px solid var(--line)", background: "rgba(251,250,246,0.8)", backdropFilter: "blur(8px)", color: "var(--ink-300)" }}
            title="Toggle theme"
          >
            <Icon name={theme === "dark" ? "sun" : "moon"} size={12} />
          </button>

          <button
            onClick={onOpenInfo}
            className="w-8 h-8 rounded-full flex items-center justify-center"
            style={{ border: "1px solid var(--line)", background: "rgba(251,250,246,0.8)", backdropFilter: "blur(8px)", color: "var(--ink-300)" }}
            title="Shortcuts & help"
          >
            <Icon name="info" size={13} />
          </button>

          <div
            className="h-8 px-3 rounded-full flex items-center gap-1.5"
            style={{ border: "1px solid var(--line)", background: "rgba(251,250,246,0.8)", backdropFilter: "blur(8px)" }}
          >
            <span className="font-mono text-[10px]" style={{ color: "var(--ink-400)" }}>zoom</span>
            <span className="font-mono text-[10.5px] tabular-nums" style={{ color: "var(--ink-100)" }}>
              {Math.round(zoom * 100)}%
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── AtlasStrip — horizontal workspace switcher ─── */

export function AtlasStrip({
  territories, current, onPick, onCreate,
}: {
  territories: V2Territory[];
  current: string | null;
  onPick: (id: string) => void;
  onCreate?: () => void;
}) {
  return (
    <div className="absolute top-[60px] left-1/2 -translate-x-1/2 z-20 pointer-events-auto">
      <div className="flex items-center gap-1 p-1 rounded-full"
           style={{ background: "rgba(251,250,246,0.8)", border: "1px solid var(--line)", backdropFilter: "blur(8px)" }}>
        {territories.map((w) => (
          <button
            key={w.id}
            onClick={() => onPick(w.id)}
            className="px-3 py-1.5 rounded-full flex items-center gap-1.5 transition-colors"
            style={{
              background: current === w.id ? "var(--paper)" : "transparent",
              border: `1px solid ${current === w.id ? "rgba(14,142,232,0.6)" : "transparent"}`,
            }}
          >
            <span className="text-[13px]">{w.glyph}</span>
            <span className="text-[11px]" style={{ color: "var(--ink-200)", fontWeight: 500 }}>{w.name}</span>
          </button>
        ))}
        {onCreate && (
          <>
            <div className="w-px h-5 mx-0.5" style={{ background: "var(--line)" }} />
            <button
              onClick={onCreate}
              className="px-2 py-1.5 rounded-full transition-colors"
              style={{ color: "var(--ink-400)" }}
              title="New workspace"
            >
              <Icon name="plus" size={13} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
 *  Minimap — HOVER-TELEPORT (user requested)
 *  Hover → camera flies to that world point
 *  Wheel over map → zoom (not aggressive)
 *  Click workspace tile → fly there
 * ───────────────────────────────────────────────────────────── */

export function Minimap({
  territories, items, viewport, worldSize,
  onHoverPan, onCommitPan, onWorkspaceClick, onWheelZoom,
}: {
  territories: V2Territory[];
  items: V2Item[];
  viewport: { x: number; y: number; w: number; h: number };
  worldSize: { w: number; h: number };
  onHoverPan: (worldX: number, worldY: number) => void;
  onCommitPan: (worldX: number, worldY: number) => void;
  onWorkspaceClick: (id: string) => void;
  onWheelZoom: (delta: number, originX: number, originY: number) => void;
}) {
  const W = 240;
  const H = 150;
  const scale = Math.min(W / worldSize.w, H / worldSize.h);
  const ox = W / 2;
  const oy = H / 2;
  const mapRef = useRef<HTMLDivElement>(null);
  const hovering = useRef(false);

  const toWorld = (e: React.MouseEvent | MouseEvent) => {
    const rect = mapRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    const mx = e.clientX - rect.left - ox;
    const my = e.clientY - rect.top - oy;
    return { x: mx / scale, y: my / scale };
  };

  return (
    <div className="absolute bottom-4 right-4 z-30 pointer-events-auto">
      <div className="rounded-xl p-2"
           style={{ background: "rgba(251,250,246,0.94)", border: "1px solid var(--line)", backdropFilter: "blur(10px)", boxShadow: "0 18px 45px -28px rgba(8,22,40,0.18)" }}>
        <div className="flex items-center justify-between mb-1.5 px-1 gap-2">
          <span className="font-mono text-[9px] uppercase tracking-[0.16em]" style={{ color: "var(--ink-400)" }}>Map · hover to fly</span>
          <div className="flex items-center gap-0.5">
            <button
              onClick={(e) => { e.stopPropagation(); onWheelZoom(-80, 0, 0); }}
              className="w-4 h-4 rounded flex items-center justify-center"
              style={{ color: "var(--ink-400)", border: "1px solid var(--line)" }}
              title="Zoom out"
            >
              <Icon name="minus" size={8} />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onWheelZoom(80, 0, 0); }}
              className="w-4 h-4 rounded flex items-center justify-center"
              style={{ color: "var(--ink-400)", border: "1px solid var(--line)" }}
              title="Zoom in"
            >
              <Icon name="plus" size={8} />
            </button>
            <span className="font-mono text-[9px] ml-1" style={{ color: "var(--ink-400)" }}>{items.length}</span>
          </div>
        </div>
        <div
          ref={mapRef}
          className="relative"
          style={{ width: W, height: H, background: "var(--bg2)", borderRadius: 6, cursor: "crosshair", overflow: "hidden" }}
          onMouseEnter={() => { hovering.current = true; }}
          onMouseLeave={() => { hovering.current = false; }}
          onMouseMove={(e) => {
            if (!hovering.current) return;
            const p = toWorld(e);
            onHoverPan(p.x, p.y);
          }}
          onClick={(e) => {
            const p = toWorld(e);
            onCommitPan(p.x, p.y);
          }}
          onWheel={(e) => {
            // Shift+wheel zooms — plain wheel is reserved for page scroll.
            if (!e.shiftKey) return;
            e.preventDefault();
            onWheelZoom(-e.deltaY, 0, 0);
          }}
          title="Hover to fly · click to commit · shift+scroll or buttons to zoom"
        >
          {territories.map((w) => (
            <div
              key={w.id}
              onClick={(e) => { e.stopPropagation(); onWorkspaceClick(w.id); }}
              className="absolute rounded-sm cursor-pointer transition-opacity"
              style={{
                left: ox + (w.cx - w.w / 2) * scale,
                top: oy + (w.cy - w.h / 2) * scale,
                width: w.w * scale,
                height: w.h * scale,
                background: w.color,
                opacity: 0.16,
                border: `1px solid ${w.color}70`,
              }}
            >
              <div className="absolute top-0.5 left-1 font-display text-[8px]" style={{ color: w.color }}>
                {w.name}
              </div>
            </div>
          ))}
          {items.map((it) => (
            <div
              key={it.id}
              className="absolute rounded-full pointer-events-none"
              style={{
                left: ox + it.x * scale - 1,
                top: oy + it.y * scale - 1,
                width: 2,
                height: 2,
                background: it.color,
              }}
            />
          ))}
          <div
            className="absolute sv2-lens-pulse pointer-events-none"
            style={{
              left: ox + viewport.x * scale - (viewport.w * scale) / 2,
              top: oy + viewport.y * scale - (viewport.h * scale) / 2,
              width: Math.max(20, viewport.w * scale),
              height: Math.max(14, viewport.h * scale),
              border: "1.5px solid var(--accent)",
              borderRadius: 3,
              background: "rgba(14,142,232,0.07)",
            }}
          />
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
 *  CommandBar — slim (user requested smaller)
 * ───────────────────────────────────────────────────────────── */

export type ResultIsland = {
  status: "streaming" | "done" | "error";
  text: string;
  chips?: string[];
} | null;

type CommandBarProps = {
  focusedItem: V2Item | null;
  workspace: V2Territory | null;
  selectedCount: number;
  bloomedCount: number;
  resultIsland: ResultIsland;
  quickStarts: readonly QuickStart[];
  onSubmit: (text: string) => void;
  onDismissResult: () => void;
};

export function CommandBar({
  focusedItem, workspace, selectedCount, bloomedCount,
  resultIsland, quickStarts, onSubmit, onDismissResult,
}: CommandBarProps) {
  const [value, setValue] = useState("");
  const [focused, setFocused] = useState(false);
  const [showQS, setShowQS] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const suggestionsFor = (): string[] => {
    if (selectedCount > 1) return [`Ask about ${selectedCount} items`, "Compare", "Merge into one note", "Quiz me"];
    if (focusedItem) {
      const k = focusedItem.kind;
      if (k === "essay") return ["Strengthen thesis", "Tighten transition", "Find counterargument"];
      if (k === "pset") return ["Hint for current problem", "Check my work", "Make similar practice"];
      if (k === "flashcards") return ["Quick review 10", "Add harder cards"];
      if (k === "note") return ["Explain in 3 lines", "Turn into flashcards", "Find related"];
      if (k === "reading") return ["Summarize", "Extract key terms", "Make flashcards"];
      return ["Summarize", "Find related", "Turn into flashcards"];
    }
    if (workspace) return [`Plan ${workspace.name} this week`, `What's urgent in ${workspace.name}?`, "Start a new note"];
    return ["Plan my exam week", "Cram session", "What should I do next?"];
  };
  const suggestions = suggestionsFor();

  const placeholder = (() => {
    if (selectedCount > 1) return `Ask about ${selectedCount} items…`;
    if (focusedItem) return `Ask about "${focusedItem.title.slice(0, 32)}…"`;
    if (bloomedCount > 1) return `Ask across ${bloomedCount} open items…`;
    if (workspace) return `Ask, act, or create in ${workspace.name}…`;
    return "Ask anything, or /command…";
  })();

  return (
    <div className="absolute left-1/2 -translate-x-1/2 bottom-5 z-40 pointer-events-auto w-[min(720px,92vw)]">
      {/* Result island — compact single-row (~32px) */}
      {resultIsland && (
        <div
          className="sv2-result-in mb-2 rounded-full pl-2.5 pr-2 h-8 flex gap-2 items-center sv2-island"
          style={{ fontSize: "12px" }}
        >
          {resultIsland.status === "streaming" ? (
            <span
              className="inline-block w-2 h-2 rounded-full shrink-0 sv2-breathe"
              style={{ background: "linear-gradient(135deg, var(--accent), var(--mint))" }}
            />
          ) : (
            <div
              className="w-3.5 h-3.5 rounded-full flex items-center justify-center shrink-0"
              style={{ background: "linear-gradient(135deg, var(--accent), var(--mint))" }}
            >
              <Icon name="sparkle" size={8} stroke="#fff" />
            </div>
          )}
          <span
            className="text-[12px] leading-none truncate flex-1 min-w-0"
            style={{ color: "var(--ink-100)" }}
            title={resultIsland.text}
          >
            {resultIsland.text}
          </span>
          {resultIsland.chips && resultIsland.chips.length > 0 && (
            <div className="hidden sm:flex gap-1 items-center shrink-0">
              {resultIsland.chips.slice(0, 2).map((c, i) => (
                <span
                  key={i}
                  className="font-mono text-[9px] uppercase tracking-[0.12em] px-1.5 py-0.5 rounded-full"
                  style={{ color: "var(--ink-300)", border: "1px solid var(--line)" }}
                >
                  {c}
                </span>
              ))}
            </div>
          )}
          <button
            onClick={onDismissResult}
            className="w-5 h-5 rounded-full flex items-center justify-center shrink-0"
            style={{ color: "var(--ink-400)" }}
            title="Dismiss"
          >
            <Icon name="close" size={10} />
          </button>
        </div>
      )}

      {/* Context chips */}
      {(focusedItem || selectedCount > 0 || bloomedCount > 0) && (
        <div className="flex items-center gap-1.5 mb-2 px-1">
          {selectedCount > 0 ? (
            <div className="sv2-chip" style={{ color: "var(--accent)", borderColor: "var(--accent)" }}>
              <div className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--accent)" }} />
              {selectedCount} selected
            </div>
          ) : focusedItem ? (
            <>
              <span className="font-mono text-[9.5px] uppercase tracking-[0.14em]" style={{ color: "var(--ink-400)" }}>
                acting on
              </span>
              <div className="sv2-chip">
                <span style={{ color: focusedItem.color }}>
                  <Icon name={KIND_META[focusedItem.kind].icon} size={10} />
                </span>
                {focusedItem.title}
              </div>
            </>
          ) : (
            <div className="sv2-chip" style={{ color: "var(--accent)", borderColor: "var(--accent)" }}>
              <div className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--accent)" }} />
              {bloomedCount} open
            </div>
          )}
        </div>
      )}

      {/* Quick-starts panel */}
      {showQS && focused && (
        <div className="mb-2 sv2-island rounded-xl p-2 sv2-drift-in">
          <div className="font-mono text-[9.5px] uppercase tracking-[0.16em] px-2 py-1" style={{ color: "var(--ink-400)" }}>
            Quick starts
          </div>
          <div className="grid grid-cols-2 gap-1">
            {quickStarts.map((q) => (
              <button
                key={q.id}
                onMouseDown={() => { onSubmit(q.title); setShowQS(false); setValue(""); }}
                className="text-left p-2 rounded-lg flex gap-2 items-start transition-colors hover:bg-[var(--bg2)]"
              >
                <div className="w-1 rounded-full mt-0.5 shrink-0" style={{ background: q.tone, width: 3, minHeight: 24 }} />
                <div>
                  <div className="text-[12px]" style={{ color: "var(--ink-100)" }}>{q.title}</div>
                  <div className="text-[10.5px]" style={{ color: "var(--ink-400)" }}>{q.blurb}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Input */}
      <div
        className={`sv2-island ${focused ? "active" : ""} rounded-full px-3 py-2 flex items-center gap-2.5 transition-all`}
      >
        <button
          onClick={() => setShowQS((v) => !v)}
          className="shrink-0"
          style={{ color: "var(--accent)" }}
          title="Quick starts"
        >
          <Icon name="sparkle" size={13} />
        </button>
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => { setFocused(false); setShowQS(false); }, 180)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && value.trim()) {
              onSubmit(value);
              setValue("");
            }
          }}
          placeholder={placeholder}
          className="flex-1 bg-transparent outline-none text-[13.5px]"
          style={{ color: "var(--ink-100)" }}
        />
        <span className="sv2-kbd">⌘K</span>
        <button
          onClick={() => { if (value.trim()) { onSubmit(value); setValue(""); } }}
          className="w-6 h-6 rounded-full flex items-center justify-center shrink-0"
          style={{
            background: value.trim() ? "var(--accent)" : "var(--bg2)",
            color: value.trim() ? "#fff" : "var(--ink-400)",
          }}
        >
          <Icon name="arrow-rt" size={11} />
        </button>
      </div>

      {focused && !showQS && (
        <div className="mt-2 flex gap-1.5 flex-wrap px-1">
          {suggestions.map((s, i) => (
            <button
              key={i}
              onMouseDown={() => onSubmit(s)}
              className="sv2-chip sv2-breathe"
              style={{ animationDelay: `${i * 160}ms`, cursor: "pointer" }}
            >
              <Icon name="sparkle" size={9} /> {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── Spotlight (⌘K) ─── */

export function Spotlight({
  open, onClose, items, territories, quickStarts, onPick,
}: {
  open: boolean;
  onClose: () => void;
  items: V2Item[];
  territories: V2Territory[];
  quickStarts: readonly QuickStart[];
  onPick: (sel:
    | { type: "workspace"; id: string }
    | { type: "item"; id: string }
    | { type: "ai"; query: string }
    | { type: "view"; mode: ViewMode }
    | { type: "quick"; title: string }) => void;
}) {
  const [q, setQ] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
    else setQ("");
  }, [open]);
  if (!open) return null;

  const qlc = q.toLowerCase();
  const itemHits = items.filter((i) => !qlc || i.title.toLowerCase().includes(qlc) || i.preview?.toLowerCase().includes(qlc)).slice(0, 5);
  const wsHits = territories.filter((w) => !qlc || w.name.toLowerCase().includes(qlc)).slice(0, 4);
  const qsHits = quickStarts.filter((s) => !qlc || s.title.toLowerCase().includes(qlc)).slice(0, 4);
  const viewHits: { id: ViewMode; label: string }[] = ([
    { id: "spatial" as ViewMode, label: "Switch to Spatial view" },
    { id: "type" as ViewMode, label: "Switch to Type view" },
    { id: "topic" as ViewMode, label: "Switch to Topic view" },
    { id: "timeline" as ViewMode, label: "Switch to Timeline view" },
  ]).filter((v) => !qlc || v.label.toLowerCase().includes(qlc)).slice(0, 4);
  const aiSug = q.trim() ? [{ text: `Ask AI: "${q}"` }] : [];

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center pt-[14vh]"
         style={{ background: "rgba(0,0,0,0.35)", backdropFilter: "blur(4px)" }}
         onClick={onClose}>
      <div
        className="w-[min(640px,92vw)] rounded-2xl overflow-hidden"
        style={{ background: "var(--paper)", border: "1px solid var(--line)", boxShadow: "0 30px 80px -20px rgba(7,20,35,0.3)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4 py-3" style={{ borderBottom: "1px solid var(--line)" }}>
          <Icon name="search" size={16} style={{ color: "var(--ink-300)" }} />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search items, workspaces, views, or ask AI…"
            className="flex-1 bg-transparent outline-none text-[15px]"
            style={{ color: "var(--ink-100)" }}
          />
          <span className="sv2-kbd">esc</span>
        </div>
        <div className="max-h-[52vh] overflow-y-auto sv2-slim p-2">
          {aiSug.length > 0 && (
            <SpotGroup label="AI">
              {aiSug.map((s, i) => (
                <SpotRow
                  key={i}
                  icon={
                    <div className="w-7 h-7 rounded-full flex items-center justify-center"
                         style={{ background: "linear-gradient(135deg, var(--accent), var(--mint))" }}>
                      <Icon name="sparkle" size={12} stroke="#fff" />
                    </div>
                  }
                  title={s.text}
                  onClick={() => { onPick({ type: "ai", query: q }); onClose(); }}
                />
              ))}
            </SpotGroup>
          )}
          {qsHits.length > 0 && (
            <SpotGroup label="Quick starts">
              {qsHits.map((s) => (
                <SpotRow
                  key={s.id}
                  icon={
                    <div className="w-7 h-7 rounded-lg flex items-center justify-center"
                         style={{ background: `${s.tone}18`, color: s.tone }}>
                      <Icon name="sparkle" size={12} />
                    </div>
                  }
                  title={s.title}
                  sub={s.blurb}
                  onClick={() => { onPick({ type: "quick", title: s.title }); onClose(); }}
                />
              ))}
            </SpotGroup>
          )}
          {viewHits.length > 0 && (
            <SpotGroup label="Views">
              {viewHits.map((v) => (
                <SpotRow
                  key={v.id}
                  icon={
                    <div className="w-7 h-7 rounded-lg flex items-center justify-center"
                         style={{ background: "var(--bg2)", color: "var(--ink-300)" }}>
                      <Icon
                        name={v.id === "spatial" ? "layout" : v.id === "type" ? "grid" : v.id === "topic" ? "topic" : "timeline"}
                        size={12}
                      />
                    </div>
                  }
                  title={v.label}
                  onClick={() => { onPick({ type: "view", mode: v.id }); onClose(); }}
                />
              ))}
            </SpotGroup>
          )}
          {wsHits.length > 0 && (
            <SpotGroup label="Workspaces">
              {wsHits.map((w) => (
                <SpotRow
                  key={w.id}
                  icon={
                    <div className="w-7 h-7 rounded-lg flex items-center justify-center"
                         style={{ background: `${w.color}18`, color: w.color }}>
                      <span className="font-display text-[13px]">{w.glyph}</span>
                    </div>
                  }
                  title={w.name}
                  sub={w.subtitle}
                  onClick={() => { onPick({ type: "workspace", id: w.id }); onClose(); }}
                />
              ))}
            </SpotGroup>
          )}
          {itemHits.length > 0 && (
            <SpotGroup label="Items">
              {itemHits.map((it) => (
                <SpotRow
                  key={it.id}
                  icon={
                    <div className="w-7 h-7 rounded-lg flex items-center justify-center"
                         style={{ background: `${it.color}18`, color: it.color }}>
                      <Icon name={KIND_META[it.kind].icon} size={13} />
                    </div>
                  }
                  title={it.title}
                  sub={it.preview?.slice(0, 70)}
                  onClick={() => { onPick({ type: "item", id: it.id }); onClose(); }}
                />
              ))}
            </SpotGroup>
          )}
          {itemHits.length === 0 && wsHits.length === 0 && qsHits.length === 0 && !q && (
            <div className="px-3 py-4 text-[12.5px]" style={{ color: "var(--ink-300)" }}>
              <div className="font-mono text-[9.5px] uppercase tracking-[0.16em] mb-2" style={{ color: "var(--ink-400)" }}>Try</div>
              <div>&ldquo;plan my exam week&rdquo;</div>
              <div>&ldquo;search &lt;term&gt;&rdquo;</div>
              <div>&ldquo;/note Quick thought&rdquo;</div>
            </div>
          )}
        </div>
        <div className="px-4 py-2 text-[10.5px] font-mono flex gap-3"
             style={{ borderTop: "1px solid var(--line)", color: "var(--ink-400)" }}>
          <span><span className="sv2-kbd">↑↓</span> navigate</span>
          <span><span className="sv2-kbd">⏎</span> open</span>
          <span className="ml-auto">Spotlight</span>
        </div>
      </div>
    </div>
  );
}

function SpotGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-2">
      <div className="px-2 py-1 font-mono text-[9px] uppercase tracking-[0.16em]" style={{ color: "var(--ink-400)" }}>
        {label}
      </div>
      {children}
    </div>
  );
}

function SpotRow({
  icon, title, sub, onClick,
}: {
  icon: React.ReactNode;
  title: string;
  sub?: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 px-2 py-2 rounded-lg text-left transition-colors hover:bg-[var(--bg2)]"
    >
      {icon}
      <div className="flex-1 min-w-0">
        <div className="text-[13px] truncate" style={{ color: "var(--ink-100)" }}>{title}</div>
        {sub && <div className="text-[11px] truncate" style={{ color: "var(--ink-400)" }}>{sub}</div>}
      </div>
    </button>
  );
}

/* ─── Tray (multi-select actions) ─── */

type TrayProps = {
  open: boolean;
  items: V2Item[];
  pinned: V2Item[];
  onClose: () => void;
  onRemove: (id: string) => void;
  onAction: (action: "bloom" | "compare" | "merge" | "quiz" | "link" | "ask") => void;
};

export function Tray({ open, items, pinned, onClose, onRemove, onAction }: TrayProps) {
  if (!open) return null;
  return (
    <div className="absolute left-1/2 -translate-x-1/2 bottom-24 z-30 pointer-events-auto">
      <div
        className="sv2-island rounded-2xl px-3 py-3 min-w-[620px] max-w-[85vw] sv2-drift-in"
      >
        <div className="flex items-center justify-between mb-2 px-1">
          <div className="flex items-center gap-2">
            <Icon name="tray" size={13} style={{ color: "var(--ink-300)" }} />
            <span className="font-mono text-[10px] uppercase tracking-[0.16em]" style={{ color: "var(--ink-300)" }}>
              Working tray
            </span>
            <span className="font-mono text-[10px]" style={{ color: "var(--ink-400)" }}>
              {items.length + pinned.length} queued
            </span>
          </div>
          <button
            onClick={onClose}
            className="w-5 h-5 rounded-full flex items-center justify-center"
            style={{ color: "var(--ink-400)" }}
          >
            <Icon name="close" size={11} />
          </button>
        </div>
        {items.length > 0 && (
          <div className="mb-2">
            <div className="flex items-center gap-2 flex-wrap mb-2">
              {items.map((it) => (
                <div
                  key={it.id}
                  className="group flex items-center gap-2 pl-2 pr-1.5 py-1 rounded-full"
                  style={{ background: "rgba(237,233,227,0.6)", border: "1px solid var(--line)" }}
                >
                  <span style={{ color: it.color }}>
                    <Icon name={KIND_META[it.kind].icon} size={10} />
                  </span>
                  <span className="text-[11.5px] max-w-[140px] truncate" style={{ color: "var(--ink-200)" }}>
                    {it.title}
                  </span>
                  <button
                    onClick={() => onRemove(it.id)}
                    className="w-4 h-4 rounded-full flex items-center justify-center"
                    style={{ color: "var(--ink-400)" }}
                  >
                    <Icon name="close" size={9} />
                  </button>
                </div>
              ))}
            </div>
            <div className="flex gap-1.5 flex-wrap">
              {([
                { action: "bloom", label: "Open side-by-side", icon: "layout" },
                { action: "compare", label: "Compare", icon: "compare" },
                { action: "merge", label: "Merge", icon: "merge" },
                { action: "quiz", label: "Quiz me", icon: "quiz-me" },
                { action: "link", label: "Link", icon: "link" },
              ] as const).map(({ action, label, icon }) => (
                <button
                  key={action}
                  onClick={() => onAction(action)}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg transition-colors"
                  style={{ background: "var(--paper)", border: "1px solid var(--line)", color: "var(--ink-300)" }}
                >
                  <Icon name={icon} size={12} />
                  <span className="text-[11px] font-mono uppercase tracking-[0.1em]">{label}</span>
                </button>
              ))}
              <button
                onClick={() => onAction("ask")}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg"
                style={{ background: "var(--accent)", border: "1px solid var(--accent)", color: "#fff" }}
              >
                <Icon name="sparkle" size={12} />
                <span className="text-[11px] font-mono uppercase tracking-[0.1em]">Ask about these</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Zoom control (bottom-left) ─── */

export function ZoomControl({ zoom, onZoom, onReset }: { zoom: number; onZoom: (factor: number) => void; onReset: () => void }) {
  return (
    <div className="absolute bottom-4 left-4 z-30 pointer-events-auto">
      <div
        className="rounded-full px-1 py-1 flex items-center gap-0.5"
        style={{ background: "rgba(251,250,246,0.92)", border: "1px solid var(--line)", backdropFilter: "blur(8px)" }}
      >
        <button
          onClick={() => onZoom(0.90)}
          className="w-7 h-7 rounded-full flex items-center justify-center"
          style={{ color: "var(--ink-300)" }}
          title="Zoom out"
        >
          <Icon name="zoom-out" size={13} />
        </button>
        <div className="font-mono text-[10.5px] tabular-nums w-10 text-center" style={{ color: "var(--ink-200)" }}>
          {Math.round(zoom * 100)}%
        </div>
        <button
          onClick={() => onZoom(1.10)}
          className="w-7 h-7 rounded-full flex items-center justify-center"
          style={{ color: "var(--ink-300)" }}
        >
          <Icon name="zoom-in" size={13} />
        </button>
        <div className="w-px h-4 mx-0.5" style={{ background: "var(--line)" }} />
        <button
          onClick={onReset}
          className="px-2 h-7 rounded-full text-[10px] font-mono uppercase tracking-[0.12em]"
          style={{ color: "var(--ink-300)" }}
        >
          Reset
        </button>
      </div>
    </div>
  );
}

/* ─── Info panel (shortcuts) ─── */

export function InfoPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  const rows: [string, string][] = [
    ["Scroll", "Pan canvas (trackpad-friendly)"],
    ["⌘/Ctrl + Scroll", "Zoom to cursor"],
    ["Shift + Scroll", "Horizontal pan (or zoom on mouse)"],
    ["Space", "Bloom (open) focused item"],
    ["Double-click", "Bloom an item"],
    ["Tab / Shift-Tab", "Cycle focus between items"],
    ["⌘K", "Spotlight — jump to anything"],
    ["1 · 2 · 3 · 4", "Switch view mode"],
    ["Hover map", "Fly to that area"],
    ["Click map", "Commit camera to that point"],
    ["Esc", "Close bloom / tray / spotlight"],
    ["W", "Toggle widgets"],
    ["+ / −", "Zoom in / out gently"],
  ];
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.35)", backdropFilter: "blur(4px)" }}
      onClick={onClose}
    >
      <div
        className="w-[min(520px,92vw)] rounded-2xl p-6"
        style={{ background: "var(--paper)", border: "1px solid var(--line)", boxShadow: "0 30px 80px -20px rgba(7,20,35,0.3)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.16em]" style={{ color: "var(--ink-400)" }}>Spectra · Guide</div>
            <div className="font-display text-[24px] mt-1" style={{ color: "var(--ink-100)" }}>Shortcuts & gestures</div>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-full flex items-center justify-center"
            style={{ border: "1px solid var(--line)", color: "var(--ink-400)" }}
          >
            <Icon name="close" size={12} />
          </button>
        </div>
        <div className="space-y-1">
          {rows.map(([k, v]) => (
            <div key={k} className="flex items-center justify-between py-1.5"
                 style={{ borderBottom: "1px solid rgba(221,216,207,0.5)" }}>
              <span className="sv2-kbd">{k}</span>
              <span className="text-[12.5px]" style={{ color: "var(--ink-200)" }}>{v}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
