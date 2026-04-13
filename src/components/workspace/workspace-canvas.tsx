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
} from "lucide-react";
import { ActionMenuContent } from "@/components/workspace/shared-action-menu";

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
  // Asymptotic approach: grows toward maxScale but never exceeds it
  return 1 + (maxScale - 1) * (1 - Math.exp(-(ratio - 1) * 1.2));
}

/**
 * Smooth interpolation helper for progressive reveal.
 * Maps a zoom value to a 0-1 range between start and end thresholds.
 */
function smoothStep(zoom: number, start: number, end: number): number {
  const t = Math.max(0, Math.min(1, (zoom - start) / (end - start)));
  return t * t * (3 - 2 * t); // Hermite smoothstep
}

/* ===================================================================
   Node Data Types
   =================================================================== */

type WorkspaceNodeData = {
  workspace: WorkspaceData;
  zoomTier: "landscape" | "summary" | "detail";
  zoomProgress: number;
  zoom: number;
  tint: string;
};

type ItemNodeData = {
  item: WorkspaceItemData;
  zoomTier: "landscape" | "summary" | "detail";
  zoomProgress: number;
  zoom: number;
  groupLabel?: string;
  isFirst?: boolean;
};

type GroupLabelNodeData = {
  label: string;
  variant: string;
  count: number;
  zoom: number;
};

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
  const { workspace, zoom, tint } = data;
  const colors = getTerritoryColor(tint);

  // Smooth transitions between states
  const landscapeToSummary = smoothStep(zoom, 0.10, 0.22);
  const summaryToDetail = smoothStep(zoom, 0.35, 0.55);

  // Territory region opacity adapts dynamically with zoom
  const regionOpacity = 0.3 + (1 - landscapeToSummary) * 0.7;

  // Identity scale: large at landscape, naturally shrinks as zoom increases
  // Uses a damped curve to avoid enormously oversized text at far zoom
  const identityScale = stableScale(zoom, 0.22);

  // Blend between centered (landscape) and anchored (summary+) positioning
  // via opacity crossfade for smooth transition
  const showCentered = 1 - landscapeToSummary;
  const showAnchored = landscapeToSummary;

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
              ellipse ${90 - summaryToDetail * 20}% ${80 - summaryToDetail * 15}% at 50% ${35 + summaryToDetail * 10}%,
              ${colors.core} 0%,
              ${colors.mid} ${40 + summaryToDetail * 15}%,
              ${colors.outer} ${70 + summaryToDetail * 10}%,
              transparent 100%
            )
          `,
          transition: "opacity 0.3s ease",
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
          opacity: Math.max(0.08, 0.6 * (1 - landscapeToSummary * 0.5)),
          transition: "opacity 0.4s ease",
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
            transition: "opacity 0.2s ease",
          }}
        >
          <div className="flex h-[240px] w-[240px] items-center justify-center rounded-[3.5rem] bg-[var(--bg-elevated)]/40 backdrop-blur-xl border border-[var(--border-default)]/15 shadow-[0_16px_48px_-12px_rgba(7,20,35,0.12)]">
            <span className="text-[120px] leading-none" style={{ filter: "drop-shadow(0 6px 12px rgba(0,0,0,0.08))" }}>
              {workspace.emoji}
            </span>
          </div>

          <div className="flex flex-col items-center gap-4">
            <h3 className="font-bold text-[var(--text-primary)] text-[80px] tracking-[-0.02em] text-center max-w-[2200px] leading-[1.1]" style={{ textShadow: "0 3px 16px rgba(0,0,0,0.06)" }}>
              {workspace.name}
            </h3>
            <div className="flex items-center gap-5">
              <span className="text-[36px] font-medium tracking-wide text-[var(--text-tertiary)] bg-[var(--bg-secondary)]/25 backdrop-blur-md px-8 py-3 rounded-full border border-[var(--border-default)]/15">
                {workspace.itemCount} item{workspace.itemCount !== 1 ? "s" : ""}
              </span>
              <StatusDot status={workspace.status} className="h-6 w-6" />
            </div>
          </div>

          {/* Landscape summary chips */}
          <div className="flex flex-wrap items-center justify-center gap-3 mt-2 max-w-[1800px]">
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
          className="absolute top-[60px] left-[80px] flex items-center gap-5 pointer-events-none z-10"
          style={{
            transform: `scale(${stableScale(zoom, 0.35)})`,
            transformOrigin: "top left",
            opacity: showAnchored,
            transition: "opacity 0.2s ease",
          }}
        >
          <span className="text-[48px] leading-none">{workspace.emoji}</span>
          <h3 className="font-semibold text-[var(--text-primary)] text-[44px] tracking-[-0.01em]" style={{ textShadow: "0 2px 8px rgba(0,0,0,0.04)" }}>
            {workspace.name}
          </h3>
          <span className="text-[24px] font-medium text-[var(--text-tertiary)]/50 ml-3">
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
  const scale = stableScale(data.zoom, 0.35, 3);
  const visibility = smoothStep(data.zoom, 0.16, 0.25);

  return (
    <div
      className="flex items-center gap-6 px-6 select-none pointer-events-none"
      style={{
        transform: `scale(${scale})`,
        transformOrigin: "left center",
        opacity: visibility,
        transition: "opacity 0.15s ease",
      }}
    >
      <span className="text-[44px] font-bold uppercase tracking-[0.14em] text-[var(--text-tertiary)]/50">
        {data.label}
      </span>
      <span className="text-[32px] tabular-nums text-[var(--text-tertiary)]/30 font-semibold">
        {data.count}
      </span>
      <div className="w-[40px] h-[3px] rounded-full bg-[var(--border-default)]/20 ml-4" />
    </div>
  );
}

/* ===================================================================
   Item Node u2014 progressive structural recomposition

   Items fade in during summary transition, gain detail progressively.
   At detail level, content expands but never becomes enormous.
   =================================================================== */

function ItemNode({ data }: { data: ItemNodeData }) {
  const { item, zoom } = data;
  const meta = CANONICAL_WORKSPACE_TYPE_META[item.itemType as CanonicalWorkspaceType];
  const Icon = meta?.icon;
  const [hovered, setHovered] = useState(false);
  const focusedItemId = useWorkspaceStore((s) => s.focusedItemId);
  const deepEditTargets = useWorkspaceStore((s) => s.deepEditTargets);
  const isFocused = focusedItemId === item.id;
  const isOpenInDeepEdit = deepEditTargets.some((t) => t.item.id === item.id);

  // Semantic zoom representation tiers for items:
  // chip: 0.20-0.35 — compact icon+title chip
  // card: 0.35-0.50 — small card with title, status, preview appearing
  // detail: >0.50 — full card with type-specific touch content
  const chipToCard = smoothStep(zoom, 0.28, 0.38);
  const cardToDetail = smoothStep(zoom, 0.42, 0.55);
  const itemAppear = smoothStep(zoom, 0.22, 0.30);

  const isChip = chipToCard < 0.3;
  const isDetail = cardToDetail > 0.5;

  // Perceptually stable counter-scale: items stay ~280-350px on screen max
  const scale = stableScale(zoom, 0.4, 3);

  const canvasWidth = TERRITORY.ITEM_COL_WIDTH - 20;
  const canvasHeight = isDetail
    ? Math.min(TERRITORY.ITEM_ROW_HEIGHT * 2, 520)
    : isChip
      ? 80
      : TERRITORY.ITEM_ROW_HEIGHT - 20;

  const dynamicBorderWidth = Math.max(1, 1 / zoom);
  const borderColor = isFocused
    ? "color-mix(in oklab, var(--accent-cyan) 40%, var(--border-default))"
    : isOpenInDeepEdit && !isFocused
      ? "color-mix(in oklab, var(--accent-cyan) 18%, var(--border-default))"
      : hovered
        ? "color-mix(in oklab, var(--accent-cyan) 22%, var(--border-default))"
        : "color-mix(in srgb, var(--border-default) 50%, transparent)";

  return (
    <div
      style={{
        width: canvasWidth,
        height: canvasHeight,
        transform: `scale(${scale})`,
        transformOrigin: "top left",
        opacity: itemAppear,
        transition: "opacity 0.2s ease",
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="relative"
    >
      <div
        className={cn(
          "group relative flex overflow-hidden w-full h-full",
          "bg-[var(--bg-elevated)]/92",
          "transition-all duration-300 ease-[var(--ease-standard)]",
          isChip ? "rounded-[14px] flex-row items-center gap-3 px-4" : "rounded-[20px] flex-col gap-2",
          isOpenInDeepEdit && !isFocused && "opacity-80",
        )}
        style={{
          border: `${dynamicBorderWidth}px solid ${borderColor}`,
          boxShadow: isFocused
            ? "0 12px 30px -14px rgba(14,142,232,0.22), 0 0 0 1px color-mix(in oklab, var(--accent-cyan) 20%, transparent)"
            : isOpenInDeepEdit
              ? "0 8px 22px -14px rgba(14,142,232,0.12)"
              : hovered
                ? "0 10px 26px -16px rgba(7,20,35,0.18)"
                : "0 6px 18px -14px rgba(7,20,35,0.12)",
        }}
      >
        {isOpenInDeepEdit && (
          <div className="absolute -right-2 top-1/2 -translate-y-1/2 flex items-center gap-0.5 pointer-events-none">
            <div className={cn(
              "h-8 w-[4px] rounded-full transition-all duration-300",
              isFocused ? "bg-[var(--accent-cyan)] shadow-[0_0_8px_2px_rgba(14,142,232,0.35)]" : "bg-[var(--accent-cyan)]/30",
            )} />
          </div>
        )}

        {isChip ? (
          /* CHIP TIER: icon + title, compact */
          <>
            {Icon && (
              <div
                className="flex h-8 w-8 items-center justify-center rounded-[10px] shrink-0"
                style={{ backgroundColor: `color-mix(in oklab, ${meta?.color ?? "#637083"} 10%, var(--bg-secondary))` }}
              >
                <Icon className="h-4 w-4" style={{ color: meta?.color ?? "var(--text-secondary)" }} />
              </div>
            )}
            <span className="flex-1 truncate text-[15px] font-medium text-[var(--text-primary)] tracking-tight">
              {item.title}
            </span>
            <StatusDot status={item.status === "completed" ? "completed" : item.status === "active" ? "active" : "idle"} />
          </>
        ) : isDetail ? (
          /* DETAIL TIER: Type-specific touch content */
          <div className="flex-1 overflow-hidden w-full h-full pointer-events-auto">
            <TouchContent item={item} />
          </div>
        ) : (
          /* CARD TIER: title, status, preview */
          <>
            <div className="flex items-center gap-4 px-6 pt-5">
              <div
                className={cn(
                  "flex h-11 w-11 items-center justify-center rounded-[13px] shrink-0",
                  isFocused && "ring-1 ring-[var(--accent-cyan)]/20",
                )}
                style={{ backgroundColor: `color-mix(in oklab, ${meta?.color ?? "#637083"} ${isFocused ? "14" : "10"}%, var(--bg-secondary))` }}
              >
                {Icon && <Icon className="h-5 w-5" style={{ color: meta?.color ?? "var(--text-secondary)" }} />}
              </div>
              <span className="flex-1 truncate text-lg font-semibold text-[var(--text-primary)] tracking-tight">{item.title}</span>
              <StatusDot status={item.status === "completed" ? "completed" : item.status === "active" ? "active" : "idle"} />
            </div>
            {chipToCard > 0.5 && (
              <>
                <div className="flex-1 flex flex-col justify-center min-h-0 mt-1 px-6">
                  {cardToDetail > 0.2 && item.preview && (
                    <p className="pl-[60px] text-[15px] leading-[1.6] text-[var(--text-tertiary)] line-clamp-3">{item.preview}</p>
                  )}
                </div>
                <div className="flex items-center justify-between pl-[80px] pr-6 mt-auto shrink-0 pb-5 pt-1">
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
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/* ===================================================================
   TouchContent u2014 Type-specific detail-tier rendering
   =================================================================== */

function TouchContent({ item }: { item: WorkspaceItemData }) {
  const meta = CANONICAL_WORKSPACE_TYPE_META[item.itemType as CanonicalWorkspaceType];
  const Icon = meta?.icon;

  switch (item.itemType) {
    case "note":
      return (
        <div className="p-5 h-full overflow-hidden">
          <div className="flex items-center gap-2 mb-3">
            {Icon && <Icon className="h-4 w-4" style={{ color: meta?.color }} />}
            <span className="text-[14px] font-semibold text-[var(--text-primary)] truncate">{item.title}</span>
          </div>
          <div className="text-[14px] leading-[1.8] text-[var(--text-secondary)] font-[var(--font-manrope)]">
            {(item.preview ?? "").split(/\. /).map((sentence, i) => (
              <p key={i} className="mb-2">{sentence}{i < (item.preview ?? "").split(/\. /).length - 1 ? "." : ""}</p>
            ))}
          </div>
        </div>
      );

    case "code":
      return (
        <div className="h-full flex flex-col overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--border-default)]/20">
            {Icon && <Icon className="h-4 w-4" style={{ color: meta?.color }} />}
            <span className="text-[13px] font-semibold text-[var(--text-primary)] truncate">{item.title}</span>
          </div>
          <div className="flex-1 bg-[#1e1e2e] p-4 overflow-hidden">
            <pre className="font-mono text-[12px] leading-[1.7] text-[#cdd6f4] whitespace-pre-wrap">{item.preview ?? "// No code yet"}</pre>
          </div>
        </div>
      );

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
        <div className="h-full flex flex-col items-center justify-center p-5" style={{ background: "linear-gradient(135deg, var(--bg-secondary)/30, var(--bg-elevated))" }}>
          <div className="w-[80px] h-[100px] rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-default)]/30 flex flex-col items-center justify-center mb-3 shadow-sm">
            {Icon && <Icon className="h-6 w-6" style={{ color: meta?.color }} />}
            <div className="mt-2 w-10 h-[2px] rounded-full bg-[var(--border-default)]/30" />
            <div className="mt-1 w-8 h-[2px] rounded-full bg-[var(--border-default)]/20" />
          </div>
          <span className="text-[13px] font-semibold text-[var(--text-primary)]">{item.title}</span>
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

const STOPWORDS = new Set(["the", "a", "an", "in", "on", "of", "for", "to", "and", "or", "is", "it", "at", "by", "with", "from"]);

function heuristicTopicGroups(items: WorkspaceItemData[]): { label: string; items: WorkspaceItemData[] }[] {
  const wordMap: Record<string, WorkspaceItemData[]> = {};
  const itemWords: Map<string, string[]> = new Map();

  for (const item of items) {
    const words = item.title
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, "")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w));
    itemWords.set(item.id, words);
    for (const w of words) {
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

  // Remaining unassigned items group by type+status
  const remaining = items.filter((it) => !assigned.has(it.id));
  const groups: { label: string; items: WorkspaceItemData[] }[] = [];

  for (const cluster of clusters) {
    const clusterItems = items.filter((it) => cluster.items.has(it.id));
    const label = cluster.keyword.charAt(0).toUpperCase() + cluster.keyword.slice(1);
    groups.push({ label, items: clusterItems });
  }

  if (remaining.length > 0) {
    const byType: Record<string, WorkspaceItemData[]> = {};
    for (const it of remaining) {
      const key = it.itemType;
      if (!byType[key]) byType[key] = [];
      byType[key].push(it);
    }
    for (const [type, typeItems] of Object.entries(byType)) {
      const meta = CANONICAL_WORKSPACE_TYPE_META[type as CanonicalWorkspaceType];
      groups.push({ label: meta?.label ?? type, items: typeItems });
    }
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

const ITEMS_PER_COL = 3;
const GROUP_COL_WIDTH = 1800;
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
  const isLandscape = zoomTier === "landscape";
  const showItems = !isLandscape || (isLandscape && zoomProgress > 0.85);

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
      data: { workspace: ws, zoomTier, zoomProgress, zoom, tint } satisfies WorkspaceNodeData,
      draggable: false,
      selectable: true,
      style: { width: territoryWidth, height: territoryHeight, zIndex: 0 },
    });

    if (!showItems) return;

    // Build groups based on viewMode
    let groups: { label: string; variant: string; items: WorkspaceItemData[] }[];

    if (viewMode === "timeline") {
      const dateGroups = timelineDateGroups(ws.items);
      groups = dateGroups.map((g) => ({ label: g.label, variant: "neutral", items: g.items }));
    } else if (viewMode === "byTopic") {
      const topicGroups = heuristicTopicGroups(ws.items);
      groups = topicGroups.map((g) => ({ label: g.label, variant: tint, items: g.items }));
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

    // Layout: distribute groups across 2 columns to spread content
    const headerY = 500;
    const groupsPerColumn = Math.ceil(groups.length / 2);
    const colOffsets = [120, territoryWidth / 2 + 60];

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
          data: { label: g.label, variant: g.variant, count: g.items.length, zoom } satisfies GroupLabelNodeData,
          draggable: false,
          selectable: false,
          style: { width: 1200, zIndex: 1 },
        });

        let itemY = headerY + 120;
        for (let ii = 0; ii < g.items.length; ii++) {
          const item = g.items[ii];
          nodes.push({
            id: `item-${item.id}`,
            type: "itemNode",
            parentId: `ws-${ws.id}`,
            position: { x: groupX, y: itemY },
            data: { item, zoomTier, zoomProgress, zoom, groupLabel: g.label, isFirst: ii === 0 } satisfies ItemNodeData,
            draggable: true,
            selectable: true,
            style: { zIndex: 2 },
          });
          itemY += ROW_HEIGHT;
        }
        groupX += 1400;
      }
    } else {
      // byType / byTopic: 2-column layout
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
          data: { label: g.label, variant: g.variant, count: g.items.length, zoom } satisfies GroupLabelNodeData,
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
              y: item.canvasY ?? y + itemRow * ROW_HEIGHT,
            },
            data: { item, zoomTier, zoomProgress, zoom, groupLabel: g.label, isFirst: ii === 0 } satisfies ItemNodeData,
            draggable: true,
            selectable: true,
            style: { zIndex: 2 },
          });
        }

        colYCursors[colIdx] = y + Math.ceil(g.items.length / itemsPerRow) * ROW_HEIGHT + 80;
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

function CanvasBackground({ mode }: { mode: "dots" | "blank" | "grid" }) {
  if (mode === "blank") return null;

  const isDots = mode === "dots";
  return (
    <div
      className="absolute inset-0 pointer-events-none z-0"
      style={{
        backgroundImage: isDots
          ? "radial-gradient(circle, var(--border-default) 1.2px, transparent 1.2px)"
          : "linear-gradient(var(--border-default) 0.5px, transparent 0.5px), linear-gradient(90deg, var(--border-default) 0.5px, transparent 0.5px)",
        backgroundSize: isDots ? "28px 28px" : "40px 40px",
        opacity: isDots ? 0.55 : 0.2,
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

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const nodes = useMemo(
    () => buildNodes(workspaces, zoomTier, zoomProgress, zoom, viewMode),
    [workspaces, zoomTier, zoomProgress, zoom, viewMode],
  );

  const edges: Edge[] = useMemo(() => [], []);

  const handleViewportChange = useCallback(
    (vp: Viewport) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        setViewport(vp.x, vp.y, vp.zoom);
      }, 30);
    },
    [setViewport],
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
      <CanvasBackground mode={backgroundMode} />

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
