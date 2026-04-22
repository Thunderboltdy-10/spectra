"use client";

import { useEffect, useRef, useState } from "react";
import { Icon, type IconName } from "./icons";
import { QuickChat } from "@/components/shared/quick-chat";
import type { RouteTrace } from "@/types";
import type { V2Item, V2Territory, QuickStart } from "./data";
import { KIND_META } from "./data";

/* ─────────────────────────────────────────────────────────────
 *  Unified TopRail — single bar: identity | workspace picker | view modes | guide
 * ───────────────────────────────────────────────────────────── */

export type ViewMode = "type" | "topic" | "timeline";

type TopRailProps = {
  workspace: V2Territory | null;
  zoom: number;
  viewMode: ViewMode;
  theme: "light" | "dark";
  onViewMode: (m: ViewMode) => void;
  onHome: () => void;
  onAtlas: () => void;
  onSpotlight?: () => void;
  onToggleTheme: () => void;
  onOpenInfo: () => void;
  territories?: V2Territory[];
  currentWorkspaceId?: string | null;
  onPickWorkspace?: (id: string) => void;
  onCreateWorkspace?: () => void;
  onRenameWorkspace?: (id: string, name: string) => void;
};

export function TopRail({
  workspace, viewMode,
  onViewMode, onHome,
  onOpenInfo,
  territories, currentWorkspaceId, onPickWorkspace, onCreateWorkspace, onRenameWorkspace,
}: TopRailProps) {
  const [editingWorkspaceId, setEditingWorkspaceId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const modes: { id: ViewMode; label: string; icon: IconName }[] = [
    { id: "topic",    label: "Topic",    icon: "topic"    },
    { id: "type",     label: "Type",     icon: "grid"     },
    { id: "timeline", label: "Timeline", icon: "timeline" },
  ];

  return (
    <div className="absolute top-[6px] left-0 right-0 z-30 pointer-events-none">
      {/* Single unified bar — h-14 = 56px */}
      <div className="mx-auto max-w-[1800px] px-3 h-14 flex items-center gap-2">
        {/* LEFT: home button + Spectra label + workspace identity */}
        <div className="flex items-center gap-2 pointer-events-auto flex-1 justify-start min-w-0">
          <button
            onClick={onHome}
            className="w-9 h-9 rounded-xl flex items-center justify-center transition-colors hover:bg-[var(--bg2)]"
            title="Home (zoom out)"
          >
            <Icon name="home" size={20} style={{ color: "var(--ink-300)" }} />
          </button>
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] opacity-75 hidden sm:block" style={{ color: "var(--ink-400)" }}>
            Spectra
          </span>
          <div className="flex items-center gap-2 min-w-[220px]">
            {workspace ? (
              <>
              <Icon name="chevron" size={11} className="opacity-40" style={{ color: "var(--ink-400)" }} />
              <span className="text-[16px] leading-none">{workspace?.glyph ?? "◌"}</span>
              {editingWorkspaceId === workspace.id ? (
                <input
                  value={draftName}
                  autoFocus
                  onChange={(e) => setDraftName(e.target.value)}
                  onBlur={() => {
                    const next = draftName.trim();
                    if (next) onRenameWorkspace?.(workspace.id, next);
                    setEditingWorkspaceId(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
                    if (e.key === "Escape") setEditingWorkspaceId(null);
                  }}
                  className="font-display text-[22px] font-medium leading-none bg-transparent outline-none min-w-[140px]"
                  style={{ color: "var(--ink-100)" }}
                />
              ) : (
                <button
                  onDoubleClick={() => {
                    setEditingWorkspaceId(workspace.id);
                    setDraftName(workspace.name);
                  }}
                  className="font-display text-[22px] font-medium leading-none text-left truncate"
                  style={{ color: "var(--ink-100)" }}
                  title="Double-click to rename workspace"
                >
                  {workspace?.name ?? "Workspace"}
                </button>
              )}
              {(workspace?.subtitle ?? "Subtitle") && (
                <span className="text-[12px] font-mono opacity-55 ml-0.5 hidden md:block" style={{ color: "var(--ink-400)" }}>
                  {workspace?.subtitle ?? "Subtitle"}
                </span>
              )}
              </>
            ) : (
              <div className="h-8" />
            )}
          </div>
        </div>

        {/* CENTER: workspace picker */}
        <div className="flex justify-center pointer-events-auto shrink-0">
          {territories && territories.length > 0 && (
            <div
              className="flex items-center gap-0.5 p-1 rounded-full"
              style={{
                background: "rgba(251,250,246,0.88)",
                border: "1px solid var(--line)",
                backdropFilter: "blur(12px) saturate(1.05)",
              }}
            >
              {territories.map((w) => (
                <button
                  key={w.id}
                  onClick={() => onPickWorkspace?.(w.id)}
                  className="px-3 py-1.5 rounded-full flex items-center gap-1.5 transition-all duration-200 text-[11px] font-medium"
                  style={{
                    background: currentWorkspaceId === w.id ? "var(--accent)" : "transparent",
                    color: currentWorkspaceId === w.id ? "#fff" : "var(--ink-200)",
                    boxShadow: currentWorkspaceId === w.id ? "0 2px 8px rgba(14,142,232,0.28)" : "none",
                  }}
                >
                  <span className="text-[13px] leading-none">{w.glyph}</span>
                  <span>{w.name}</span>
                </button>
              ))}
              {onCreateWorkspace && (
                <>
                  <div className="w-px h-5 mx-0.5" style={{ background: "var(--line)" }} />
                  <button
                    onClick={onCreateWorkspace}
                    className="px-2 py-1.5 rounded-full transition-colors hover:bg-[var(--bg2)]"
                    style={{ color: "var(--ink-400)" }}
                    title="New workspace"
                  >
                    <Icon name="plus" size={12} />
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        {/* RIGHT: view mode pills (teal when active) + info button */}
        <div className="flex items-center gap-2 pointer-events-auto flex-1 justify-end">
          <div
            className="flex items-center p-[3px] rounded-full"
            style={{ border: "1px solid var(--line)", background: "var(--paper)", backdropFilter: "blur(8px)" }}
          >
            {modes.map((m, i) => (
              <button
                key={m.id}
                onClick={() => onViewMode(m.id)}
                className="px-3 h-7 rounded-full flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-[0.1em] transition-all duration-150"
                style={{
                  background: viewMode === m.id ? "var(--mint)" : "transparent",
                  color: viewMode === m.id ? "#fff" : "var(--ink-300)",
                }}
                title={`${m.id} view (${i + 1})`}
              >
                <Icon name={m.icon} size={11} />
                <span className="hidden sm:inline">{m.label}</span>
              </button>
            ))}
          </div>

          <button
            onClick={onOpenInfo}
            className="w-8 h-8 rounded-full flex items-center justify-center transition-all hover:bg-[var(--bg2)] shadow-sm"
            style={{ border: "1px solid var(--line)", background: "var(--paper)", color: "var(--ink-300)" }}
            title="Shortcuts & guide (⌘/)"
          >
            <Icon name="info" size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── WidgetLauncher — Edge Launcher Model ─── */
export function WidgetLauncher({
  widgetsHidden, onToggleWidgets, onAddWidget
}: {
  widgetsHidden: boolean;
  onToggleWidgets: () => void;
  onAddWidget: (kind: string) => void;
}) {
  const addables: { kind: string; label: string; icon: IconName }[] = [
    { kind: "timer", label: "Focus timer", icon: "timer" },
    { kind: "planner", label: "Week planner", icon: "planner" },
    { kind: "today", label: "Today queue", icon: "schedule" },
    { kind: "scratch", label: "Scratchpad", icon: "note" },
    { kind: "library", label: "Library", icon: "reading" },
    { kind: "calendar", label: "Calendar", icon: "schedule" },
    { kind: "thread", label: "Chat Thread", icon: "thread" },
    { kind: "artifact", label: "New Artifact", icon: "note" },
  ];

  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const handleGlobalClick = (e: MouseEvent) => {
      const el = e.target as HTMLElement;
      if (!el.closest(".widget-launcher-container")) {
        setExpanded(false);
      }
    };
    if (expanded) {
      document.addEventListener("mousedown", handleGlobalClick);
    }
    return () => document.removeEventListener("mousedown", handleGlobalClick);
  }, [expanded]);

  return (
    <div className="absolute top-[110px] right-4 z-30 pointer-events-auto flex flex-col items-end gap-2 widget-launcher-container">
      <button
        onClick={() => {
          if (widgetsHidden) onToggleWidgets();
          setExpanded((v) => !v);
        }}
        className="h-10 px-3 rounded-xl flex items-center gap-2 shadow-sm transition-all hover:shadow-md"
        style={{
          border: `1px solid ${expanded ? "var(--accent)" : "var(--line)"}`,
          background: "var(--paper)",
          color: expanded ? "var(--accent)" : "var(--ink-300)",
          backdropFilter: "blur(8px)",
        }}
      >
        <Icon name="widget" size={14} />
        <span className="text-[11px] font-mono uppercase tracking-[0.1em] font-medium">Widgets</span>
      </button>

      {expanded && (
        <div 
          className="rounded-xl flex flex-col gap-1 p-1.5 sv2-drift-in shadow-md"
          style={{ background: "var(--paper)", border: "1px solid var(--line)" }}
        >
          <button
            onClick={onToggleWidgets}
            className="w-full text-left p-2 rounded-lg flex items-center gap-2 text-[12px] hover:bg-[var(--bg2)] transition-colors"
            style={{ color: "var(--ink-200)" }}
          >
            <Icon name={widgetsHidden ? "expand" : "collapse"} size={12} />
            {widgetsHidden ? "Show active widgets" : "Hide active widgets"}
          </button>
          <div className="h-px w-full my-0.5 opacity-50" style={{ background: "var(--line)" }} />
          {addables.map((a) => (
            <button
              key={a.kind}
              onClick={() => { onAddWidget(a.kind); if(widgetsHidden) onToggleWidgets(); }}
              className="w-full text-left p-2 rounded-lg flex items-center gap-2.5 text-[12px] hover:bg-[var(--bg2)] transition-colors group"
              style={{ color: "var(--ink-200)" }}
              title={`Add ${a.label}`}
            >
              <div className="w-6 h-6 rounded flex items-center justify-center bg-[var(--bg2)] group-hover:bg-transparent transition-colors">
                <Icon name={a.icon} size={12} style={{ color: "var(--ink-400)" }} className="group-hover:text-[var(--accent)] transition-colors" />
              </div>
              <span className="font-medium whitespace-nowrap pr-2">{a.label}</span>
            </button>
          ))}
        </div>
      )}
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
    <div className="absolute top-[44px] left-1/2 -translate-x-1/2 z-20 pointer-events-auto">
      <div className="flex items-center gap-1 p-1 rounded-full shadow-sm"
           style={{ background: "rgba(251,250,246,0.88)", border: "1px solid var(--line)", backdropFilter: "blur(12px) saturate(1.05)" }}>
        {territories.map((w) => (
          <button
            key={w.id}
            onClick={() => onPick(w.id)}
            className="px-3 py-1.5 rounded-full flex items-center gap-1.5 transition-all duration-200"
            style={{
              background: current === w.id ? "var(--ink-300)" : "transparent",
              border: `1px solid ${current === w.id ? "var(--ink-300)" : "transparent"}`,
              boxShadow: current === w.id ? "0 2px 6px rgba(26,21,16,0.08)" : "none",
            }}
          >
            <span className="text-[13px]">{w.glyph}</span>
            <span className="text-[11px]" style={{ color: current === w.id ? "var(--paper)" : "var(--ink-200)", fontWeight: current === w.id ? 600 : 500 }}>{w.name}</span>
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
 *  Minimap — click to arm, click to commit
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
  const [activePan, setActivePan] = useState(false);

  const toWorld = (e: React.MouseEvent | MouseEvent) => {
    const rect = mapRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    const mx = e.clientX - rect.left - ox;
    const my = e.clientY - rect.top - oy;
    return { x: mx / scale, y: my / scale };
  };

  return (
    <div className="absolute bottom-4 right-4 z-30 pointer-events-auto">
      <div className={`rounded-xl p-2 transition-all ${activePan ? "shadow-lg scale-[1.02]" : "shadow-sm"}`}
           style={{ 
             background: activePan ? "var(--paper)" : "rgba(251,250,246,0.94)", 
             border: `1px solid ${activePan ? "var(--accent)" : "var(--line)"}`, 
             backdropFilter: "blur(10px)",
           }}>
        <div className="flex items-center justify-between mb-1.5 px-1 gap-2">
          <span className="font-mono text-[9px] uppercase tracking-[0.16em] flex items-center gap-1" style={{ color: activePan ? "var(--accent)" : "var(--ink-400)" }}>
            {activePan ? <><span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-pulse" /> Active pan</> : "Map · click to pan"}
          </span>
          <div className="flex items-center gap-0.5">
            <button
              onClick={(e) => { e.stopPropagation(); onWheelZoom(-80, 0, 0); }}
              className="w-4 h-4 rounded flex items-center justify-center hover:bg-[var(--bg2)] transition-colors"
              style={{ color: "var(--ink-400)", border: "1px solid var(--line)" }}
              title="Zoom out"
            >
              <Icon name="minus" size={8} />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onWheelZoom(80, 0, 0); }}
              className="w-4 h-4 rounded flex items-center justify-center hover:bg-[var(--bg2)] transition-colors"
              style={{ color: "var(--ink-400)", border: "1px solid var(--line)" }}
              title="Zoom in"
            >
              <Icon name="plus" size={8} />
            </button>
            <span className="font-mono text-[9px] ml-1 font-medium" style={{ color: "var(--ink-400)" }}>{items.length}</span>
          </div>
        </div>
        <div
          ref={mapRef}
          className="relative transition-colors sv2-grid"
          style={{ width: W, height: H, background: activePan ? "var(--paper)" : "var(--paper-deep)", borderRadius: 8, cursor: activePan ? "crosshair" : "pointer", overflow: "hidden" }}
          onMouseMove={(e) => {
            if (!activePan) return;
            const p = toWorld(e);
            onHoverPan(p.x, p.y);
          }}
          onClick={(e) => {
            if (activePan) {
              setActivePan(false);
              const p = toWorld(e);
              onCommitPan(p.x, p.y);
            } else {
              setActivePan(true);
              const p = toWorld(e);
              onHoverPan(p.x, p.y);
            }
          }}
          onWheel={(e) => {
            if (!e.shiftKey) return;
            e.preventDefault();
            onWheelZoom(-e.deltaY, 0, 0);
          }}
          title="Click to activate pan · click again to release · shift+scroll to zoom"
        >
          {territories.map((w) => (
            <div
              key={w.id}
              onDoubleClick={(e) => { e.stopPropagation(); onWorkspaceClick(w.id); }}
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
  /** pending = queued, not started yet · running = in-progress (streaming) · done = completed · error = failed */
  status: "pending" | "streaming" | "running" | "done" | "error";
  text: string;
  chips?: string[];
  action?: { label: string; onClick: () => void };
  /** Execution trace for showing timeline steps during streaming/running */
  routeTrace?: RouteTrace;
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
  isProcessing?: boolean;
  isStreaming?: boolean;
  onStop?: () => void;
  /** Opens the Spotlight (⌘K) overlay from the search icon inside the bar. */
  onSpotlight?: () => void;
  /** Creates an item at camera center. Called from the + inline menu. */
  onCreate?: (kind: "note" | "task" | "thread" | "visual" | "code") => void;
  /** Clears the focus context (closes inspector or focus set). */
  onClearFocusContext?: () => void;
  /** Focused-context: shows a chip in the bar indicating active context. */
  focusContext?: {
    kind: "artifact" | "thread" | "selection" | "focused-view" | "building-set";
    title: string;
    color: string;
    count?: number;
  } | null;
};

/* Creation menu items — shared with right-click context menu in app.tsx */
export const CREATION_MENU_ITEMS = [
  { kind: "note"   as const, label: "New note",   icon: "note"     as const },
  { kind: "task"   as const, label: "New task",   icon: "schedule" as const },
  { kind: "thread" as const, label: "New thread", icon: "thread"   as const },
  { kind: "visual" as const, label: "New visual", icon: "layers"   as const },
  { kind: "code"   as const, label: "New code",   icon: "pset"     as const },
];

export function CommandBar({
  focusedItem, workspace, selectedCount,
  resultIsland, onSubmit, onDismissResult, isProcessing = false,
  isStreaming = false, onStop,
  onSpotlight, onCreate, onClearFocusContext, focusContext,
}: CommandBarProps) {
  const [value, setValue] = useState("");
  const [showCreateMenu, setShowCreateMenu] = useState(false);

  useEffect(() => {
    const handleCloseCreate = () => setShowCreateMenu(false);
    window.addEventListener("workspace:close-create-menu", handleCloseCreate);
    return () => window.removeEventListener("workspace:close-create-menu", handleCloseCreate);
  }, []);

  const placeholder = (() => {
    if (focusContext?.kind === "focused-view") return `Ask about ${focusContext.count ?? 1} items in focus…`;
    if (focusContext?.kind === "building-set") return `Building set · ${focusContext.count ?? 0} items…`;
    if (focusContext?.kind === "thread") return `Ask about thread "${focusContext.title.slice(0, 28)}…"`;
    if (focusContext?.kind === "artifact") return `Ask about "${focusContext.title.slice(0, 28)}…"`;
    if (selectedCount > 1) return `Ask about ${selectedCount} items…`;
    if (focusedItem) return `Ask about "${focusedItem.title.slice(0, 32)}…"`;
    if (workspace) return `Ask, act, or create in ${workspace.name}…`;
    return "Ask anything, or type /…";
  })();

  /* Island icon/class based on status */
  const islandStatusIcon = (status: NonNullable<ResultIsland>["status"]) => {
    if (status === "pending") return null; // dashed ring rendered below
    if (status === "running" || status === "streaming") return null; // breathing orb
    if (status === "done") return "sparkle" as const;
    return "close" as const; // error
  };

  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed || isProcessing || isStreaming) return;
    onSubmit(trimmed);
    setValue("");
  };

  return (
    <div className="absolute left-1/2 -translate-x-1/2 bottom-8 z-40 pointer-events-auto flex flex-col items-center max-w-[92vw]">
      {/* Result island — animated pill attachment with four honest states */}
      {resultIsland && (
        <div
          className={`sv2-result-in flex gap-2 items-center sv2-island mb-1.5 h-10 px-3
            ${resultIsland.status === "pending" ? "sv2-island-pending" : ""}
            ${resultIsland.status === "running" || resultIsland.status === "streaming" ? "sv2-island-running" : ""}
            ${resultIsland.status === "done" ? "sv2-island-done" : ""}
            ${resultIsland.status === "error" ? "sv2-island-error" : ""}
          `}
          style={{ fontSize: "12px", minWidth: "240px", maxWidth: "360px", borderRadius: "18px" }}
        >
          {/* Status indicator */}
          {resultIsland.status === "pending" && (
            <span className="inline-block w-3 h-3 rounded-full shrink-0 sv2-pending-ring" />
          )}
          {(resultIsland.status === "running" || resultIsland.status === "streaming") && (
            <span
              className="inline-block w-2.5 h-2.5 rounded-full shrink-0 sv2-breathe"
              style={{ background: "linear-gradient(135deg, var(--accent), var(--mint))", boxShadow: "0 0 8px rgba(14,142,232,0.4)" }}
            />
          )}
          {(resultIsland.status === "done" || resultIsland.status === "error") && (
            <div
              className={`w-4 h-4 rounded-full flex items-center justify-center shrink-0 sv2-island-orb-in`}
              style={{ background: resultIsland.status === "error" ? "var(--coral)" : "linear-gradient(135deg, var(--accent), var(--mint))" }}
            >
              <Icon name={islandStatusIcon(resultIsland.status)!} size={10} stroke="#fff" />
            </div>
          )}

          <span
            className="text-[12.5px] font-medium truncate flex-1 min-w-0"
            style={{ color: "var(--ink-100)" }}
            title={resultIsland.text}
          >
            {resultIsland.text}
          </span>

          {/* Execution-aware chips — show route steps when streaming */}
          {resultIsland.routeTrace && (resultIsland.status === "running" || resultIsland.status === "streaming") && (
            <div className="flex items-center gap-1">
              {resultIsland.routeTrace.toolchain.slice(0, 3).map((tool) => (
                <span key={tool} className="sv2-chip" style={{ borderColor: "var(--accent)", color: "var(--accent)" }}>
                  {tool.replace(/_/g, " ")}
                </span>
              ))}
              {resultIsland.routeTrace.toolchain.length > 3 && (
                <span className="sv2-chip">+{resultIsland.routeTrace.toolchain.length - 3}</span>
              )}
            </div>
          )}
          {resultIsland.chips && resultIsland.chips.length > 0 && (!resultIsland.routeTrace || (resultIsland.status !== "running" && resultIsland.status !== "streaming")) && (
            <div className="flex items-center gap-1">
              {resultIsland.chips.map((chip) => (
                <span key={chip} className="sv2-chip">{chip}</span>
              ))}
            </div>
          )}

          {/* Action button — only when done */}
          {resultIsland.status === "done" && resultIsland.action && (
            <button
              onClick={resultIsland.action.onClick}
              className="hidden sm:flex items-center gap-1.5 shrink-0 px-2.5 py-1 rounded-md transition-colors shadow-sm ml-1 hover:shadow"
              style={{ background: "var(--accent)", color: "#fff" }}
            >
              <Icon name="sparkle" size={10} />
              <span className="font-mono text-[9.5px] uppercase tracking-[0.1em] font-medium">{resultIsland.action.label}</span>
            </button>
          )}

          <button
            onClick={onDismissResult}
            className="w-5 h-5 rounded-full flex items-center justify-center shrink-0 hover:bg-[var(--bg2)] transition-colors ml-1"
            style={{ color: "var(--ink-400)" }}
            title="Dismiss"
          >
            <Icon name="close" size={9} />
          </button>
        </div>
      )}

      

      <div className="flex items-end gap-2 w-[min(760px,calc(100vw-34px))]">
        <QuickChat
          value={value}
          onChange={setValue}
          onSubmit={submit}
          onStop={onStop}
          isStreaming={isStreaming}
          isProcessing={isProcessing}
          placeholder={placeholder}
          className="w-full min-w-0"
          leftContent={focusedItem && !value
            ? (
                <div className="hidden sm:flex sv2-chip shrink-0 opacity-70 h-6">
                  <Icon name={KIND_META[focusedItem.kind].icon} size={10} />
                  <span className="max-w-[72px] truncate">{focusedItem.title}</span>
                </div>
              )
            : null}
          rightContent={(
            <div className="flex items-center gap-1">
              {/* Plus button — opens inline creation menu */}
        <div className="relative shrink-0">
          <button
            onClick={() => setShowCreateMenu((v) => !v)}
            className="w-8 h-8 rounded-full flex items-center justify-center transition-colors hover:bg-[var(--bg2)] text-[var(--ink-400)] group"
            title="Create…"
          >
            <Icon name="plus" size={14} style={{ color: "var(--ink-400)" }} className="group-hover:text-[var(--ink-100)] transition-transform" />
          </button>
          {showCreateMenu && (
            <div
              className="absolute bottom-full mb-2 left-0 w-[180px] rounded-xl py-1.5 sv2-island sv2-drift-in shadow-xl"
              style={{ border: "1px solid var(--line)" }}
            >
              <div className="px-3 py-1 font-mono text-[9px] uppercase tracking-[0.16em]" style={{ color: "var(--ink-400)" }}>
                Create here
              </div>
              {CREATION_MENU_ITEMS.map((item) => (
                <button
                  key={item.kind}
                  onMouseDown={() => {
                    setShowCreateMenu(false);
                    onCreate?.(item.kind);
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-[12px] hover:bg-[var(--bg2)] transition-colors text-left"
                  style={{ color: "var(--ink-200)" }}
                >
                  <Icon name={item.icon} size={12} style={{ color: "var(--ink-400)" }} />
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
              <button
                onClick={() => { onSpotlight?.(); }}
                className="shrink-0 transition-opacity opacity-60 hover:opacity-100"
                style={{ color: "var(--ink-400)" }}
                title="Spotlight (⌘K)"
              >
                <Icon name="search" size={14} />
              </button>
              {focusContext && (
                <div className="hidden sm:flex items-center gap-1 shrink-0 px-2 h-6 rounded-full border text-[10px] font-mono"
                     style={{ background: `${focusContext.color}12`, borderColor: `${focusContext.color}30`, color: focusContext.color, maxWidth: 160 }}>
                  <span className="truncate max-w-[100px]">{focusContext.title}</span>
                  {focusContext.count != null && <span className="opacity-60">·{focusContext.count}</span>}
                  <button
                    onMouseDown={(e) => { e.preventDefault(); onClearFocusContext?.(); }}
                    className="ml-0.5 opacity-60 hover:opacity-100 transition-opacity"
                    title="Clear focus"
                  >
                    <Icon name="close" size={8} />
                  </button>
                </div>
              )}
            </div>
          )}
        />
      </div>
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
    { id: "topic" as ViewMode, label: "Switch to Topic view" },
    { id: "type" as ViewMode, label: "Switch to Type view" },
    { id: "timeline" as ViewMode, label: "Switch to Timeline view" },
  ]).filter((v) => !qlc || v.label.toLowerCase().includes(qlc)).slice(0, 4);
  const hasAnyHit = itemHits.length > 0 || wsHits.length > 0 || qsHits.length > 0 || viewHits.length > 0;
  const aiSug = q.trim() ? [{ text: `Ask AI: "${q}"` }] : [];

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center pt-[14vh]"
         style={{ background: "rgba(0,0,0,0.4)", backdropFilter: "blur(8px) saturate(1.1)" }}
         onClick={onClose}>
      <div
        className="w-[min(640px,92vw)] rounded-2xl overflow-hidden sv2-drift-in"
        style={{ background: "var(--paper)", border: "1px solid var(--line)", boxShadow: "0 32px 80px -20px rgba(26,21,16,0.28)" }}
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
            onKeyDown={(e) => {
              if (e.key === "Escape") { onClose(); return; }
              // Enter with no matching hits → submit as Ask AI directly
              if (e.key === "Enter" && q.trim() && !hasAnyHit) {
                e.preventDefault();
                onPick({ type: "ai", query: q });
                onClose();
              }
            }}
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
                        name={v.id === "type" ? "grid" : v.id === "topic" ? "topic" : "timeline"}
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
  onAction: (action: "ask" | "focus") => void;
};

export function Tray({ open, items, pinned, onClose, onRemove, onAction }: TrayProps) {
  const allItems = [...pinned, ...items.filter(i => !pinned.find(p => p.id === i.id))];
  // Only show tray when genuinely multi-selecting
  if (!open || allItems.length < 2) return null;

  return (
    <div className="absolute left-1/2 -translate-x-1/2 bottom-20 z-30 pointer-events-auto flex justify-center">
      <div
        className="sv2-island rounded-2xl p-2 max-w-[500px] sv2-drift-in flex flex-col gap-2 shadow-lg"
        style={{ border: "1px solid var(--accent)", background: "var(--paper)" }}
      >
        <div className="flex items-center justify-between px-2 pt-1 pb-0.5">
          <div className="flex items-center gap-1.5">
            <Icon name="tray" size={12} style={{ color: "var(--accent)" }} />
            <span className="font-mono text-[10px] uppercase tracking-[0.1em] font-medium" style={{ color: "var(--accent)" }}>
              {allItems.length} selected
            </span>
          </div>
          <button
            onClick={onClose}
            className="w-5 h-5 rounded-full flex items-center justify-center opacity-60 hover:opacity-100 transition-opacity"
            style={{ color: "var(--ink-400)", background: "var(--bg2)" }}
          >
            <Icon name="close" size={10} />
          </button>
        </div>
        
        <div className="flex flex-wrap gap-1.5 px-1 max-h-[80px] overflow-y-auto sv2-slim">
          {allItems.map((it) => (
            <div
              key={it.id}
              className="flex items-center gap-1.5 pl-2 pr-1 py-1 rounded-md"
              style={{ background: "var(--bg2)", border: "1px solid var(--line)" }}
            >
              <span style={{ color: it.color }}>
                <Icon name={KIND_META[it.kind].icon} size={10} />
              </span>
              <span className="text-[11px] max-w-[100px] truncate" style={{ color: "var(--ink-100)" }}>
                {it.title}
              </span>
              <button
                onClick={() => onRemove(it.id)}
                className="w-4 h-4 rounded-sm flex items-center justify-center hover:bg-black/5"
                style={{ color: "var(--ink-400)" }}
              >
                <Icon name="close" size={9} />
              </button>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-1 mt-1 border-t pt-2 px-1" style={{ borderColor: "var(--line)" }}>
          <button
            onClick={() => onAction("focus")}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md transition-colors hover:bg-[var(--bg2)]"
            style={{ color: "var(--ink-200)" }}
          >
            <Icon name="layout" size={11} />
            <span className="text-[10px] font-mono uppercase tracking-[0.05em]">Focus view</span>
            <span className="sv2-kbd text-[8px]">Space</span>
          </button>
          <div className="flex-1" />
          <button
            onClick={() => onAction("ask")}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md shadow-sm hover:shadow transition-shadow"
            style={{ background: "var(--accent)", color: "#fff" }}
          >
            <Icon name="sparkle" size={11} />
            <span className="text-[10px] font-mono uppercase tracking-[0.05em] font-medium">Ask</span>
          </button>
        </div>
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
        style={{ background: "rgba(251,250,246,0.88)", border: "1px solid var(--line)", backdropFilter: "blur(12px) saturate(1.05)", boxShadow: "var(--shadow-sm)" }}
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
      style={{ background: "rgba(0,0,0,0.4)", backdropFilter: "blur(8px) saturate(1.1)" }}
      onClick={onClose}
    >
      <div
        className="w-[min(520px,92vw)] rounded-2xl p-6 sv2-drift-in"
        style={{ background: "var(--paper)", border: "1px solid var(--line)", boxShadow: "0 32px 80px -20px rgba(26,21,16,0.28)" }}
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
