"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Node,
  type Edge,
  type Viewport,
} from "@xyflow/react";
import { useWorkspaceStore } from "@/stores/workspace-store";
import {
  VIEWPORT as VP,
  TERRITORY,
  computeZoomSignals,
  type WorkspaceData,
  type WorkspaceItemData,
} from "@/lib/workspace/contracts";
import {
  CANONICAL_WORKSPACE_TYPE_META,
  type CanonicalWorkspaceType,
} from "@/lib/artifact-types";
import { TYPE_TO_TINT, TYPE_GROUP_LABELS } from "@/lib/workspace/contracts";
import { cn } from "@/lib/utils";

import {
  Trash2,
  Link,
  ExternalLink,
  Pencil,
  Maximize2,
  Copy,
} from "lucide-react";
import { ActionMenuContent } from "@/components/workspace/shared-action-menu";
import { MarkdownRenderer } from "@/components/chat/markdown-renderer";

/* ===================================================================
   Palette & Helpers
   =================================================================== */

const TERRITORY_COLORS: Record<string, { core: string; mid: string; outer: string; border: string }> = {
  warm: {
    core: "rgba(245, 178, 60, 0.18)",
    mid: "rgba(245, 178, 60, 0.08)",
    outer: "rgba(245, 178, 60, 0.02)",
    border: "rgba(245, 178, 60, 0.12)",
  },
  cool: {
    core: "rgba(56, 152, 232, 0.16)",
    mid: "rgba(56, 152, 232, 0.07)",
    outer: "rgba(56, 152, 232, 0.015)",
    border: "rgba(56, 152, 232, 0.10)",
  },
  neutral: {
    core: "rgba(140, 130, 115, 0.12)",
    mid: "rgba(140, 130, 115, 0.06)",
    outer: "rgba(140, 130, 115, 0.015)",
    border: "rgba(140, 130, 115, 0.08)",
  },
  accent: {
    core: "rgba(50, 196, 180, 0.15)",
    mid: "rgba(50, 196, 180, 0.07)",
    outer: "rgba(50, 196, 180, 0.015)",
    border: "rgba(50, 196, 180, 0.10)",
  },
  muted: {
    core: "rgba(158, 144, 130, 0.10)",
    mid: "rgba(158, 144, 130, 0.05)",
    outer: "rgba(158, 144, 130, 0.01)",
    border: "rgba(158, 144, 130, 0.07)",
  },
};

function getTerritoryColor(variant: string) {
  return TERRITORY_COLORS[variant] ?? TERRITORY_COLORS.neutral;
}

function dominantTint(ws: WorkspaceData): string {
  const counts: Record<string, number> = {};
  for (const item of ws.items) {
    const tint = TYPE_TO_TINT[item.itemType as CanonicalWorkspaceType] ?? "neutral";
    counts[tint] = (counts[tint] ?? 0) + 1;
  }
  let best = "neutral";
  let bestCount = 0;
  for (const [k, v] of Object.entries(counts)) {
    if (v > bestCount) { best = k; bestCount = v; }
  }
  return best;
}

const STATUS_COLORS: Record<string, string> = {
  active: "bg-[var(--success)]",
  quiet: "bg-[var(--border-default)]",
  completed: "bg-[var(--text-tertiary)]",
  archived: "bg-[var(--border-default)]",
  idle: "bg-[var(--border-default)]",
};

function StatusDot({ status, className }: { status: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-block rounded-full shrink-0",
        STATUS_COLORS[status] ?? "bg-[var(--border-default)]",
        status === "active" && "animate-pulse",
        className || "h-[6px] w-[6px]"
      )}
    />
  );
}

/**
 * Perceptually stable scale.
 * Keeps items at a stable perceived size on screen by counter-scaling.
 * Uses an asymptotic curve that approaches maxScale rather than growing infinitely.
 * At anchorZoom, scale=1. Below anchorZoom, scale grows but caps at maxScale.
 */
function stableScale(zoom: number, anchorZoom: number, maxScale: number = 3.5): number {
  if (zoom >= anchorZoom) return 1;
  const ratio = anchorZoom / zoom;
  return 1 + (maxScale - 1) * (1 - Math.exp(-(ratio - 1) * 1.2));
}

/**
 * Interpolate between two values based on a 0-1 signal.
 */
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}


/**
 * Reads the current zoom level from ReactFlow's viewport reactively.
 * Since @xyflow/react v12 has TypeScript resolution issues with useStore/useViewport
 * in Turbopack, we use the onViewportChange callback pattern instead, which is
 * always available and type-safe.
 *
 * The zoom value is tracked via a state that updates on every viewport change,
 * giving us frame-rate-level reactivity for smooth semantic zoom interpolation.
 */
function useFlowZoom(): number {
  // This hook is called inside ReactFlowProvider context.
  // The zoom value is actually maintained by the parent component via
  // onViewportChange and passed through the workspace store.
  // For components that need zoom inside the canvas, they read it from the store.
  return useWorkspaceStore((s) => s.zoom);
}

/* ===================================================================
   Node Data Types
   =================================================================== */

type WorkspaceNodeData = {
  workspace: WorkspaceData;
  tint: string;
};

type ItemNodeData = {
  item: WorkspaceItemData;
  groupLabel?: string;
  isFirst?: boolean;
};

type GroupLabelNodeData = {
  label: string;
  variant: string;
  count: number;
  viewMode?: "byType" | "byTopic" | "timeline";
};

// Zoom/tier data is NOT passed in node data. Nodes read zoom directly
// from ReactFlow's internal store via useReactFlowStore for frame-rate
// responsiveness without triggering full node tree rebuilds.

/* ===================================================================
   Workspace Territory Node u2014 Semantic Zoom Recomposition

   LANDSCAPE: Dominant region with large legible name/emoji.
              Territory background is strongly visible.
              No items shown u2014 only identity.

   SUMMARY:   Title transitions to top-left anchored position SMOOTHLY.
              Group headings begin appearing gradually.
              Items fade in as compact chips.
              Territory background softens progressively.

   DETAIL:    Full content cards with previews.
              Territory is lightest wash.
              Title is a small persistent header.
   =================================================================== */

function WorkspaceTerritoryNode({ data }: { data: WorkspaceNodeData }) {
  const { workspace, tint } = data;
  const zoom = useFlowZoom();
  const colors = getTerritoryColor(tint);

  const [isEditing, setIsEditing] = useState(false);
  const [draftName, setDraftName] = useState(workspace.name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDraftName(workspace.name);
  }, [workspace.name]);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const commitRename = async () => {
    setIsEditing(false);
    const trimmed = draftName.trim();
    if (!trimmed || trimmed === workspace.name) {
      setDraftName(workspace.name);
      return;
    }
    await fetch("/api/workstreams", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "update", workstreamId: workspace.id, title: trimmed }),
    }).catch(() => undefined);
    window.dispatchEvent(new CustomEvent("workspace:content-mutated", {
      detail: { workstreamId: workspace.id, refreshWorkstreams: true, refreshHub: true },
    }));
  };

  // Continuous zoom signals — no discrete tier boundaries
  const sig = computeZoomSignals(zoom);
  const { identityAnchor, territoryFade, structureReveal } = sig;

  // Territory region: strong when landscape, fades as detail increases
  const regionOpacity = lerp(1.0, 0.25, territoryFade);

  // Identity scale: large at landscape, naturally shrinks as zoom increases
  const identityScale = stableScale(zoom, 0.22);

  // Centered (landscape) vs anchored (summary+): continuous crossfade
  const showCentered = 1 - identityAnchor;
  const showAnchored = identityAnchor;

  return (
    <div
      style={{ width: "100%", height: "100%", pointerEvents: "none" }}
      className="relative"
    >
      {/* Adaptive territory background u2014 scales with zoom/space */}
      <div
        className="absolute inset-0 rounded-[80px]"
        style={{
          opacity: regionOpacity,
          background: `
            radial-gradient(
              ellipse ${lerp(90, 70, territoryFade)}% ${lerp(80, 65, territoryFade)}% at 50% ${lerp(35, 45, territoryFade)}%,
              ${colors.core} 0%,
              ${colors.mid} ${lerp(40, 55, territoryFade)}%,
              ${colors.outer} ${lerp(70, 80, territoryFade)}%,
              transparent 100%
            )
          `,
        }}
      />

      {/* Soft blended envelope boundary — no dashed borders per spec */}
      <div
        className="absolute inset-[6px] rounded-[80px]"
        style={{
          background: `
            radial-gradient(
              ellipse 100% 100% at 50% 50%,
              transparent 85%,
              ${colors.mid} 92%,
              ${colors.outer} 97%,
              transparent 100%
            )
          `,
          opacity: lerp(0.6, 0.08, identityAnchor * 0.5 + territoryFade * 0.5),
        }}
      />

      {/* CENTERED identity (landscape) u2014 fades out smoothly */}
      {showCentered > 0.01 && (
        <div
          className="absolute inset-0 flex flex-col items-center justify-center gap-8"
          style={{
            transform: `scale(${identityScale})`,
            transformOrigin: "center center",
            opacity: showCentered,
          }}
        >
          <div className="flex h-[240px] w-[240px] items-center justify-center rounded-[3.5rem] bg-[var(--bg-elevated)]/40 backdrop-blur-xl border border-[var(--border-default)]/15 shadow-[0_16px_48px_-12px_rgba(7,20,35,0.12)]">
            <span className="text-[120px] leading-none" style={{ filter: "drop-shadow(0 6px 12px rgba(0,0,0,0.08))" }}>
              {workspace.emoji}
            </span>
          </div>

          <div className="flex flex-col items-center gap-4 pointer-events-auto">
            {isEditing ? (
              <input
                ref={inputRef}
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitRename();
                  if (e.key === "Escape") { setDraftName(workspace.name); setIsEditing(false); }
                }}
                className="font-bold text-[var(--text-primary)] text-[80px] tracking-[-0.02em] text-center max-w-[2200px] leading-[1.1] bg-transparent border-b border-[var(--accent-cyan)] outline-none"
                style={{ textShadow: "0 3px 16px rgba(0,0,0,0.06)" }}
              />
            ) : (
              <h3 
                onDoubleClick={(e) => { e.stopPropagation(); setIsEditing(true); }}
                className="font-bold text-[var(--text-primary)] text-[80px] tracking-[-0.02em] text-center max-w-[2200px] leading-[1.1] cursor-text hover:text-[var(--accent-cyan)] transition-colors" 
                style={{ textShadow: "0 3px 16px rgba(0,0,0,0.06)" }}
              >
                {workspace.name}
              </h3>
            )}
            <div className="flex items-center gap-5">
              <span className="text-[36px] font-medium tracking-wide text-[var(--text-tertiary)] bg-[var(--bg-secondary)]/25 backdrop-blur-md px-8 py-3 rounded-full border border-[var(--border-default)]/15">
                {workspace.itemCount} item{workspace.itemCount !== 1 ? "s" : ""}
              </span>
              <StatusDot status={workspace.status} className="h-6 w-6" />
            </div>
          </div>

          {/* Landscape summary chips u2014 fade as structure reveals */}
          <div
            className="flex flex-wrap items-center justify-center gap-3 mt-2 max-w-[1800px]"
            style={{ opacity: Math.max(0, 1 - structureReveal * 1.5) }}
          >
            {Object.entries(TYPE_GROUP_LABELS).map(([key, group]) => {
              const count = workspace.items.filter((i) =>
                group.types.includes(i.itemType as CanonicalWorkspaceType)
              ).length;
              if (count === 0) return null;
              return (
                <span
                  key={key}
                  className="text-[28px] font-medium text-[var(--text-tertiary)]/60 bg-[var(--bg-secondary)]/20 px-6 py-2 rounded-full"
                >
                  {group.label} {count}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* ANCHORED identity (summary+) u2014 fades in smoothly */}
      {showAnchored > 0.01 && (
        <div
          className="absolute top-[60px] left-[80px] flex items-center gap-5 pointer-events-auto z-10"
          style={{
            transform: `scale(${stableScale(zoom, 0.35)})`,
            transformOrigin: "top left",
            opacity: showAnchored,
          }}
        >
          <span className="text-[48px] leading-none pointer-events-none">{workspace.emoji}</span>
          {isEditing ? (
            <input
              ref={inputRef}
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitRename();
                if (e.key === "Escape") { setDraftName(workspace.name); setIsEditing(false); }
              }}
              className="font-semibold text-[var(--text-primary)] text-[44px] tracking-[-0.01em] bg-transparent border-b border-[var(--accent-cyan)] outline-none min-w-[200px]"
              style={{ textShadow: "0 2px 8px rgba(0,0,0,0.04)" }}
            />
          ) : (
            <h3 
              onDoubleClick={(e) => { e.stopPropagation(); setIsEditing(true); }}
              className="font-semibold text-[var(--text-primary)] text-[44px] tracking-[-0.01em] cursor-text hover:text-[var(--accent-cyan)] transition-colors" 
              style={{ textShadow: "0 2px 8px rgba(0,0,0,0.04)" }}
            >
              {workspace.name}
            </h3>
          )}
          <span className="text-[24px] font-medium text-[var(--text-tertiary)]/50 ml-3 pointer-events-none">
            {workspace.itemCount}
          </span>
          <StatusDot status={workspace.status} className="h-4 w-4" />
        </div>
      )}
    </div>
  );
}

/* ===================================================================
   Group Label Node u2014 appears gradually during summary tier
   =================================================================== */

function GroupLabelNode({ data }: { data: GroupLabelNodeData }) {
  const zoom = useFlowZoom();
  const sig = computeZoomSignals(zoom);
  const scale = stableScale(zoom, 0.35, 3);

  // Group labels use the continuous groupReveal signal.
  // They also progressively gain weight/size as detail increases.
  const labelSize = lerp(44, 38, sig.contentDepth);
  const countSize = lerp(32, 26, sig.contentDepth);

  const colors = getTerritoryColor(data.variant);

  if (data.viewMode === "timeline") {
    return (
      <div
        className="flex flex-col select-none pointer-events-none relative"
        style={{
          transform: `scale(${scale})`,
          transformOrigin: "left center",
          opacity: sig.groupReveal,
        }}
      >
        {/* Timeline Axis Line */}
        <div className="absolute top-[28px] left-0 w-[2000px] h-[4px] bg-[var(--border-default)]/20" />
        {/* Timeline Node Point */}
        <div 
          className="absolute top-[21px] left-[24px] w-[18px] h-[18px] rounded-full border-4 border-[var(--bg-primary)] z-10"
          style={{ backgroundColor: colors.border }}
        />
        
        <div className="flex items-center gap-4 pl-[64px] pt-[8px]">
          <span
            className="font-bold uppercase tracking-[0.14em] text-[var(--text-primary)]"
            style={{ fontSize: `${labelSize}px` }}
          >
            {data.label}
          </span>
          <span
            className="tabular-nums text-[var(--text-tertiary)]/50 font-semibold"
            style={{ fontSize: `${countSize}px` }}
          >
            {data.count}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex items-center gap-6 px-6 py-4 rounded-[24px] select-none pointer-events-none"
      style={{
        transform: `scale(${scale})`,
        transformOrigin: "left center",
        opacity: sig.groupReveal,
        backgroundColor: colors.outer,
        border: `1px solid ${colors.border}`,
      }}
    >
      <span
        className="font-bold uppercase tracking-[0.14em]"
        style={{ fontSize: `${labelSize}px`, color: colors.border }}
      >
        {data.label}
      </span>
      <span
        className="tabular-nums text-[var(--text-tertiary)]/40 font-semibold"
        style={{ fontSize: `${countSize}px` }}
      >
        {data.count}
      </span>
      <div
        className="h-[3px] rounded-full ml-4"
        style={{ width: `${lerp(40, 60, sig.cardDetail)}px`, backgroundColor: colors.border }}
      />
    </div>
  );
}

/* ===================================================================
   Item Node — progressive structural recomposition

   GLANCE: Compact chip with icon, title, status dot. Minimal height.
           No interaction affordances — pure information density.

   TOUCH:  Expanded card with preview content, type badge, and
           ACTION BAR (Edit, Open in Deep Edit, Copy). Focus ring
           activates. The card becomes a working surface, not just
           a preview. This is the key differentiator from Glance.

   DEEP:   Content fills the card with type-specific TouchContent.
           Item is connected to its deep-edit surface via a visual
           bridge indicator on the right edge.
   =================================================================== */

function ItemNode({ data }: { data: ItemNodeData }) {
  const { item } = data;
  const zoom = useFlowZoom();
  const meta = CANONICAL_WORKSPACE_TYPE_META[item.itemType as CanonicalWorkspaceType];
  const Icon = meta?.icon;
  const [hovered, setHovered] = useState(false);
  const focusedItemId = useWorkspaceStore((s) => s.focusedItemId);
  const deepEditTargets = useWorkspaceStore((s) => s.deepEditTargets);
  const openDeepEdit = useWorkspaceStore((s) => s.openDeepEdit);
  const setFocusedItem = useWorkspaceStore((s) => s.setFocusedItem);
  const isFocused = focusedItemId === item.id;
  const isOpenInDeepEdit = deepEditTargets.some((t) => t.item.id === item.id);

  // Continuous zoom signals for progressive item recomposition
  const sig = computeZoomSignals(zoom);

  // Items use structureReveal for appearance, cardDetail for chip→card,
  // contentDepth for card→detail. All continuous, no discrete boundaries.
  const itemAppear = sig.structureReveal;
  const chipToCard = sig.cardDetail;
  const cardToDetail = sig.contentDepth;

  // Perceptually stable counter-scale: items stay ~280-350px on screen max
  const scale = stableScale(zoom, 0.4, 3);

  const canvasWidth = TERRITORY.ITEM_COL_WIDTH - 20;
  // Height interpolates continuously from chip (80px) through card to detail
  const canvasHeight = lerp(80, lerp(TERRITORY.ITEM_ROW_HEIGHT - 20, TERRITORY.ITEM_ROW_HEIGHT + 220, cardToDetail), Math.max(chipToCard, cardToDetail));
  const borderRadius = lerp(14, 20, chipToCard);

  const dynamicBorderWidth = Math.max(1, 1 / zoom);
  const borderColor = isFocused
    ? "color-mix(in oklab, var(--accent-cyan) 40%, var(--border-default))"
    : isOpenInDeepEdit && !isFocused
      ? "color-mix(in oklab, var(--accent-cyan) 18%, var(--border-default))"
      : hovered
        ? "color-mix(in oklab, var(--accent-cyan) 22%, var(--border-default))"
        : "color-mix(in srgb, var(--border-default) 50%, transparent)";

  // Background opacity: subtle at chip, stronger at detail
  const bgOpacity = lerp(0.88, 0.95, cardToDetail);

  // Touch-tier action bar visibility: appears when cardDetail is sufficient
  // and contentDepth hasn't taken over entirely
  const actionBarOpacity = Math.min(
    Math.max(0, (chipToCard - 0.25) * 4),   // fade in as card develops
    Math.max(0, 1 - (cardToDetail - 0.7) * 5) // fade out as detail fills
  );

  return (
    <div
      style={{
        width: canvasWidth,
        height: canvasHeight,
        transform: `scale(${scale})`,
        transformOrigin: "center center",
        opacity: itemAppear,
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="relative flex items-center justify-center"
    >
      <div
        className={cn(
          "group relative flex overflow-hidden w-full h-full",
          "transition-[box-shadow] duration-300 ease-[var(--ease-standard)]",
          isOpenInDeepEdit && !isFocused && "opacity-80",
        )}
        style={{
          borderRadius: `${borderRadius}px`,
          border: `${dynamicBorderWidth}px solid ${borderColor}`,
          backgroundColor: `rgba(var(--bg-elevated-rgb, 30, 30, 36), ${bgOpacity})`,
          boxShadow: isFocused
            ? "0 12px 30px -14px rgba(14,142,232,0.22), 0 0 0 1px color-mix(in oklab, var(--accent-cyan) 20%, transparent)"
            : isOpenInDeepEdit
              ? "0 8px 22px -14px rgba(14,142,232,0.12)"
              : hovered
                ? "0 10px 26px -16px rgba(7,20,35,0.18)"
                : `0 ${lerp(4, 8, chipToCard)}px ${lerp(12, 22, chipToCard)}px -14px rgba(7,20,35,${lerp(0.08, 0.14, chipToCard)})`,
        }}
      >
        {/* Focus ring — visible at Touch and Detail tiers when focused */}
        {isFocused && chipToCard > 0.15 && (
          <div
            className="absolute inset-0 rounded-[inherit] pointer-events-none"
            style={{
              boxShadow: `inset 0 0 0 ${Math.max(2, 2 / zoom)}px color-mix(in oklab, var(--accent-cyan) 30%, transparent)`,
              opacity: lerp(0.4, 1, chipToCard),
              zIndex: 10,
            }}
          />
        )}

        {/* Deep Edit connector — visual bridge on right edge */}
        {isOpenInDeepEdit && (
          <div className="absolute -right-3 top-1/2 -translate-y-1/2 flex items-center pointer-events-none z-20">
            {/* Connector line */}
            <div className={cn(
              "h-[2px] w-3 transition-all duration-300",
              isFocused ? "bg-[var(--accent-cyan)]" : "bg-[var(--accent-cyan)]/30",
            )} />
            {/* Connector dot */}
            <div className={cn(
              "h-3 w-3 rounded-full transition-all duration-300 border-2 border-[var(--bg-primary)]",
              isFocused
                ? "bg-[var(--accent-cyan)] shadow-[0_0_8px_2px_rgba(14,142,232,0.35)]"
                : "bg-[var(--accent-cyan)]/40",
            )} />
          </div>
        )}

        {/*
          Progressive content recomposition:
          Instead of 3 separate absolute-positioned layers with threshold-based
          visibility, we render a SINGLE adaptive layout that continuously
          morphs its structure based on zoom signals.
        */}

        {/* Unified adaptive content: morphs from chip → card → detail */}
        <div className="absolute inset-0 flex flex-col">
          {/* Header row: always present, grows with detail */}
          <div
            className="flex items-center shrink-0"
            style={{
              padding: `${lerp(8, 20, chipToCard)}px ${lerp(12, 24, chipToCard)}px`,
              gap: `${lerp(8, 16, chipToCard)}px`,
            }}
          >
            {Icon && (
              <div
                className={cn(
                  "flex items-center justify-center shrink-0 transition-all duration-200",
                  isFocused && chipToCard > 0.3 && "ring-2 ring-[var(--accent-cyan)]/25",
                )}
                style={{
                  width: `${lerp(28, 44, chipToCard)}px`,
                  height: `${lerp(28, 44, chipToCard)}px`,
                  borderRadius: `${lerp(8, 13, chipToCard)}px`,
                  backgroundColor: `color-mix(in oklab, ${meta?.color ?? "#637083"} ${lerp(8, 12, chipToCard)}%, var(--bg-secondary))`,
                }}
              >
                <Icon
                  style={{
                    width: `${lerp(14, 20, chipToCard)}px`,
                    height: `${lerp(14, 20, chipToCard)}px`,
                    color: meta?.color ?? "var(--text-secondary)",
                  }}
                />
              </div>
            )}
            <span
              className="flex-1 truncate font-medium text-[var(--text-primary)] tracking-tight"
              style={{
                fontSize: `${lerp(14, 17, chipToCard)}px`,
                fontWeight: chipToCard > 0.4 ? 600 : 500,
              }}
            >
              {item.title}
            </span>
            <StatusDot status={item.status === "completed" ? "completed" : item.status === "active" ? "active" : "idle"} />
          </div>

          {/* Preview text: fades in with card detail, fades out when touch content takes over */}
          {item.preview && chipToCard > 0.1 && cardToDetail < 0.9 && (
            <div
              className="flex-1 min-h-0 overflow-hidden"
              style={{
                opacity: Math.min(chipToCard * 2.5, 1 - cardToDetail),
                padding: `0 ${lerp(12, 24, chipToCard)}px`,
              }}
            >
              <p
                className="text-[var(--text-tertiary)] leading-[1.6]"
                style={{
                  fontSize: `${lerp(12, 15, chipToCard)}px`,
                  paddingLeft: `${lerp(0, 60, chipToCard)}px`,
                  display: "-webkit-box",
                  WebkitLineClamp: chipToCard > 0.6 ? 3 : 2,
                  WebkitBoxOrient: "vertical" as const,
                  overflow: "hidden",
                }}
              >
                {item.preview}
              </p>
            </div>
          )}

          {/* Type badge and meta: progressively visible */}
          {chipToCard > 0.3 && cardToDetail < 0.85 && (
            <div
              className="flex items-center justify-between mt-auto shrink-0"
              style={{
                opacity: Math.min((chipToCard - 0.3) * 3, 1 - cardToDetail),
                padding: `${lerp(4, 8, chipToCard)}px ${lerp(12, 24, chipToCard)}px ${lerp(8, 20, chipToCard)}px`,
                paddingLeft: `${lerp(12, 80, chipToCard)}px`,
              }}
            >
              <span
                className="rounded-md px-2 py-1 text-sm font-semibold uppercase tracking-[0.1em]"
                style={{
                  backgroundColor: isFocused ? `color-mix(in oklab, ${meta?.color ?? "var(--text-tertiary)"} 8%, transparent)` : "transparent",
                  color: `color-mix(in oklab, ${meta?.color ?? "var(--text-tertiary)"} ${isFocused ? "80" : "50"}%, transparent)`,
                }}
              >
                {meta?.label ?? item.itemType}
              </span>
              {item.meta && <span className="text-sm font-medium text-[var(--text-secondary)]">{item.meta}</span>}
            </div>
          )}

          {/* ═══════════════════════════════════════════════════════════
              TOUCH-TIER ACTION BAR — the key differentiator from Glance

              This action bar makes Touch tier a real interaction layer,
              not just "enlarged Glance cards". It provides:
              - Edit button (opens inline editing via focus)
              - Expand button (opens Deep Edit surface)
              - Copy button (copies content to clipboard)

              The bar fades in continuously with cardDetail and fades out
              as contentDepth takes over (where TouchContent handles editing).
              ═══════════════════════════════════════════════════════════ */}
          {actionBarOpacity > 0.01 && (
            <div
              className="flex items-center gap-1.5 shrink-0 pointer-events-auto"
              style={{
                opacity: actionBarOpacity,
                padding: `0 ${lerp(12, 24, chipToCard)}px ${lerp(6, 12, chipToCard)}px`,
                paddingLeft: `${lerp(12, 80, chipToCard)}px`,
              }}
            >
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setFocusedItem(item.id);
                }}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg px-2.5 py-1.5",
                  "text-[11px] font-semibold transition-all duration-150",
                  isFocused
                    ? "bg-[var(--accent-cyan)]/12 text-[var(--accent-cyan)]"
                    : "text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]",
                )}
                title="Edit inline"
              >
                <Pencil className="h-3 w-3" />
                Edit
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  openDeepEdit(item);
                }}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg px-2.5 py-1.5",
                  "text-[11px] font-semibold transition-all duration-150",
                  isOpenInDeepEdit
                    ? "bg-[var(--accent-cyan)]/12 text-[var(--accent-cyan)]"
                    : "text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]",
                )}
                title="Open in Deep Edit"
              >
                <Maximize2 className="h-3 w-3" />
                {isOpenInDeepEdit ? "Open" : "Expand"}
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  navigator.clipboard.writeText(item.preview ?? item.title).catch(() => {});
                }}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg px-2.5 py-1.5",
                  "text-[11px] font-semibold transition-all duration-150",
                  "text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]",
                )}
                title="Copy content"
              >
                <Copy className="h-3 w-3" />
                Copy
              </button>
            </div>
          )}

          {/* Touch content: fades in continuously as contentDepth increases */}
          {cardToDetail > 0.05 && (
            <div
              className="absolute inset-0 overflow-hidden pointer-events-auto"
              style={{ opacity: cardToDetail }}
            >
              <TouchContent item={item} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Detect programming language from item meta, title suffix, or content shebang/keywords */
function detectCodeLanguage(item: WorkspaceItemData): string {
  // Check meta field first (may contain language tag like "python", "js", etc.)
  if (item.meta) {
    const langMap: Record<string, string> = {
      "python": "python", "py": "python",
      "javascript": "javascript", "js": "javascript",
      "typescript": "typescript", "ts": "typescript",
      "jsx": "jsx", "tsx": "tsx",
      "html": "html", "css": "css",
      "rust": "rust", "go": "go",
      "java": "java", "c": "c", "cpp": "cpp",
      "ruby": "ruby", "php": "php",
      "sql": "sql", "bash": "bash", "sh": "bash",
      "swift": "swift", "kotlin": "kotlin",
      "dart": "dart", "yaml": "yaml", "json": "json",
      "markdown": "markdown", "md": "markdown",
    };
    const metaLower = item.meta.toLowerCase().trim();
    if (langMap[metaLower]) return langMap[metaLower];
  }

  // Check title for common language extensions
  const titleLower = item.title.toLowerCase();
  const extMatch = titleLower.match(/\.(py|js|ts|jsx|tsx|html|css|rs|go|java|c|cpp|rb|php|sql|sh|swift|kt|dart|yaml|yml|json|md)$/);
  if (extMatch) {
    const extMap: Record<string, string> = {
      "py": "python", "js": "javascript", "ts": "typescript",
      "jsx": "jsx", "tsx": "tsx", "html": "html", "css": "css",
      "rs": "rust", "go": "go", "java": "java", "c": "c", "cpp": "cpp",
      "rb": "ruby", "php": "php", "sql": "sql", "sh": "bash",
      "swift": "swift", "kt": "kotlin", "dart": "dart",
      "yaml": "yaml", "yml": "yaml", "json": "json", "md": "markdown",
    };
    if (extMap[extMatch[1]]) return extMap[extMatch[1]];
  }

  // Check content for shebang or common patterns
  const code = item.preview ?? "";
  if (code.startsWith("#!/usr/bin/env python") || code.startsWith("#!/usr/bin/python")) return "python";
  if (code.startsWith("#!/bin/bash") || code.startsWith("#!/bin/sh")) return "bash";
  if (code.startsWith("<!DOCTYPE") || code.startsWith("<html")) return "html";
  if (code.match(/^import\s+(React|{\s*useState)/m)) return "typescript";
  if (code.match(/^(def |import |from )/m)) return "python";
  if (code.match(/^(func |package )/m)) return "go";
  if (code.match(/^(fn |let mut |impl )/m)) return "rust";
  if (code.match(/^(public class |private |protected )/m)) return "java";

  return "";
}

/* ===================================================================
   TouchContent u2014 Type-specific detail-tier rendering
   =================================================================== */

function TouchContent({ item }: { item: WorkspaceItemData }) {
  const meta = CANONICAL_WORKSPACE_TYPE_META[item.itemType as CanonicalWorkspaceType];
  const Icon = meta?.icon;
  const [isEditing, setIsEditing] = useState(false);
  const [content, setContent] = useState(item.preview ?? "");

  useEffect(() => {
    setContent(item.preview ?? "");
  }, [item.preview]);

  const handleBlur = () => {
    setIsEditing(false);
    if (content !== item.preview) {
      void fetch("/api/artifacts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ artifactId: item.id, content }),
      }).catch(() => undefined);
    }
  };

  switch (item.itemType) {
    case "note":
      return (
        <div 
          className="p-5 h-full overflow-hidden flex flex-col" 
          onClick={() => !isEditing && setIsEditing(true)}
        >
          <div className="flex items-center gap-2 mb-3 shrink-0">
            {Icon && <Icon className="h-4 w-4" style={{ color: meta?.color }} />}
            <span className="text-[14px] font-semibold text-[var(--text-primary)] truncate">{item.title}</span>
          </div>
          {isEditing ? (
            <textarea
              autoFocus
              className="flex-1 w-full resize-none bg-transparent text-[14px] leading-[1.8] text-[var(--text-primary)] outline-none border border-[var(--accent-cyan)]/50 rounded-lg p-2 font-[var(--font-manrope)]"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              onBlur={handleBlur}
            />
          ) : (
            <div className="flex-1 overflow-y-auto cursor-text">
              <MarkdownRenderer content={content}  />
            </div>
          )}
        </div>
      );

    case "code": {
      const codeLang = detectCodeLanguage(item);
      const fencedContent = codeLang
        ? "```" + codeLang + "\n" + (content || "// No code yet") + "\n```"
        : "```\n" + (content || "// No code yet") + "\n```";
      const lineCount = (content || "").split("\n").length;
      return (
        <div 
          className="h-full flex flex-col overflow-hidden"
          onClick={() => !isEditing && setIsEditing(true)}
        >
          <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[var(--border-default)]/20 shrink-0 bg-[#1e1e2e]">
            {Icon && <Icon className="h-3.5 w-3.5" style={{ color: meta?.color }} />}
            <span className="text-[12px] font-semibold text-[var(--text-primary)] truncate flex-1">{item.title}</span>
            {codeLang && (
              <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-tertiary)]/60 bg-[var(--bg-elevated)]/50 px-2 py-0.5 rounded">{codeLang}</span>
            )}
            <span className="text-[10px] text-[var(--text-tertiary)]/40 tabular-nums">{lineCount}L</span>
          </div>
          <div className="flex-1 bg-[#1e1e2e] overflow-hidden flex flex-col">
            {isEditing ? (
              <textarea
                autoFocus
                className="flex-1 w-full resize-none bg-transparent text-[#cdd6f4] font-mono text-[12px] leading-[1.7] outline-none p-4 border-l-2 border-[var(--accent-cyan)]/30"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                onBlur={handleBlur}
                spellCheck={false}
              />
            ) : (
              <div className="flex-1 overflow-y-auto p-4 [&_.markdown-body]:!bg-transparent [&_.markdown-body]:!text-[12px] [&_.markdown-body_pre]:!bg-transparent [&_.markdown-body_pre]:!m-0 [&_.markdown-body_pre]:!p-0 [&_.markdown-body_code]:!text-[12px] [&_.markdown-body_code]:!leading-[1.7] [&_.markdown-body_pre_code]:!font-mono [&_.markdown-body_pre_code]:!bg-transparent [&_.markdown-body]:!leading-[1.7] [&_button]:!hidden">
                <MarkdownRenderer content={fencedContent} />
              </div>
            )}
          </div>
        </div>
      );
    }

    case "visual":
      return (
        <div className="h-full flex flex-col items-center justify-center" style={{ background: `linear-gradient(135deg, color-mix(in oklab, ${meta?.color ?? "#1f9fb2"} 15%, var(--bg-elevated)), color-mix(in oklab, ${meta?.color ?? "#1f9fb2"} 5%, var(--bg-elevated)))` }}>
          {Icon && <Icon className="h-12 w-12 mb-3" style={{ color: `color-mix(in oklab, ${meta?.color ?? "#1f9fb2"} 30%, transparent)` }} />}
          <span className="text-[14px] font-semibold text-[var(--text-primary)]">{item.title}</span>
          {item.preview && <p className="text-[12px] text-[var(--text-tertiary)] mt-1 px-6 text-center line-clamp-2">{item.preview}</p>}
        </div>
      );

    case "thread":
      return (
        <div className="h-full flex flex-col p-4 gap-2 overflow-hidden">
          <div className="flex items-center gap-2 mb-1">
            {Icon && <Icon className="h-4 w-4" style={{ color: meta?.color }} />}
            <span className="text-[13px] font-semibold text-[var(--text-primary)] truncate">{item.title}</span>
          </div>
          {item.preview ? (
            <div className="flex flex-col gap-2">
              <div className="self-end max-w-[80%] rounded-2xl rounded-br-md bg-[var(--bg-secondary)] px-3 py-2 text-[12px] text-[var(--text-primary)]">
                {item.preview.slice(0, 80)}
              </div>
              <div className="self-start max-w-[80%] rounded-2xl rounded-bl-md bg-[color-mix(in_oklab,var(--accent-cyan)_8%,var(--bg-secondary))] px-3 py-2 text-[12px] text-[var(--text-primary)]">
                {item.preview.slice(80) || "..."}
              </div>
            </div>
          ) : (
            <span className="text-[12px] text-[var(--text-tertiary)]">No messages yet</span>
          )}
        </div>
      );

    case "flashcard_deck":
      return (
        <div className="h-full flex flex-col items-center justify-center p-5">
          <div className="relative w-[160px] h-[100px] mb-4">
            <div className="absolute inset-0 translate-x-2 translate-y-2 rounded-xl bg-[var(--bg-secondary)]/60 border border-[var(--border-default)]/20" />
            <div className="absolute inset-0 translate-x-1 translate-y-1 rounded-xl bg-[var(--bg-secondary)]/80 border border-[var(--border-default)]/20" />
            <div className="absolute inset-0 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-default)]/30 flex items-center justify-center">
              {Icon && <Icon className="h-8 w-8" style={{ color: meta?.color }} />}
            </div>
          </div>
          <span className="text-[14px] font-semibold text-[var(--text-primary)]">{item.title}</span>
          {item.meta && <span className="text-[13px] font-medium text-[var(--accent-cyan)] mt-1">{item.meta}</span>}
          <button type="button" className="mt-3 px-4 py-1.5 rounded-lg bg-[var(--accent-cyan)]/10 text-[12px] font-semibold text-[var(--accent-cyan)] hover:bg-[var(--accent-cyan)]/20 transition-colors">Review</button>
        </div>
      );

    case "quiz":
      return (
        <div className="h-full flex flex-col items-center justify-center p-5">
          {Icon && <Icon className="h-10 w-10 mb-3" style={{ color: meta?.color }} />}
          <span className="text-[14px] font-semibold text-[var(--text-primary)]">{item.title}</span>
          {item.meta ? (
            <span className="text-[16px] font-bold mt-2" style={{ color: meta?.color }}>{item.meta}</span>
          ) : (
            <span className="text-[13px] text-[var(--text-tertiary)] mt-1">Not attempted</span>
          )}
          <button type="button" className="mt-3 px-4 py-1.5 rounded-lg bg-[color-mix(in_oklab,${meta?.color}_10%,var(--bg-secondary))] text-[12px] font-semibold hover:opacity-80 transition-opacity" style={{ color: meta?.color }}>
            {item.status === "completed" ? "Review" : "Start"}
          </button>
        </div>
      );

    case "planner":
      return (
        <div className="h-full flex flex-col p-5">
          <div className="flex items-center gap-2 mb-3">
            {Icon && <Icon className="h-4 w-4" style={{ color: meta?.color }} />}
            <span className="text-[13px] font-semibold text-[var(--text-primary)] truncate">{item.title}</span>
          </div>
          <div className="flex items-center gap-3 py-2">
            <div className="h-5 w-5 rounded-md border-2 border-[var(--accent-cyan)]/40 flex items-center justify-center">
              {item.status === "completed" && <div className="h-2.5 w-2.5 rounded-sm bg-[var(--success)]" />}
            </div>
            <span className="text-[13px] text-[var(--text-primary)]">{item.title}</span>
          </div>
          <div className="flex items-center gap-2 mt-auto">
            <div className="h-2 w-2 rounded-full bg-[var(--accent-coral)]" />
            <span className="text-[11px] text-[var(--text-tertiary)]">{item.meta ?? "No due date"}</span>
          </div>
        </div>
      );

    case "export":
      return (
        <div className="h-full flex flex-col overflow-hidden" style={{ background: "linear-gradient(135deg, var(--bg-secondary)/30, var(--bg-elevated))" }}>
          <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[var(--border-default)]/20 shrink-0">
            {Icon && <Icon className="h-3.5 w-3.5" style={{ color: meta?.color }} />}
            <span className="text-[12px] font-semibold text-[var(--text-primary)] truncate flex-1">{item.title}</span>
            <span className="text-[10px] font-medium text-[var(--text-tertiary)]/50 uppercase tracking-wider">Document</span>
          </div>
          {content ? (
            <div className="flex-1 overflow-y-auto p-4 [&_.markdown-body]:!text-[12px] [&_.markdown-body]:!leading-[1.6] [&_.markdown-body_p]:!mb-1 [&_.markdown-body_h1]:!text-[16px] [&_.markdown-body_h1]:!mb-1 [&_.markdown-body_h2]:!text-[14px] [&_.markdown-body_h2]:!mb-1 [&_.markdown-body_h3]:!text-[13px] [&_.markdown-body_h3]:!mb-1 [&_.markdown-body_ul]:!mb-1 [&_.markdown-body_ol]:!mb-1 [&_.markdown-body_blockquote]:!mb-1 [&_.markdown-body_pre]:!mb-1 [&_button]:!hidden">
              <MarkdownRenderer content={content} mode="document" />
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center gap-2">
              {Icon && <Icon className="h-8 w-8" style={{ color: `color-mix(in oklab, ${meta?.color ?? "#1f9fb2"} 30%, transparent)` }} />}
              <span className="text-[12px] text-[var(--text-tertiary)]">Empty document</span>
            </div>
          )}
        </div>
      );

    case "board":
      return (
        <div className="h-full flex flex-col p-4">
          <div className="flex items-center gap-2 mb-3">
            {Icon && <Icon className="h-4 w-4" style={{ color: meta?.color }} />}
            <span className="text-[13px] font-semibold text-[var(--text-primary)] truncate">{item.title}</span>
          </div>
          <div className="flex-1 grid grid-cols-3 gap-2">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="rounded-lg bg-[var(--bg-secondary)]/40 border border-[var(--border-default)]/15" />
            ))}
          </div>
        </div>
      );

    default:
      return (
        <div className="h-full flex flex-col p-5">
          <div className="flex items-center gap-2 mb-3">
            {Icon && <Icon className="h-4 w-4" style={{ color: meta?.color }} />}
            <span className="text-[14px] font-semibold text-[var(--text-primary)]">{item.title}</span>
          </div>
          {item.preview && <p className="text-[13px] leading-relaxed text-[var(--text-secondary)]">{item.preview}</p>}
        </div>
      );
  }
}

/* ===================================================================
   Build Nodes u2014 layout engine with semantic zoom awareness
   =================================================================== */

/* ===================================================================
   Heuristic Topic Grouping (Issue 4)
   =================================================================== */

function getTopicGroups(items: WorkspaceItemData[]): { label: string; items: WorkspaceItemData[] }[] {
  // Use backend topicCluster if available
  const clusterMap: Record<string, WorkspaceItemData[]> = {};
  const unclustered: WorkspaceItemData[] = [];

  for (const item of items) {
    if (item.topicCluster) {
      if (!clusterMap[item.topicCluster]) clusterMap[item.topicCluster] = [];
      clusterMap[item.topicCluster].push(item);
    } else {
      unclustered.push(item);
    }
  }

  // If no backend clusters at all, fallback to heuristic
  if (Object.keys(clusterMap).length === 0 && unclustered.length > 0) {
    return heuristicTopicGroups(unclustered);
  }

  const groups = Object.entries(clusterMap).map(([label, clusterItems]) => ({ label, items: clusterItems }));

  if (unclustered.length > 0) {
    groups.push({ label: "Uncategorized", items: unclustered });
  }

  return groups;
}

const STOPWORDS = new Set(["the", "a", "an", "in", "on", "of", "for", "to", "and", "or", "is", "it", "at", "by", "with", "from"]);

function heuristicTopicGroups(items: WorkspaceItemData[]): { label: string; items: WorkspaceItemData[] }[] {
  const wordMap: Record<string, WorkspaceItemData[]> = {};
  const itemWords: Map<string, string[]> = new Map();

  for (const item of items) {
    const textToAnalyze = `${item.title} ${item.preview ?? ""}`.toLowerCase().replace(/[^a-z0-9\s]/g, "");
    const words = textToAnalyze.split(/\s+/).filter((w) => w.length > 3 && !STOPWORDS.has(w));
    
    // De-duplicate words for the item
    const uniqueWords = Array.from(new Set(words));
    itemWords.set(item.id, uniqueWords);
    
    for (const w of uniqueWords) {
      if (!wordMap[w]) wordMap[w] = [];
      wordMap[w].push(item);
    }
  }

  // Find keywords shared by 2+ items
  const clusters: { keyword: string; items: Set<string> }[] = [];
  const assigned = new Set<string>();

  const sortedKeywords = Object.entries(wordMap)
    .filter(([, arr]) => arr.length >= 2)
    .sort((a, b) => b[1].length - a[1].length);

  for (const [keyword, keywordItems] of sortedKeywords) {
    const unassigned = keywordItems.filter((it) => !assigned.has(it.id));
    if (unassigned.length < 2) continue;
    const cluster = { keyword, items: new Set(unassigned.map((it) => it.id)) };
    for (const id of cluster.items) assigned.add(id);
    clusters.push(cluster);
  }

  // Remaining unassigned items group by type
  const remaining = items.filter((it) => !assigned.has(it.id));
  const groups: { label: string; items: WorkspaceItemData[] }[] = [];

  for (const cluster of clusters) {
    const clusterItems = items.filter((it) => cluster.items.has(it.id));
    const label = cluster.keyword.charAt(0).toUpperCase() + cluster.keyword.slice(1);
    groups.push({ label, items: clusterItems });
  }

  if (remaining.length > 0) {
    groups.push({ label: "Other", items: remaining });
  }

  return groups.length > 0 ? groups : [{ label: "All Items", items }];
}

/* ===================================================================
   Timeline Date Grouping (Issue 5)
   =================================================================== */

function timelineDateGroups(items: WorkspaceItemData[]): { label: string; items: WorkspaceItemData[] }[] {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterday = today - 86_400_000;
  const startOfWeek = today - now.getDay() * 86_400_000;
  const startOfLastWeek = startOfWeek - 7 * 86_400_000;

  const buckets: { label: string; items: WorkspaceItemData[] }[] = [
    { label: "Today", items: [] },
    { label: "Yesterday", items: [] },
    { label: "This Week", items: [] },
    { label: "Last Week", items: [] },
  ];
  const monthBuckets: Record<string, WorkspaceItemData[]> = {};

  const sorted = [...items].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));

  for (const item of sorted) {
    const ts = item.updatedAt ?? 0;
    if (ts >= today) {
      buckets[0].items.push(item);
    } else if (ts >= yesterday) {
      buckets[1].items.push(item);
    } else if (ts >= startOfWeek) {
      buckets[2].items.push(item);
    } else if (ts >= startOfLastWeek) {
      buckets[3].items.push(item);
    } else {
      const d = new Date(ts);
      const key = d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
      if (!monthBuckets[key]) monthBuckets[key] = [];
      monthBuckets[key].push(item);
    }
  }

  const result = buckets.filter((b) => b.items.length > 0);
  for (const [label, monthItems] of Object.entries(monthBuckets)) {
    result.push({ label, items: monthItems });
  }
  return result.length > 0 ? result : [{ label: "All", items: sorted }];
}

/* ===================================================================
   Build Nodes u2014 layout engine with semantic zoom awareness
   =================================================================== */

const ROW_HEIGHT = 300;

function computeTerritorySize(itemCount: number): { w: number; h: number } {
  const minW = 3000;
  const minH = 2400;
  const perItem = 400;
  const w = Math.max(minW, Math.min(6000, 2000 + Math.ceil(itemCount / 3) * 1200));
  const h = Math.max(minH, Math.min(5000, 1200 + itemCount * perItem));
  return { w, h };
}

function buildNodes(
  workspaces: WorkspaceData[],
  zoomTier: "landscape" | "summary" | "detail",
  zoomProgress: number,
  zoom: number,
  viewMode: "byType" | "byTopic" | "timeline" = "byType",
): Node[] {
  const nodes: Node[] = [];
  const sig = computeZoomSignals(zoom);

  // Progressive layout density: item spacing responds to zoom signals.
  // At landscape (structureReveal ~0), items are spread far apart.
  // As zoom increases, items pack tighter for more content density.
  // At detail level, items are close together for efficient scanning.
  const densityFactor = lerp(1.6, 0.75, Math.max(sig.structureReveal, sig.cardDetail));
  const rowGap = Math.round(ROW_HEIGHT * densityFactor);

  workspaces.forEach((ws, idx) => {
    const col = idx % TERRITORY.COLS;
    const row = Math.floor(idx / TERRITORY.COLS);
    const tint = dominantTint(ws);
    const { w: territoryWidth, h: territoryHeight } = computeTerritorySize(ws.items.length);

    nodes.push({
      id: `ws-${ws.id}`,
      type: "workspaceTerritory",
      position: {
        x: col * TERRITORY.SPACING_X,
        y: row * TERRITORY.SPACING_Y,
      },
      data: { workspace: ws, tint } satisfies WorkspaceNodeData,
      draggable: false,
      selectable: true,
      style: { width: territoryWidth, height: territoryHeight, zIndex: 0 },
    });

    // Items are ALWAYS included in the node tree. They control their own
    // visibility via continuous opacity from structureReveal signal.
    // No discrete threshold — eliminates abrupt show/hide viewport jumps.

    // Build groups based on viewMode
    let groups: { label: string; variant: string; items: WorkspaceItemData[] }[];

    if (viewMode === "timeline") {
      const dateGroups = timelineDateGroups(ws.items);
      groups = dateGroups.map((g) => ({ label: g.label, variant: "neutral", items: g.items }));
    } else if (viewMode === "byTopic") {
      const topicGroups = getTopicGroups(ws.items);
      const colorVariants = ["accent", "warm", "cool", "neutral", "muted"];
      groups = topicGroups.map((g, i) => ({ 
        label: g.label, 
        variant: colorVariants[i % colorVariants.length], 
        items: g.items 
      }));
    } else {
      const typeGrouped: Record<string, WorkspaceItemData[]> = {};
      for (const item of ws.items) {
        const key = item.itemType;
        if (!typeGrouped[key]) typeGrouped[key] = [];
        typeGrouped[key].push(item);
      }
      groups = [];
      for (const [, group] of Object.entries(TYPE_GROUP_LABELS)) {
        const items = group.types.flatMap((t) => typeGrouped[t] ?? []);
        if (items.length > 0) {
          groups.push({ label: group.label, variant: TYPE_TO_TINT[group.types[0]], items });
        }
      }
    }

    // Layout Engine
    const headerY = 500;
    
    if (viewMode === "timeline") {
      // Timeline: horizontal layout (left-to-right)
      let groupX = 120;
      for (let gi = 0; gi < groups.length; gi++) {
        const g = groups[gi];
        nodes.push({
          id: `group-${ws.id}-${g.label}-${gi}`,
          type: "groupLabel",
          parentId: `ws-${ws.id}`,
          position: { x: groupX, y: headerY },
          data: { label: g.label, variant: g.variant, count: g.items.length, viewMode: "timeline" } satisfies GroupLabelNodeData,
          draggable: false,
          selectable: false,
          style: { width: 1200, zIndex: 1 },
        });

        let itemY = headerY + 160; // Extra spacing for the timeline axis
        for (let ii = 0; ii < g.items.length; ii++) {
          const item = g.items[ii];
          nodes.push({
            id: `item-${item.id}`,
            type: "itemNode",
            parentId: `ws-${ws.id}`,
            position: { x: groupX + 64, y: itemY }, // Indented slightly relative to axis
            data: { item, groupLabel: g.label, isFirst: ii === 0 } satisfies ItemNodeData,
            draggable: true,
            selectable: true,
            style: { zIndex: 2 },
          });
          itemY += rowGap + 40; // More vertical spacing for a chronological feel
        }
        groupX += 1200; // Closer together horizontally than before to make timeline cohesive
      }
    } else if (viewMode === "byTopic") {
      // By Topic: Semantic Spatial Packing (simulated with 3 columns, more scattered y spacing)
      const colCount = 3;
      const colWidth = territoryWidth / colCount;
      const colOffsets = Array.from({ length: colCount }, (_, i) => 120 + i * colWidth);
      const colYCursors = Array.from({ length: colCount }, () => headerY + 100);

      // Sort groups by size to balance columns
      const sortedGroups = [...groups].sort((a, b) => b.items.length - a.items.length);

      for (let gi = 0; gi < sortedGroups.length; gi++) {
        const g = sortedGroups[gi];
        // Find shortest column
        let minColIdx = 0;
        let minY = colYCursors[0];
        for (let i = 1; i < colCount; i++) {
          if (colYCursors[i] < minY) {
            minY = colYCursors[i];
            minColIdx = i;
          }
        }

        const colIdx = minColIdx;
        const x = colOffsets[colIdx];
        let y = colYCursors[colIdx];

        nodes.push({
          id: `group-${ws.id}-${g.label}-${gi}`,
          type: "groupLabel",
          parentId: `ws-${ws.id}`,
          position: { x, y },
          data: { label: g.label, variant: g.variant, count: g.items.length, viewMode: "byTopic" } satisfies GroupLabelNodeData,
          draggable: false,
          selectable: false,
          style: { width: Math.min(colWidth - 140, 2400), zIndex: 1 },
        });
        y += 140;

        const itemsPerRow = 2; // Tighter clusters for topics
        for (let ii = 0; ii < g.items.length; ii++) {
          const item = g.items[ii];
          const itemCol = ii % itemsPerRow;
          const itemRow = Math.floor(ii / itemsPerRow);
          // Apply slight randomness/stagger to make it feel organic and clustered
          const staggerY = (itemCol % 2) * 40;
          nodes.push({
            id: `item-${item.id}`,
            type: "itemNode",
            parentId: `ws-${ws.id}`,
            position: {
              x: x + itemCol * (TERRITORY.ITEM_COL_WIDTH + 60),
              y: y + itemRow * (rowGap + 60) + staggerY,
            },
            data: { item, groupLabel: g.label, isFirst: ii === 0 } satisfies ItemNodeData,
            draggable: true,
            selectable: true,
            style: { zIndex: 2 },
          });
        }

        colYCursors[colIdx] = y + Math.ceil(g.items.length / itemsPerRow) * (rowGap + 60) + 180; // More space between topics
      }

    } else {
      // By Type: Structured 2-column layout (Default)
      const groupsPerColumn = Math.ceil(groups.length / 2);
      const colOffsets = [120, territoryWidth / 2 + 60];
      const colYCursors = [headerY, headerY];

      for (let gi = 0; gi < groups.length; gi++) {
        const g = groups[gi];
        const colIdx = gi < groupsPerColumn ? 0 : 1;
        const x = colOffsets[colIdx];
        let y = colYCursors[colIdx];

        nodes.push({
          id: `group-${ws.id}-${g.label}-${gi}`,
          type: "groupLabel",
          parentId: `ws-${ws.id}`,
          position: { x, y },
          data: { label: g.label, variant: g.variant, count: g.items.length, viewMode: "byType" } satisfies GroupLabelNodeData,
          draggable: false,
          selectable: false,
          style: { width: Math.min(territoryWidth / 2 - 140, 2400), zIndex: 1 },
        });
        y += 120;

        const itemsPerRow = Math.min(3, TERRITORY.ITEMS_PER_ROW);
        for (let ii = 0; ii < g.items.length; ii++) {
          const item = g.items[ii];
          const itemCol = ii % itemsPerRow;
          const itemRow = Math.floor(ii / itemsPerRow);
          nodes.push({
            id: `item-${item.id}`,
            type: "itemNode",
            parentId: `ws-${ws.id}`,
            position: {
              x: item.canvasX ?? x + itemCol * TERRITORY.ITEM_COL_WIDTH,
              y: item.canvasY ?? y + itemRow * rowGap,
            },
            data: { item, groupLabel: g.label, isFirst: ii === 0 } satisfies ItemNodeData,
            draggable: true,
            selectable: true,
            style: { zIndex: 2 },
          });
        }

        colYCursors[colIdx] = y + Math.ceil(g.items.length / itemsPerRow) * rowGap + 80;
      }
    }
  });

  return nodes;
}

/* --- Node Type Registry --- */

const NODE_TYPES = {
  workspaceTerritory: WorkspaceTerritoryNode,
  itemNode: ItemNode,
  groupLabel: GroupLabelNode,
};

/* ===================================================================
   Fixed Screen-Size Background
   =================================================================== */

function CanvasBackground({ mode, zoom }: { mode: "dots" | "blank" | "grid"; zoom: number }) {
  if (mode === "blank") return null;

  const isDots = mode === "dots";
  const sig = computeZoomSignals(zoom);

  // Background responds to zoom: subtler at landscape (territory backgrounds dominate),
  // more present at detail level where the canvas is the working surface.
  // Dot/grid size stays fixed on screen (CSS pattern, not transformed).
  const baseOpacity = isDots ? 0.55 : 0.2;
  const zoomOpacity = lerp(baseOpacity * 0.3, baseOpacity, sig.structureReveal);

  return (
    <div
      className="absolute inset-0 pointer-events-none z-0"
      style={{
        backgroundImage: isDots
          ? "radial-gradient(circle, var(--border-default) 1.2px, transparent 1.2px)"
          : "linear-gradient(var(--border-default) 0.5px, transparent 0.5px), linear-gradient(90deg, var(--border-default) 0.5px, transparent 0.5px)",
        backgroundSize: isDots ? "28px 28px" : "40px 40px",
        opacity: zoomOpacity,
      }}
    />
  );
}

/* ===================================================================
   Canvas Inner u2014 the ReactFlow instance
   =================================================================== */

type WorkspaceCanvasProps = {
  onNodeClick?: (workspaceId: string) => void;
  onItemClick?: (itemId: string) => void;
};

function WorkspaceCanvasInner({
  onNodeClick,
  onItemClick,
}: WorkspaceCanvasProps) {
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const zoomTier = useWorkspaceStore((s) => s.zoomTier);
  const zoomProgress = useWorkspaceStore((s) => s.zoomProgress);
  const zoom = useWorkspaceStore((s) => s.zoom);
  const viewMode = useWorkspaceStore((s) => s.viewMode);
  const setViewport = useWorkspaceStore((s) => s.setViewport);
  const setFocusedItem = useWorkspaceStore((s) => s.setFocusedItem);
  const backgroundMode = useWorkspaceStore((s) => s.backgroundMode);
  const flyToTarget = useWorkspaceStore((s) => s.flyToTarget);
  const clearFlyToTarget = useWorkspaceStore((s) => s.clearFlyToTarget);

  const { setCenter } = useReactFlow();

  // Fly-to-workspace animation
  const lastFlyToRef = useRef<number>(0);
  useEffect(() => {
    if (!flyToTarget || flyToTarget.requestId === lastFlyToRef.current) return;
    lastFlyToRef.current = flyToTarget.requestId;

    setCenter(flyToTarget.centerX, flyToTarget.centerY, {
      zoom: flyToTarget.zoom,
      duration: 700,
    });

    const timer = setTimeout(() => clearFlyToTarget(), 750);
    return () => clearTimeout(timer);
  }, [flyToTarget, setCenter, clearFlyToTarget]);

  // RAF-based viewport tracking: zoom updates immediately for smooth
  // semantic interpolation, full viewport (position + proximity) updates
  // on animation frames to avoid excessive store computation.
  const rafRef = useRef<number>(0);
  const lastVpRef = useRef<Viewport>({ x: 0, y: 0, zoom: 0 });
  const setZoom = useWorkspaceStore((s) => s.setZoom);

  const nodes = useMemo(
    () => buildNodes(workspaces, zoomTier, zoomProgress, zoom, viewMode),
    [workspaces, zoomTier, zoomProgress, zoom, viewMode],
  );

  const edges: Edge[] = useMemo(() => [], []);

  const handleViewportChange = useCallback(
    (vp: Viewport) => {
      lastVpRef.current = vp;
      // Immediately update zoom for smooth visual interpolation
      // (no debounce — this is cheap and drives all signal computation)
      setZoom(vp.zoom);
      // Throttle full viewport update (includes proximity computation)
      // to one per animation frame
      if (!rafRef.current) {
        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = 0;
          const current = lastVpRef.current;
          setViewport(current.x, current.y, current.zoom);
        });
      }
    },
    [setZoom, setViewport],
  );

  const handleNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      if (node.type === "workspaceTerritory" && onNodeClick) {
        const wsId = node.id.replace("ws-", "");
        onNodeClick(wsId);
      } else if (node.type === "itemNode" && onItemClick) {
        const itemId = node.id.replace("item-", "");
        setFocusedItem(itemId);
        onItemClick(itemId);
      }
    },
    [onNodeClick, onItemClick, setFocusedItem],
  );

  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    type: "pane" | "node";
    id?: string;
  } | null>(null);

  const handlePaneContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, type: "pane" });
  }, []);

  const handleNodeContextMenu = useCallback(
    (e: React.MouseEvent, node: Node) => {
      e.preventDefault();
      if (node.type === "itemNode") {
        setContextMenu({
          x: e.clientX,
          y: e.clientY,
          type: "node",
          id: node.id.replace("item-", ""),
        });
      } else {
        setContextMenu({ x: e.clientX, y: e.clientY, type: "pane" });
      }
    },
    [],
  );

  const handlePaneClick = useCallback(() => {
    setFocusedItem(null);
    setContextMenu(null);
  }, [setFocusedItem]);

  useEffect(() => {
    const handleGlobalClick = () => setContextMenu(null);
    window.addEventListener("click", handleGlobalClick);
    return () => window.removeEventListener("click", handleGlobalClick);
  }, []);

  return (
    <div className="h-full w-full relative bg-[var(--bg-primary)]">
      <CanvasBackground mode={backgroundMode} zoom={zoom} />

      <div className="h-full w-full relative z-[1]">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          onViewportChange={handleViewportChange}
          onNodeClick={handleNodeClick}
          onPaneClick={handlePaneClick}
          onPaneContextMenu={handlePaneContextMenu}
          onNodeContextMenu={handleNodeContextMenu}
          zoomOnScroll={true}
          panOnScroll={false}
          panOnDrag={true}
          zoomOnPinch={true}
          minZoom={VP.MIN_ZOOM}
          maxZoom={VP.MAX_ZOOM}
          defaultViewport={{ x: 80, y: 40, zoom: VP.DEFAULT_ZOOM }}
          proOptions={{ hideAttribution: true }}
          fitView={true}
          fitViewOptions={{ padding: 0.35, maxZoom: VP.DEFAULT_ZOOM + 0.05 }}
          deleteKeyCode={null}
          selectionKeyCode={null}
          style={{ background: "transparent" }}
        />
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <div
          className="fixed z-[100] min-w-[180px] rounded-2xl border border-[var(--border-default)]/50 bg-[var(--bg-elevated)]/95 p-1.5 shadow-[0_12px_28px_-12px_rgba(8,22,40,0.30)] backdrop-blur-xl"
          style={{
            top: Math.min(contextMenu.y, (typeof window !== "undefined" ? window.innerHeight : 800) - 320),
            left: Math.min(contextMenu.x, (typeof window !== "undefined" ? window.innerWidth : 1200) - 220),
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {contextMenu.type === "pane" ? (
            <ActionMenuContent
              onAction={() => setContextMenu(null)}
            />
          ) : (
            <div className="flex flex-col gap-0.5">
              <button
                type="button"
                onClick={() => {
                  onItemClick?.(contextMenu.id!);
                  setContextMenu(null);
                }}
                className="flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-[13px] font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
              >
                <ExternalLink className="h-4 w-4 shrink-0 text-[var(--text-tertiary)]" />
                <span className="flex-1 text-left">Open in Deep Edit</span>
              </button>
              <button
                type="button"
                onClick={() => setContextMenu(null)}
                className="flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-[13px] font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
              >
                <Link className="h-4 w-4 shrink-0 text-[var(--text-tertiary)]" />
                <span className="flex-1 text-left">Copy Link</span>
              </button>
              <div className="my-0.5 h-px bg-[var(--border-default)]/25" />
              <button
                type="button"
                onClick={() => setContextMenu(null)}
                className="flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-[13px] font-medium text-[var(--danger)] transition-colors hover:bg-[var(--danger)]/10"
              >
                <Trash2 className="h-4 w-4 shrink-0 text-[var(--danger)]/80" />
                <span className="flex-1 text-left">Delete Item</span>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function WorkspaceCanvas(props: WorkspaceCanvasProps) {
  return (
    <ReactFlowProvider>
      <WorkspaceCanvasInner {...props} />
    </ReactFlowProvider>
  );
}
