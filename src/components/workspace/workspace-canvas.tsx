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
  Background,
  BackgroundVariant,
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

/* ─── Shared helpers ─── */

const TINT_BG_COLORS: Record<string, string> = {
  warm: "rgba(245, 158, 11, 0.04)",
  cool: "rgba(14, 142, 232, 0.035)",
  neutral: "rgba(107, 95, 82, 0.03)",
  accent: "rgba(32, 184, 178, 0.035)",
  muted: "rgba(158, 144, 130, 0.025)",
};

function tintBg(variant: string) {
  return TINT_BG_COLORS[variant] ?? TINT_BG_COLORS.neutral;
}

const STATUS_COLORS: Record<string, string> = {
  active: "bg-[var(--success)]",
  quiet: "bg-[var(--border-default)]",
  completed: "bg-[var(--text-tertiary)]",
  archived: "bg-[var(--border-default)]",
  idle: "bg-[var(--border-default)]",
};

function StatusDot({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "inline-block h-[6px] w-[6px] rounded-full shrink-0",
        STATUS_COLORS[status] ?? "bg-[var(--border-default)]",
        status === "active" && "animate-pulse",
      )}
    />
  );
}

function timeAgo(timestamp?: number): string {
  if (!timestamp) return "";
  const diff = Date.now() - timestamp;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

/* ─── Node data types ─── */

type WorkspaceNodeData = {
  workspace: WorkspaceData;
  zoomTier: "landscape" | "summary" | "detail";
  zoomProgress: number;
  zoom: number;
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
};

/* ═══════════════════════════════════════════════════════════════
   Workspace Territory Node — semantic zoom representation
   ═══════════════════════════════════════════════════════════════ */

function WorkspaceTerritoryNode({ data }: { data: WorkspaceNodeData }) {
  const { workspace, zoomTier, zoomProgress } = data;
  const [hovered, setHovered] = useState(false);

  // Semantic representation adapts continuously
  const isLandscape = zoomTier === "landscape";
  const showGroupedContent = zoomProgress > 0.3 || !isLandscape;
  const showRecentItems = !isLandscape;

  const groupCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const item of workspace.items) {
      counts[item.itemType] = (counts[item.itemType] ?? 0) + 1;
    }
    return counts;
  }, [workspace.items]);

  const activeItems = workspace.items.filter((i) => i.status === "active");
  const recentItems = activeItems.slice(0, 5);

  // Scale representation continuously instead of snapping
  const titleSize = isLandscape
    ? `${14 + zoomProgress * 4}px`
    : `${16 + zoomProgress * 2}px`;

  return (
    <div
      className={cn(
        "relative flex flex-col overflow-hidden border",
        "border-[var(--border-default)]/40 bg-[var(--bg-elevated)]/90",
        "transition-shadow duration-300 ease-[var(--ease-standard)]",
        "rounded-[20px]",
        hovered && "border-[color-mix(in_oklab,var(--accent-cyan)_20%,var(--border-default))]",
      )}
      style={{
        width: TERRITORY.WIDTH,
        minHeight: isLandscape ? (showGroupedContent ? 260 : 140) : 420,
        boxShadow: hovered
          ? "0 24px 64px -24px rgba(7,20,35,0.22)"
          : "0 8px 32px -18px rgba(7,20,35,0.10)",
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Territory ambient tint */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: `radial-gradient(ellipse 120% 80% at 50% 30%, ${tintBg(TYPE_TO_TINT[workspace.items[0]?.itemType as CanonicalWorkspaceType] ?? "neutral")} 0%, transparent 70%)`,
        }}
      />

      {/* Header */}
      <div className="relative flex items-center gap-3 border-b border-[var(--border-default)]/25 px-5 py-4">
        <span className="text-2xl leading-none">{workspace.emoji}</span>
        <div className="min-w-0 flex-1">
          <h3
            className="truncate font-semibold text-[var(--text-primary)] transition-[font-size] duration-200"
            style={{ fontSize: titleSize }}
          >
            {workspace.name}
          </h3>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[11px] text-[var(--text-tertiary)]">
              {workspace.itemCount} item{workspace.itemCount !== 1 ? "s" : ""}
            </span>
            {workspace.lastActivity && (
              <span className="text-[10px] text-[var(--text-tertiary)]/60">
                · {timeAgo(workspace.lastActivity)}
              </span>
            )}
          </div>
        </div>
        <StatusDot status={workspace.status} />
      </div>

      {/* Grouped content — appears progressively */}
      {showGroupedContent && (
        <div className="relative flex flex-1 flex-col gap-3 p-5">
          {Object.entries(TYPE_GROUP_LABELS).map(([key, group]) => {
            const count = group.types.reduce(
              (sum, t) => sum + (groupCounts[t] ?? 0),
              0,
            );
            if (count === 0) return null;
            const tintVariant = TYPE_TO_TINT[group.types[0]];
            const groupItems = workspace.items.filter((i) =>
              (group.types as readonly string[]).includes(i.itemType),
            );

            // Show item previews only at higher zoom
            const showPreviews = !isLandscape || zoomProgress > 0.7;

            return (
              <div
                key={key}
                className="rounded-2xl px-4 py-3"
                style={{
                  background: `radial-gradient(ellipse at 50% 40%, ${tintBg(tintVariant)} 0%, transparent 80%)`,
                  boxShadow: `inset 0 0 40px 16px ${tintBg(tintVariant)}`,
                }}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-tertiary)]">
                    {group.label}
                  </span>
                  <span className="text-[10px] font-medium tabular-nums text-[var(--text-tertiary)]/60">
                    {count}
                  </span>
                </div>
                {showPreviews && (
                  <div className="flex flex-col gap-1">
                    {groupItems.slice(0, 2).map((item) => {
                      const meta =
                        CANONICAL_WORKSPACE_TYPE_META[
                          item.itemType as CanonicalWorkspaceType
                        ];
                      const Icon = meta?.icon;
                      return (
                        <div
                          key={item.id}
                          className="flex items-center gap-2 py-1 text-[11px] text-[var(--text-secondary)]"
                        >
                          {Icon && (
                            <Icon
                              className="h-3 w-3 shrink-0 opacity-60"
                              style={{ color: meta.color }}
                            />
                          )}
                          <span className="truncate">{item.title}</span>
                        </div>
                      );
                    })}
                    {groupItems.length > 2 && (
                      <span className="text-[10px] text-[var(--text-tertiary)]/50 pl-5">
                        +{groupItems.length - 2} more
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {/* Recent active items at deeper zoom */}
          {showRecentItems && recentItems.length > 0 && (
            <div className="mt-2 flex flex-col gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-tertiary)]/50 mb-1">
                Recently active
              </span>
              {recentItems.map((item) => {
                const meta =
                  CANONICAL_WORKSPACE_TYPE_META[
                    item.itemType as CanonicalWorkspaceType
                  ];
                const Icon = meta?.icon;
                return (
                  <div
                    key={item.id}
                    className="flex items-center gap-2 rounded-xl px-3 py-2 text-[12px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)]"
                  >
                    {Icon && (
                      <Icon
                        className="h-3.5 w-3.5 shrink-0"
                        style={{ color: meta.color }}
                      />
                    )}
                    <span className="min-w-0 flex-1 truncate">
                      {item.title}
                    </span>
                    {item.meta && (
                      <span className="text-[10px] text-[var(--text-tertiary)]">
                        {item.meta}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Landscape compact row — shown when grouped content is hidden */}
      {isLandscape && !showGroupedContent && (
        <div className="flex items-center gap-3 px-5 py-3">
          {Object.entries(groupCounts)
            .slice(0, 5)
            .map(([type, count]) => {
              const meta =
                CANONICAL_WORKSPACE_TYPE_META[
                  type as CanonicalWorkspaceType
                ];
              const Icon = meta?.icon;
              return (
                <div
                  key={type}
                  className="flex items-center gap-1 text-[10px] text-[var(--text-tertiary)]"
                >
                  {Icon && (
                    <Icon
                      className="h-3 w-3 opacity-70"
                      style={{ color: meta.color }}
                    />
                  )}
                  <span className="tabular-nums">{count}</span>
                </div>
              );
            })}
        </div>
      )}

      {/* Entry affordance glow line */}
      <div
        className={cn(
          "absolute bottom-0 left-0 right-0 h-[2px] transition-all duration-300",
          hovered
            ? "bg-[var(--accent-cyan)]/30"
            : "bg-transparent",
        )}
      />
    </div>
  );
}

/* ─── Group Label Node ─── */

function GroupLabelNode({ data }: { data: GroupLabelNodeData }) {
  return (
    <div className="flex items-center gap-2 px-1 select-none pointer-events-none">
      <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)]/45">
        {data.label}
      </span>
      <span className="text-[10px] tabular-nums text-[var(--text-tertiary)]/30 font-medium">
        {data.count}
      </span>
      <div className="flex-1 h-px bg-[var(--border-default)]/20 ml-2" />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Item Node — adapts representation by zoom level
   ═══════════════════════════════════════════════════════════════ */

function ItemNode({ data }: { data: ItemNodeData }) {
  const { item, zoomTier, zoomProgress } = data;
  const meta =
    CANONICAL_WORKSPACE_TYPE_META[item.itemType as CanonicalWorkspaceType];
  const Icon = meta?.icon;
  const [hovered, setHovered] = useState(false);
  const focusedItemId = useWorkspaceStore((s) => s.focusedItemId);
  const deepEditTargets = useWorkspaceStore((s) => s.deepEditTargets);
  const isFocused = focusedItemId === item.id;
  const isOpenInDeepEdit = deepEditTargets.some((t) => t.item.id === item.id);

  // Detail tier: show preview & meta; summary: compact
  const isDetail = zoomTier === "detail";
  const showPreview = isDetail || (zoomTier === "summary" && zoomProgress > 0.5);

  return (
    <div
      className={cn(
        "group relative flex flex-col gap-1.5 rounded-[14px] border px-3.5 py-3",
        "border-[var(--border-default)]/50 bg-[var(--bg-elevated)]/92",
        "transition-all duration-300 ease-[var(--ease-standard)]",
        hovered && !isFocused && "border-[color-mix(in_oklab,var(--accent-cyan)_22%,var(--border-default))]",
        isFocused && "border-[color-mix(in_oklab,var(--accent-cyan)_40%,var(--border-default))]",
        isOpenInDeepEdit && !isFocused && "border-[color-mix(in_oklab,var(--accent-cyan)_18%,var(--border-default))] opacity-80",
      )}
      style={{
        width: isDetail ? 300 : 260,
        boxShadow: isFocused
          ? "0 12px 30px -14px rgba(14,142,232,0.22), 0 0 0 1px color-mix(in oklab, var(--accent-cyan) 20%, transparent)"
          : isOpenInDeepEdit
            ? "0 8px 22px -14px rgba(14,142,232,0.12)"
            : hovered
              ? "0 10px 26px -16px rgba(7,20,35,0.18)"
              : "0 6px 18px -14px rgba(7,20,35,0.12)",
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Active connection indicator */}
      {isOpenInDeepEdit && (
        <div className="absolute -right-2 top-1/2 -translate-y-1/2 flex items-center gap-0.5 pointer-events-none">
          <div
            className={cn(
              "h-6 w-[3px] rounded-full transition-all duration-300",
              isFocused
                ? "bg-[var(--accent-cyan)] shadow-[0_0_8px_2px_rgba(14,142,232,0.35)]"
                : "bg-[var(--accent-cyan)]/30",
            )}
          />
          <div
            className={cn(
              "h-px transition-all duration-300",
              isFocused
                ? "w-3 bg-[var(--accent-cyan)]/40"
                : "w-1.5 bg-[var(--accent-cyan)]/15",
            )}
          />
        </div>
      )}

      {/* Header row */}
      <div className="flex items-center gap-2">
        <div
          className={cn(
            "flex h-7 w-7 items-center justify-center rounded-lg transition-all duration-200",
            isFocused && "ring-1 ring-[var(--accent-cyan)]/20",
          )}
          style={{
            backgroundColor: `color-mix(in oklab, ${meta?.color ?? "#637083"} ${isFocused ? "14" : "10"}%, var(--bg-secondary))`,
          }}
        >
          {Icon && (
            <Icon
              className="h-4 w-4"
              style={{ color: meta?.color ?? "var(--text-secondary)" }}
            />
          )}
        </div>
        <span className="flex-1 truncate text-[13px] font-semibold text-[var(--text-primary)]">
          {item.title}
        </span>
        <StatusDot
          status={item.status === "completed" ? "completed" : item.status === "active" ? "active" : "idle"}
        />
      </div>

      {/* Preview text — appears progressively */}
      {showPreview && item.preview && (
        <p className="pl-9 text-[11.5px] leading-[1.45] text-[var(--text-tertiary)] line-clamp-2">
          {item.preview}
        </p>
      )}

      {/* Meta row */}
      <div className="flex items-center justify-between pl-9">
        <span
          className="rounded-md px-1 py-0.5 text-[10px] font-medium uppercase tracking-[0.1em]"
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
          <span className="text-[10.5px] font-medium text-[var(--text-secondary)]">
            {item.meta}
          </span>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Build Nodes — layout engine
   ═══════════════════════════════════════════════════════════════ */

function buildNodes(
  workspaces: WorkspaceData[],
  zoomTier: "landscape" | "summary" | "detail",
  zoomProgress: number,
  zoom: number,
  committedWorkspaceId: string | null,
): Node[] {
  const nodes: Node[] = [];

  // If committed to a workspace, show its items
  if (committedWorkspaceId) {
    const ws = workspaces.find((w) => w.id === committedWorkspaceId);
    if (ws) {
      const grouped: Record<string, WorkspaceItemData[]> = {};
      for (const item of ws.items) {
        const key = item.itemType;
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push(item);
      }

      let groupY = 20;
      for (const [, group] of Object.entries(TYPE_GROUP_LABELS)) {
        const items = group.types.flatMap((t) => grouped[t] ?? []);
        if (items.length === 0) continue;

        nodes.push({
          id: `group-${group.label}`,
          type: "groupLabel",
          position: { x: 40, y: groupY },
          data: {
            label: group.label,
            variant: TYPE_TO_TINT[group.types[0]],
            count: items.length,
          } satisfies GroupLabelNodeData,
          draggable: false,
          selectable: false,
          style: { width: 600, zIndex: -1 },
        });

        groupY += 36;

        items.forEach((item, idx) => {
          const col = idx % TERRITORY.ITEMS_PER_ROW;
          const row = Math.floor(idx / TERRITORY.ITEMS_PER_ROW);
          nodes.push({
            id: `item-${item.id}`,
            type: "itemNode",
            position: {
              x: item.canvasX ?? (60 + col * TERRITORY.ITEM_COL_WIDTH),
              y: item.canvasY ?? (groupY + row * TERRITORY.ITEM_ROW_HEIGHT),
            },
            data: {
              item,
              zoomTier,
              zoomProgress,
              zoom,
              groupLabel: group.label,
              isFirst: idx === 0,
            } satisfies ItemNodeData,
            draggable: true,
            selectable: true,
          });
        });

        groupY +=
          Math.ceil(items.length / TERRITORY.ITEMS_PER_ROW) * TERRITORY.ITEM_ROW_HEIGHT + 48;
      }
    }
    return nodes;
  }

  // Show workspace territories in grid
  workspaces.forEach((ws, idx) => {
    const col = idx % TERRITORY.COLS;
    const row = Math.floor(idx / TERRITORY.COLS);
    nodes.push({
      id: `ws-${ws.id}`,
      type: "workspaceTerritory",
      position: {
        x: col * TERRITORY.SPACING_X,
        y: row * TERRITORY.SPACING_Y,
      },
      data: { workspace: ws, zoomTier, zoomProgress, zoom } satisfies WorkspaceNodeData,
      draggable: false,
      selectable: true,
    });
  });

  return nodes;
}

/* ═══════════════════════════════════════════════════════════════
   Background — canvas-anchored dots with stable screen size
   ═══════════════════════════════════════════════════════════════ */

/**
 * Canvas-anchored dot background that moves with navigation but keeps
 * dot size visually stable on screen.
 *
 * Strategy: render as a Panel inside ReactFlow so it's part of the
 * canvas coordinate space (pans with navigation), but apply an
 * inverse-zoom CSS scale so dots stay visually the same size
 * regardless of zoom level.
 */
const DOT_SPACING = 24; // base spacing in flow-space units

function CanvasDotBackground() {
  const zoom = useWorkspaceStore((s) => s.zoom);
  const viewportX = useWorkspaceStore((s) => s.viewportX);
  const viewportY = useWorkspaceStore((s) => s.viewportY);

  // Inverse scale keeps dots visually stable as the user zooms
  const invScale = 1 / zoom;
  // Dot radius stays 1px visually regardless of zoom
  const dotRadius = 1 * invScale;

  return (
    <div
      className="absolute inset-0 pointer-events-none overflow-hidden"
      style={{ zIndex: 0 }}
    >
      {/*
        This div sits outside the ReactFlow viewport transform, so we
        manually apply the pan/zoom to make dots feel like canvas
        structure, then inverse-scale to keep dot size stable.
      */}
      <div
        style={{
          position: "absolute",
          // Pan with the canvas
          transform: `translate(${viewportX}px, ${viewportY}px) scale(${invScale})`,
          transformOrigin: "0 0",
          // Cover enough area so dots are visible in all pan positions
          width: `${Math.max(window?.innerWidth ?? 1920, 1920) * invScale * 2}px`,
          height: `${Math.max(window?.innerHeight ?? 1080, 1080) * invScale * 2}px`,
          left: `${-(Math.max(window?.innerWidth ?? 1920, 1920) * invScale * 0.5)}px`,
          top: `${-(Math.max(window?.innerHeight ?? 1080, 1080) * invScale * 0.5)}px`,
          backgroundImage:
            `radial-gradient(circle, color-mix(in oklab, var(--border-default) 40%, transparent) ${dotRadius}px, transparent ${dotRadius}px)`,
          backgroundSize: `${DOT_SPACING}px ${DOT_SPACING}px`,
          opacity: 0.7,
        }}
      />
    </div>
  );
}

/* ─── Node Type Registry ─── */

const NODE_TYPES = {
  workspaceTerritory: WorkspaceTerritoryNode,
  itemNode: ItemNode,
  groupLabel: GroupLabelNode,
};

/* ═══════════════════════════════════════════════════════════════
   Canvas Inner — the actual ReactFlow instance
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
  const committedWorkspaceId = useWorkspaceStore((s) => s.committedWorkspaceId);
  const setViewport = useWorkspaceStore((s) => s.setViewport);
  const setFocusedItem = useWorkspaceStore((s) => s.setFocusedItem);
  const backgroundMode = useWorkspaceStore((s) => s.backgroundMode);
  const setNearestWorkspace = useWorkspaceStore((s) => s.setNearestWorkspace);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Commit transition: soften the harsh mode jump when entering/leaving a workspace
  const [transitioning, setTransitioning] = useState(false);
  const prevCommittedRef = useRef<string | null>(committedWorkspaceId);

  useEffect(() => {
    if (prevCommittedRef.current !== committedWorkspaceId) {
      prevCommittedRef.current = committedWorkspaceId;
      setTransitioning(true);
      const timer = setTimeout(() => setTransitioning(false), 220);
      return () => clearTimeout(timer);
    }
  }, [committedWorkspaceId]);

  const nodes = useMemo(
    () => buildNodes(workspaces, zoomTier, zoomProgress, zoom, committedWorkspaceId),
    [workspaces, zoomTier, zoomProgress, zoom, committedWorkspaceId],
  );

  const edges: Edge[] = useMemo(() => [], []);

  // Compute nearest workspace to viewport center for auto-entry
  const computeNearestWorkspace = useCallback(
    (vp: Viewport) => {
      if (committedWorkspaceId || workspaces.length === 0) return;

      // Viewport center in flow coordinates
      const viewW = window.innerWidth;
      const viewH = window.innerHeight;
      const centerX = (-vp.x + viewW / 2) / vp.zoom;
      const centerY = (-vp.y + viewH / 2) / vp.zoom;

      let nearest: string | null = null;
      let minDist = Infinity;
      workspaces.forEach((ws, idx) => {
        const col = idx % TERRITORY.COLS;
        const row = Math.floor(idx / TERRITORY.COLS);
        const wx = col * TERRITORY.SPACING_X + TERRITORY.WIDTH / 2;
        const wy = row * TERRITORY.SPACING_Y + TERRITORY.HEIGHT / 2;
        const dist = Math.hypot(centerX - wx, centerY - wy);
        if (dist < minDist) {
          minDist = dist;
          nearest = ws.id;
        }
      });
      setNearestWorkspace(nearest);
    },
    [committedWorkspaceId, workspaces, setNearestWorkspace],
  );

  const handleViewportChange = useCallback(
    (vp: Viewport) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        setViewport(vp.x, vp.y, vp.zoom);
        computeNearestWorkspace(vp);
      }, 30);
    },
    [setViewport, computeNearestWorkspace],
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

  const handlePaneClick = useCallback(() => {
    setFocusedItem(null);
  }, [setFocusedItem]);



  return (
    <div className="h-full w-full relative">
      <div
        className={cn(
          "h-full w-full transition-opacity duration-200 ease-[var(--ease-standard)]",
          transitioning ? "opacity-0" : "opacity-100",
        )}
      >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          onViewportChange={handleViewportChange}
          onNodeClick={handleNodeClick}
          onPaneClick={handlePaneClick}
          zoomOnScroll={true}
          panOnScroll={false}
          panOnDrag={true}
          zoomOnPinch={true}
          minZoom={VP.MIN_ZOOM}
          maxZoom={VP.MAX_ZOOM}
          defaultViewport={{ x: 80, y: 40, zoom: VP.DEFAULT_ZOOM }}
          proOptions={{ hideAttribution: true }}
          fitView={true}
          fitViewOptions={{ padding: 0.3, maxZoom: VP.DEFAULT_ZOOM + 0.05 }}
          deleteKeyCode={null}
          selectionKeyCode={null}
        >
          {/* Grid mode uses ReactFlow's built-in Lines background */}
          {backgroundMode === "grid" && (
            <Background variant={BackgroundVariant.Lines} gap={32} size={0.5} color="var(--border-default)" />
          )}

        </ReactFlow>
        {/* Canvas-anchored dot background: pans with navigation, dots stay visually stable */}
        {backgroundMode === "dots" && <CanvasDotBackground />}
      </div>
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
