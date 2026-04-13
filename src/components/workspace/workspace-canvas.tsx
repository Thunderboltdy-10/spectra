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
import { ArtifactContent, ThreadContent } from "./focus-panel";

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
 * Semantic zoom stable scale.
 * Maps zoom to a smooth counter-scale that keeps content perceptually stable.
 * Uses a damped curve instead of linear inverse for smoother progressive reveal.
 */
function stableScale(zoom: number, anchorZoom: number): number {
  if (zoom >= anchorZoom) return 1;
  // Damped inverse: less dramatic at far zoom, preventing enormous elements
  const ratio = anchorZoom / zoom;
  // Clamp with a smooth ease-out curve
  return Math.min(ratio, 4) * (1 - Math.exp(-ratio * 0.8)) / (1 - Math.exp(-4 * 0.8));
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
  const scale = stableScale(data.zoom, 0.35);
  // Group labels start appearing at summary tier transition
  const visibility = smoothStep(data.zoom, 0.16, 0.25);

  return (
    <div
      className="flex items-center gap-8 px-6 select-none pointer-events-none w-full"
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
      <div className="flex-1 h-[3px] bg-[var(--border-default)]/20 ml-6" />
    </div>
  );
}

/* ===================================================================
   Item Node u2014 progressive structural recomposition

   Items fade in during summary transition, gain detail progressively.
   At detail level, content expands but never becomes enormous.
   =================================================================== */

function ItemNode({ data }: { data: ItemNodeData }) {
  const { item, zoomTier, zoomProgress, zoom } = data;
  const meta =
    CANONICAL_WORKSPACE_TYPE_META[item.itemType as CanonicalWorkspaceType];
  const Icon = meta?.icon;
  const [hovered, setHovered] = useState(false);
  const focusedItemId = useWorkspaceStore((s) => s.focusedItemId);
  const deepEditTargets = useWorkspaceStore((s) => s.deepEditTargets);
  const isFocused = focusedItemId === item.id;
  const isOpenInDeepEdit = deepEditTargets.some((t) => t.item.id === item.id);

  const isSummary = zoomTier === "summary";
  const isDetail = zoomTier === "detail";

  // Progressive reveal thresholds
  const showPreview = isDetail || (isSummary && zoomProgress > 0.6);
  const showMeta = isDetail || (isSummary && zoomProgress > 0.4);

  // Item opacity fades in during summary tier
  const itemVisibility = isSummary
    ? smoothStep(zoom, 0.16, 0.25)
    : 1;

  // Counter-scale: clamped more tightly to prevent enormous items at deep zoom
  const scale = stableScale(zoom, 0.4);

  const canvasWidth = TERRITORY.ITEM_COL_WIDTH - 20;
  // Items grow taller at detail level but don't dominate
  const canvasHeight = isDetail && zoomProgress > 0.5
    ? Math.min(TERRITORY.ITEM_ROW_HEIGHT * 2.2, 580)
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
        opacity: itemVisibility,
        transition: "opacity 0.2s ease",
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="relative"
    >
      <div
        className={cn(
          "group relative flex flex-col gap-2 rounded-[20px] overflow-hidden w-full h-full",
          "bg-[var(--bg-elevated)]/92",
          "transition-all duration-300 ease-[var(--ease-standard)]",
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
        {/* Active connection indicator */}
        {isOpenInDeepEdit && (
          <div className="absolute -right-2 top-1/2 -translate-y-1/2 flex items-center gap-0.5 pointer-events-none">
            <div
              className={cn(
                "h-8 w-[4px] rounded-full transition-all duration-300",
                isFocused
                  ? "bg-[var(--accent-cyan)] shadow-[0_0_8px_2px_rgba(14,142,232,0.35)]"
                  : "bg-[var(--accent-cyan)]/30",
              )}
            />
          </div>
        )}

        {isDetail && zoomProgress > 0.5 ? (
          /* DETAIL TIER: Inline deep-edit content */
          <div className="flex-1 overflow-hidden w-full h-full pointer-events-auto bg-[var(--bg-elevated)]">
            {item.itemType === "thread" ? <ThreadContent item={item} /> : <ArtifactContent item={item} />}
          </div>
        ) : (
          /* SUMMARY / early DETAIL: Structured card */
          <>
            {/* Header row */}
            <div className={cn("flex items-center gap-4 px-6 pt-5", isSummary && zoomProgress < 0.4 && "pb-5")}>
              <div
                className={cn(
                  "flex h-11 w-11 items-center justify-center rounded-[13px] transition-all duration-200 shrink-0",
                  isFocused && "ring-1 ring-[var(--accent-cyan)]/20",
                )}
                style={{
                  backgroundColor: `color-mix(in oklab, ${meta?.color ?? "#637083"} ${isFocused ? "14" : "10"}%, var(--bg-secondary))`,
                }}
              >
                {Icon && (
                  <Icon
                    className="h-5.5 w-5.5"
                    style={{ color: meta?.color ?? "var(--text-secondary)" }}
                  />
                )}
              </div>
              <span className="flex-1 truncate text-lg font-semibold text-[var(--text-primary)] tracking-tight">
                {item.title}
              </span>
              <StatusDot
                status={item.status === "completed" ? "completed" : item.status === "active" ? "active" : "idle"}
              />
            </div>

            {/* Preview + meta u2014 progressively revealed */}
            {showMeta && (
              <>
                <div className="flex-1 flex flex-col justify-center min-h-0 mt-1 px-6">
                  {showPreview && item.preview && (
                    <p className="pl-[60px] text-[15px] leading-[1.6] text-[var(--text-tertiary)] line-clamp-3">
                      {item.preview}
                    </p>
                  )}
                </div>

                {/* Meta row */}
                <div className="flex items-center justify-between pl-[80px] pr-6 mt-auto shrink-0 pb-5 pt-1">
                  <span
                    className="rounded-md px-2 py-1 text-sm font-semibold uppercase tracking-[0.1em]"
                    style={{
                      backgroundColor: isFocused
                        ? `color-mix(in oklab, ${meta?.color ?? "var(--text-tertiary)"} 8%, transparent)`
                        : "transparent",
                      color: `color-mix(in oklab, ${meta?.color ?? "var(--text-tertiary)"} ${isFocused ? "80" : "50"}%, transparent)`,
                    }}
                  >
                    {meta?.label ?? item.itemType}
                  </span>
                  {item.meta && (
                    <span className="text-sm font-medium text-[var(--text-secondary)]">
                      {item.meta}
                    </span>
                  )}
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
   Build Nodes u2014 layout engine with semantic zoom awareness

   Key changes:
   - Items appear DURING summary tier transition, not only after
   - Group labels appear earlier and gradually
   - Layout is tighter to prevent empty space at deep zoom
   =================================================================== */

function buildNodes(
  workspaces: WorkspaceData[],
  zoomTier: "landscape" | "summary" | "detail",
  zoomProgress: number,
  zoom: number,
  viewMode: "byType" | "byTopic" | "timeline" = "byType",
): Node[] {
  const nodes: Node[] = [];
  const isLandscape = zoomTier === "landscape";

  // At deep zoom, don't make rows too tall to prevent dominance
  const rowHeight =
    zoomTier === "detail"
      ? Math.min(TERRITORY.ITEM_ROW_HEIGHT * 2.2, 580)
      : TERRITORY.ITEM_ROW_HEIGHT;

  // Show items earlier: even at late landscape (approaching summary)
  const showItems = !isLandscape || (isLandscape && zoomProgress > 0.85);

  workspaces.forEach((ws, idx) => {
    const col = idx % TERRITORY.COLS;
    const row = Math.floor(idx / TERRITORY.COLS);
    const tint = dominantTint(ws);

    const grouped: Record<string, WorkspaceItemData[]> = {};
    for (const item of ws.items) {
      const key = item.itemType;
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(item);
    }

    let requiredHeight = 700; // Header area (smaller to reduce bottom empty space)
    for (const [, group] of Object.entries(TYPE_GROUP_LABELS)) {
      const items = group.types.flatMap((t) => grouped[t] ?? []);
      if (items.length > 0) {
        requiredHeight +=
          100 + Math.ceil(items.length / TERRITORY.ITEMS_PER_ROW) * rowHeight + 30;
      }
    }
    const territoryHeight = Math.max(TERRITORY.HEIGHT, requiredHeight);
    const territoryWidth = Math.max(
      TERRITORY.WIDTH,
      80 + TERRITORY.ITEMS_PER_ROW * TERRITORY.ITEM_COL_WIDTH + 60,
    );

    // Territory node
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

    // Items: shown during summary+ AND late landscape for gradual reveal
    if (!showItems) return;

    if (viewMode === "timeline") {
      const sortedItems = [...ws.items].sort(
        (a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0),
      );

      nodes.push({
        id: `group-${ws.id}-timeline`,
        type: "groupLabel",
        parentId: `ws-${ws.id}`,
        position: { x: 80, y: 700 },
        data: {
          label: "Recent Activity",
          variant: "neutral",
          count: sortedItems.length,
          zoom,
        } satisfies GroupLabelNodeData,
        draggable: false,
        selectable: false,
        style: { width: TERRITORY.WIDTH - 160, zIndex: 1 },
      });

      sortedItems.forEach((item, itemIdx) => {
        const itemCol = itemIdx % TERRITORY.ITEMS_PER_ROW;
        const itemRow = Math.floor(itemIdx / TERRITORY.ITEMS_PER_ROW);
        nodes.push({
          id: `item-${item.id}`,
          type: "itemNode",
          parentId: `ws-${ws.id}`,
          position: {
            x: 80 + itemCol * TERRITORY.ITEM_COL_WIDTH,
            y: 800 + itemRow * rowHeight,
          },
          data: {
            item,
            zoomTier,
            zoomProgress,
            zoom,
            groupLabel: "Recent Activity",
            isFirst: itemIdx === 0,
          } satisfies ItemNodeData,
          draggable: true,
          selectable: true,
          style: { zIndex: 2 },
        });
      });
    } else if (viewMode === "byTopic") {
      nodes.push({
        id: `group-${ws.id}-topic`,
        type: "groupLabel",
        parentId: `ws-${ws.id}`,
        position: { x: 80, y: 700 },
        data: {
          label: ws.name,
          variant: tint,
          count: ws.items.length,
          zoom,
        } satisfies GroupLabelNodeData,
        draggable: false,
        selectable: false,
        style: { width: TERRITORY.WIDTH - 160, zIndex: 1 },
      });

      ws.items.forEach((item, itemIdx) => {
        const itemCol = itemIdx % TERRITORY.ITEMS_PER_ROW;
        const itemRow = Math.floor(itemIdx / TERRITORY.ITEMS_PER_ROW);
        nodes.push({
          id: `item-${item.id}`,
          type: "itemNode",
          parentId: `ws-${ws.id}`,
          position: {
            x: 80 + itemCol * TERRITORY.ITEM_COL_WIDTH,
            y: 800 + itemRow * rowHeight,
          },
          data: {
            item,
            zoomTier,
            zoomProgress,
            zoom,
            groupLabel: ws.name,
            isFirst: itemIdx === 0,
          } satisfies ItemNodeData,
          draggable: true,
          selectable: true,
          style: { zIndex: 2 },
        });
      });
    } else {
      // Default byType lens
      let groupY = 700;

      for (const [, group] of Object.entries(TYPE_GROUP_LABELS)) {
        const items = group.types.flatMap((t) => grouped[t] ?? []);
        if (items.length === 0) continue;

        nodes.push({
          id: `group-${ws.id}-${group.label}`,
          type: "groupLabel",
          parentId: `ws-${ws.id}`,
          position: { x: 80, y: groupY },
          data: {
            label: group.label,
            variant: TYPE_TO_TINT[group.types[0]],
            count: items.length,
            zoom,
          } satisfies GroupLabelNodeData,
          draggable: false,
          selectable: false,
          style: { width: TERRITORY.WIDTH - 160, zIndex: 1 },
        });

        groupY += 100;

        items.forEach((item, itemIdx) => {
          const itemCol = itemIdx % TERRITORY.ITEMS_PER_ROW;
          const itemRow = Math.floor(itemIdx / TERRITORY.ITEMS_PER_ROW);
          nodes.push({
            id: `item-${item.id}`,
            type: "itemNode",
            parentId: `ws-${ws.id}`,
            position: {
              x: item.canvasX ?? 80 + itemCol * TERRITORY.ITEM_COL_WIDTH,
              y: item.canvasY ?? groupY + itemRow * rowHeight,
            },
            data: {
              item,
              zoomTier,
              zoomProgress,
              zoom,
              groupLabel: group.label,
              isFirst: itemIdx === 0,
            } satisfies ItemNodeData,
            draggable: true,
            selectable: true,
            style: { zIndex: 2 },
          });
        });

        groupY +=
          Math.ceil(items.length / TERRITORY.ITEMS_PER_ROW) * rowHeight + 30;
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
          ? "radial-gradient(circle, var(--border-default) 1px, transparent 1px)"
          : "linear-gradient(var(--border-default) 0.5px, transparent 0.5px), linear-gradient(90deg, var(--border-default) 0.5px, transparent 0.5px)",
        backgroundSize: isDots ? "28px 28px" : "40px 40px",
        opacity: isDots ? 0.35 : 0.2,
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
