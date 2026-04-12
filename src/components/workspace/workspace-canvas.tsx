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

/* ═══════════════════════════════════════════════════════════════
   Palette & Helpers
   ═══════════════════════════════════════════════════════════════ */

/** Soft pastel palette for workspace territory regions */
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

/** Determine dominant tint for a workspace from its items */
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
 * Compute a counter-scale factor so that content rendered inside the
 * ReactFlow node maintains a stable perceived size across zoom levels.
 * This is the key to semantic zoom: text/icons don't shrink to nothing.
 */
function stableScale(zoom: number, targetZoom: number): number {
  if (zoom >= targetZoom) return 1;
  return targetZoom / zoom;
}

/* ═══════════════════════════════════════════════════════════════
   Node Data Types
   ═══════════════════════════════════════════════════════════════ */

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

/* ═══════════════════════════════════════════════════════════════
   Workspace Territory Node — Semantic Zoom Recomposition

   This node is the key architectural piece. Instead of rendering
   a simple scaled header, it structurally recomposes based on
   the current zoom tier:

   LANDSCAPE: Large soft pastel region with centered name/emoji/status.
              Reads as a meaningful envelope from far away.
              Items are NOT shown — only the territory identity.

   SUMMARY:   Territory fades to a lighter region.
              Workspace name stays visible as a floating label.
              Items begin appearing as compact chips below groups.

   DETAIL:    Territory becomes the lightest wash.
              Full item cards with previews become available.
              Workspace label becomes a small anchored header.
   ═══════════════════════════════════════════════════════════════ */

function WorkspaceTerritoryNode({ data }: { data: WorkspaceNodeData }) {
  const { workspace, zoomTier, zoomProgress, zoom, tint } = data;
  const colors = getTerritoryColor(tint);

  // Counter-scale to keep the identity readable at all zoom levels
  const identityScale = stableScale(zoom, 0.25);

  // Opacity of territory region increases at landscape, subtle at detail
  const regionOpacity =
    zoomTier === "landscape"
      ? 0.9 + zoomProgress * 0.1
      : zoomTier === "summary"
        ? 0.7 - zoomProgress * 0.3
        : 0.3;

  // At landscape tier, show a large centered identity.
  // At summary/detail, show a smaller anchored top-left label.
  const isLandscape = zoomTier === "landscape";

  return (
    <div
      style={{ width: "100%", height: "100%", pointerEvents: "none" }}
      className="relative"
    >
      {/* ── Soft pastel radial territory region ── */}
      <div
        className="absolute inset-0 rounded-[80px]"
        style={{
          opacity: regionOpacity,
          background: `
            radial-gradient(ellipse 90% 80% at 50% 35%, ${colors.core} 0%, ${colors.mid} 40%, ${colors.outer} 70%, transparent 100%)
          `,
          transition: "opacity 0.4s ease",
        }}
      />

      {/* ── Territory boundary — soft dashed border for orientation ── */}
      <div
        className="absolute inset-[12px] rounded-[72px]"
        style={{
          border: `2px dashed ${colors.border}`,
          opacity: zoomTier === "landscape" ? 0.5 : zoomTier === "summary" ? 0.3 : 0.15,
          transition: "opacity 0.4s ease",
        }}
      />

      {/* ── Identity layer ── */}
      {isLandscape ? (
        /* LANDSCAPE: Large centered identity */
        <div
          className="absolute inset-0 flex flex-col items-center justify-center gap-8"
          style={{
            transform: `scale(${identityScale})`,
            transformOrigin: "center center",
            transition: "transform 0.15s linear",
          }}
        >
          {/* Emoji container */}
          <div className="flex h-[280px] w-[280px] items-center justify-center rounded-[4rem] bg-[var(--bg-elevated)]/40 backdrop-blur-xl border border-[var(--border-default)]/15 shadow-[0_16px_48px_-12px_rgba(7,20,35,0.12)]">
            <span className="text-[160px] leading-none" style={{ filter: "drop-shadow(0 6px 12px rgba(0,0,0,0.08))" }}>
              {workspace.emoji}
            </span>
          </div>

          {/* Name + meta */}
          <div className="flex flex-col items-center gap-5">
            <h3 className="font-bold text-[var(--text-primary)] text-[100px] tracking-[-0.02em] text-center max-w-[2400px] leading-[1.1]" style={{ textShadow: "0 3px 16px rgba(0,0,0,0.06)" }}>
              {workspace.name}
            </h3>
            <div className="flex items-center gap-6">
              <span className="text-[40px] font-medium tracking-wide text-[var(--text-tertiary)] bg-[var(--bg-secondary)]/25 backdrop-blur-md px-10 py-4 rounded-full border border-[var(--border-default)]/15">
                {workspace.itemCount} item{workspace.itemCount !== 1 ? "s" : ""}
              </span>
              <StatusDot status={workspace.status} className="h-8 w-8" />
            </div>
          </div>

          {/* Landscape-only: item type summary chips */}
          <div className="flex flex-wrap items-center justify-center gap-4 mt-4 max-w-[2000px]">
            {Object.entries(TYPE_GROUP_LABELS).map(([key, group]) => {
              const count = workspace.items.filter((i) =>
                group.types.includes(i.itemType as CanonicalWorkspaceType)
              ).length;
              if (count === 0) return null;
              return (
                <span
                  key={key}
                  className="text-[32px] font-medium text-[var(--text-tertiary)]/70 bg-[var(--bg-secondary)]/20 px-8 py-3 rounded-full"
                >
                  {group.label} {count}
                </span>
              );
            })}
          </div>
        </div>
      ) : (
        /* SUMMARY / DETAIL: Smaller anchored top-left label */
        <div
          className="absolute top-[60px] left-[80px] flex items-center gap-6 pointer-events-none z-10"
          style={{
            transform: `scale(${stableScale(zoom, 0.35)})`,
            transformOrigin: "top left",
            transition: "transform 0.15s linear",
          }}
        >
          <span className="text-[56px] leading-none">{workspace.emoji}</span>
          <h3 className="font-semibold text-[var(--text-primary)] text-[52px] tracking-[-0.01em]" style={{ textShadow: "0 2px 8px rgba(0,0,0,0.04)" }}>
            {workspace.name}
          </h3>
          <span className="text-[28px] font-medium text-[var(--text-tertiary)]/60 ml-4">
            {workspace.itemCount}
          </span>
          <StatusDot status={workspace.status} className="h-5 w-5" />
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Group Label Node — scales stably with zoom
   ═══════════════════════════════════════════════════════════════ */

function GroupLabelNode({ data }: { data: GroupLabelNodeData }) {
  const scale = stableScale(data.zoom, 0.35);

  return (
    <div
      className="flex items-center gap-8 px-6 select-none pointer-events-none w-full"
      style={{
        transform: `scale(${scale})`,
        transformOrigin: "left center",
        transition: "transform 0.1s linear",
      }}
    >
      <span className="text-[52px] font-bold uppercase tracking-[0.14em] text-[var(--text-tertiary)]/50">
        {data.label}
      </span>
      <span className="text-[38px] tabular-nums text-[var(--text-tertiary)]/35 font-semibold">
        {data.count}
      </span>
      <div className="flex-1 h-[3px] bg-[var(--border-default)]/25 ml-6" />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Item Node — structural recomposition by zoom tier

   LANDSCAPE: Items are NOT rendered (territory identity only).
              This is enforced in buildNodes by not emitting item
              nodes at landscape tier.

   SUMMARY:   Compact chip — icon + title + status, no preview.
              Stable perceived size via counter-scaling.

   DETAIL:    Full card — icon, title, preview, meta row.
              Or inline deep-edit content at very high zoom.
   ═══════════════════════════════════════════════════════════════ */

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
  const showPreview = isDetail || (isSummary && zoomProgress > 0.7);

  // Counter-scale to maintain stable perceived size
  const scale = stableScale(zoom, 0.4);

  const canvasWidth = TERRITORY.ITEM_COL_WIDTH - 20;
  const canvasHeight = isDetail && zoomProgress > 0.5
    ? TERRITORY.ITEM_ROW_HEIGHT * 2.5
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
        transition: "transform 0.12s linear",
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
            <div
              className={cn(
                "h-[2px] transition-all duration-300",
                isFocused
                  ? "w-4 bg-[var(--accent-cyan)]/40"
                  : "w-2 bg-[var(--accent-cyan)]/15",
              )}
            />
          </div>
        )}

        {isDetail && zoomProgress > 0.5 ? (
          /* ── DETAIL TIER: Inline deep-edit content ── */
          <div className="flex-1 overflow-hidden w-full h-full pointer-events-auto bg-[var(--bg-elevated)]">
            {item.itemType === "thread" ? <ThreadContent item={item} /> : <ArtifactContent item={item} />}
          </div>
        ) : (
          /* ── SUMMARY / early DETAIL: Structured card ── */
          <>
            {/* Header row */}
            <div className={cn("flex items-center gap-4 px-6 pt-6", isSummary && zoomProgress < 0.4 && "pb-6")}>
              <div
                className={cn(
                  "flex h-12 w-12 items-center justify-center rounded-[14px] transition-all duration-200 shrink-0",
                  isFocused && "ring-1 ring-[var(--accent-cyan)]/20",
                )}
                style={{
                  backgroundColor: `color-mix(in oklab, ${meta?.color ?? "#637083"} ${isFocused ? "14" : "10"}%, var(--bg-secondary))`,
                }}
              >
                {Icon && (
                  <Icon
                    className="h-6 w-6"
                    style={{ color: meta?.color ?? "var(--text-secondary)" }}
                  />
                )}
              </div>
              <span className="flex-1 truncate text-xl font-semibold text-[var(--text-primary)] tracking-tight">
                {item.title}
              </span>
              <StatusDot
                status={item.status === "completed" ? "completed" : item.status === "active" ? "active" : "idle"}
              />
            </div>

            {/* Preview + meta — progressively revealed */}
            {(isSummary ? zoomProgress > 0.3 : true) && (
              <>
                <div className="flex-1 flex flex-col justify-center min-h-0 mt-2 px-6">
                  {showPreview && item.preview && (
                    <p className="pl-[64px] text-base leading-[1.6] text-[var(--text-tertiary)] line-clamp-3">
                      {item.preview}
                    </p>
                  )}
                </div>

                {/* Meta row */}
                <div className="flex items-center justify-between pl-[88px] pr-6 mt-auto shrink-0 pb-6 pt-2">
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

/* ═══════════════════════════════════════════════════════════════
   Build Nodes — layout engine with semantic zoom awareness

   Key change: at LANDSCAPE tier, item nodes are NOT emitted.
   Territory identity (name, emoji, summary chips) is enough.
   Items appear only at SUMMARY and DETAIL tiers.
   ═══════════════════════════════════════════════════════════════ */

function buildNodes(
  workspaces: WorkspaceData[],
  zoomTier: "landscape" | "summary" | "detail",
  zoomProgress: number,
  zoom: number,
  viewMode: "byType" | "byTopic" | "timeline" = "byType",
): Node[] {
  const nodes: Node[] = [];
  const isLandscape = zoomTier === "landscape";

  const rowHeight =
    zoomTier === "detail" ? TERRITORY.ITEM_ROW_HEIGHT * 2.6 : TERRITORY.ITEM_ROW_HEIGHT;

  workspaces.forEach((ws, idx) => {
    const col = idx % TERRITORY.COLS;
    const row = Math.floor(idx / TERRITORY.COLS);
    const tint = dominantTint(ws);

    // Compute dynamic territory dimensions based on content
    const grouped: Record<string, WorkspaceItemData[]> = {};
    for (const item of ws.items) {
      const key = item.itemType;
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(item);
    }

    let requiredHeight = 900; // Header area
    for (const [, group] of Object.entries(TYPE_GROUP_LABELS)) {
      const items = group.types.flatMap((t) => grouped[t] ?? []);
      if (items.length > 0) {
        requiredHeight +=
          120 + Math.ceil(items.length / TERRITORY.ITEMS_PER_ROW) * rowHeight + 40;
      }
    }
    const territoryHeight = Math.max(TERRITORY.HEIGHT, requiredHeight);
    const territoryWidth = Math.max(
      TERRITORY.WIDTH,
      80 + TERRITORY.ITEMS_PER_ROW * TERRITORY.ITEM_COL_WIDTH + 60,
    );

    // Territory node u2014 always present
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

    // u2500u2500 Items: only emitted at summary+ tiers u2500u2500
    if (isLandscape) return;

    // u2500u2500 Lens-based layout: byType, byTopic, timeline u2500u2500
    if (viewMode === "timeline") {
      // Timeline lens: sort all items by updatedAt, layout in a single column
      const sortedItems = [...ws.items].sort(
        (a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0),
      );

      // Timeline header
      nodes.push({
        id: `group-${ws.id}-timeline`,
        type: "groupLabel",
        parentId: `ws-${ws.id}`,
        position: { x: 80, y: 900 },
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
            y: 1020 + itemRow * rowHeight,
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
      // byTopic lens: group by workspace (since items already belong to workspaces)
      // Within a single workspace, just list all items flat
      nodes.push({
        id: `group-${ws.id}-topic`,
        type: "groupLabel",
        parentId: `ws-${ws.id}`,
        position: { x: 80, y: 900 },
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
            y: 1020 + itemRow * rowHeight,
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
      let groupY = 900;

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

        groupY += 120;

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
          Math.ceil(items.length / TERRITORY.ITEMS_PER_ROW) * rowHeight + 40;
      }
    }
  });

  return nodes;
}

/* ── Node Type Registry ── */

const NODE_TYPES = {
  workspaceTerritory: WorkspaceTerritoryNode,
  itemNode: ItemNode,
  groupLabel: GroupLabelNode,
};

/* ═══════════════════════════════════════════════════════════════
   Fixed Screen-Size Background

   The background pattern (dots/grid) must NOT scale with zoom.
   It uses a CSS overlay that tiles at a fixed pixel size and
   does NOT respond to viewport transforms. This creates a
   trustworthy spatial reference system.
   ═══════════════════════════════════════════════════════════════ */

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

/* ═══════════════════════════════════════════════════════════════
   Canvas Inner — the ReactFlow instance
   ═══════════════════════════════════════════════════════════════ */

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

  // ── Fly-to-workspace animation (triggered by dock or commitToWorkspace) ──
  const lastFlyToRef = useRef<number>(0);
  useEffect(() => {
    if (!flyToTarget || flyToTarget.requestId === lastFlyToRef.current) return;
    lastFlyToRef.current = flyToTarget.requestId;

    setCenter(flyToTarget.centerX, flyToTarget.centerY, {
      zoom: flyToTarget.zoom,
      duration: 700,
    });

    // Clear after animation
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
      {/* Fixed screen-size background pattern — does not scale with zoom */}
      <CanvasBackground mode={backgroundMode} />

      {/* ReactFlow canvas */}
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

      {/* Context Menu — shared action menu for pane, item-specific for nodes */}
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
                <span className="flex-1 text-left">Open in Right Hub</span>
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
