"use client";

import {
  useCallback,
  useMemo,
  useRef,
  useState,
  useEffect,
} from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
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

/* ─── Node Types ─── */

type WorkspaceNodeData = {
  workspace: WorkspaceData;
  zoomTier: "landscape" | "summary" | "detail";
};

type ItemNodeData = {
  item: WorkspaceItemData;
  zoomTier: "landscape" | "summary" | "detail";
  groupLabel?: string;
  isFirst?: boolean;
};

type GroupLabelNodeData = {
  label: string;
  variant: string;
  count: number;
};

/* ─── Tint Background Helper ─── */

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

/* ─── Status Dot ─── */

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

/* ─── Time Ago Helper ─── */

function timeAgo(timestamp?: number): string {
  if (!timestamp) return "";
  const diff = Date.now() - timestamp;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

/* ─── Workspace Territory Node ─── */

function WorkspaceTerritoryNode({ data }: { data: WorkspaceNodeData }) {
  const { workspace, zoomTier } = data;
  const isLandscape = zoomTier === "landscape";
  const [hovered, setHovered] = useState(false);

  const groupCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const item of workspace.items) {
      counts[item.itemType] = (counts[item.itemType] ?? 0) + 1;
    }
    return counts;
  }, [workspace.items]);

  const activeItems = workspace.items.filter((i) => i.status === "active");
  const recentItems = activeItems.slice(0, 5);

  return (
    <div
      className={cn(
        "relative flex flex-col overflow-hidden border",
        "border-[var(--border-default)]/40 bg-[var(--bg-elevated)]/85",
        "transition-all duration-300 ease-[var(--ease-standard)]",
        isLandscape ? "rounded-[16px]" : "rounded-[20px]",
        hovered && "border-[color-mix(in_oklab,var(--accent-cyan)_20%,var(--border-default))]",
      )}
      style={{
        width: isLandscape ? 800 : TERRITORY.WIDTH,
        minHeight: isLandscape ? 180 : 520,
        boxShadow: hovered
          ? "0 20px 50px -22px rgba(7,20,35,0.18)"
          : "0 8px 28px -18px rgba(7,20,35,0.10)",
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Territory tint wash — large diffuse background region */}
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
          <h3 className={cn(
            "truncate font-semibold text-[var(--text-primary)]",
            isLandscape ? "text-[14px]" : "text-[16px]",
          )}>
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

      {/* Content — progressively revealed based on zoom tier */}
      {!isLandscape && (
        <div className="relative flex flex-1 flex-col gap-3 p-5">
          {/* Tint zone summaries — visual grouping areas */}
          {Object.entries(TYPE_GROUP_LABELS).map(([key, group]) => {
            const count = group.types.reduce(
              (sum, t) => sum + (groupCounts[t] ?? 0),
              0,
            );
            if (count === 0) return null;
            const tintVariant = TYPE_TO_TINT[group.types[0]];
            const groupItems = workspace.items.filter(i =>
              (group.types as readonly string[]).includes(i.itemType),
            );
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
                {/* Show first 2 item titles as preview */}
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
              </div>
            );
          })}

          {/* Recent active items at summary depth */}
          {recentItems.length > 0 && zoomTier === "summary" && (
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

      {/* Landscape mode: compact summary row */}
      {isLandscape && (
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

      {/* Entry affordance — subtle bottom bar */}
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

/* ─── Group Label Node (rendered inside committed workspace) ─── */

function GroupLabelNode({ data }: { data: GroupLabelNodeData }) {
  return (
    <div
      className="flex items-center gap-2 px-1 select-none pointer-events-none"
    >
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

/* ─── Item Node (rendered at detail zoom inside committed workspace) ─── */

function ItemNode({ data }: { data: ItemNodeData }) {
  const { item } = data;
  const meta =
    CANONICAL_WORKSPACE_TYPE_META[item.itemType as CanonicalWorkspaceType];
  const Icon = meta?.icon;
  const [hovered, setHovered] = useState(false);
  const focusedItemId = useWorkspaceStore((s) => s.focusedItemId);
  const isFocused = focusedItemId === item.id;

  return (
    <div
      className={cn(
        "group relative flex min-w-[240px] max-w-[300px] flex-col gap-1.5 rounded-[14px] border px-3.5 py-3",
        "border-[var(--border-default)]/50 bg-[var(--bg-elevated)]/92",
        "transition-all duration-200 ease-[var(--ease-standard)]",
        hovered && "border-[color-mix(in_oklab,var(--accent-cyan)_22%,var(--border-default))]",
        isFocused && "ring-1 ring-[var(--accent-cyan)]/30 border-[color-mix(in_oklab,var(--accent-cyan)_35%,var(--border-default))]",
      )}
      style={{
        boxShadow: isFocused
          ? "0 12px 30px -14px rgba(14,142,232,0.18)"
          : hovered
            ? "0 10px 26px -16px rgba(7,20,35,0.18)"
            : "0 6px 18px -14px rgba(7,20,35,0.12)",
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="flex items-center gap-2">
        <div
          className="flex h-7 w-7 items-center justify-center rounded-lg"
          style={{
            backgroundColor: `color-mix(in oklab, ${meta?.color ?? "#637083"} 10%, var(--bg-secondary))`,
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
      {item.preview && (
        <p className="pl-9 text-[11.5px] leading-[1.45] text-[var(--text-tertiary)] line-clamp-2">
          {item.preview}
        </p>
      )}
      <div className="flex items-center justify-between pl-9">
        <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-[var(--text-tertiary)]/60">
          {meta?.label ?? item.itemType}
        </span>
        {item.meta && (
          <span className="text-[10.5px] font-medium text-[var(--text-secondary)]">
            {item.meta}
          </span>
        )}
      </div>

      {/* Focus ring glow */}
      {isFocused && (
        <div
          className="absolute -inset-px rounded-[15px] pointer-events-none"
          style={{
            boxShadow: `0 0 0 1px color-mix(in oklab, var(--accent-cyan) 18%, transparent)`,
          }}
        />
      )}
    </div>
  );
}

/* ─── Build Nodes ─── */

function buildNodes(
  workspaces: WorkspaceData[],
  zoomTier: "landscape" | "summary" | "detail",
  committedWorkspaceId: string | null,
): Node[] {
  const nodes: Node[] = [];

  // If committed to a workspace, show its items at detail zoom
  if (committedWorkspaceId) {
    const ws = workspaces.find((w) => w.id === committedWorkspaceId);
    if (ws) {
      // Group items by type for spatial layout
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

        // Add group label node
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

        // Position items in a flowing grid within each group
        const COL_WIDTH = 320;
        const ROW_HEIGHT = 120;
        const ITEMS_PER_ROW = 3;

        items.forEach((item, idx) => {
          const col = idx % ITEMS_PER_ROW;
          const row = Math.floor(idx / ITEMS_PER_ROW);
          nodes.push({
            id: `item-${item.id}`,
            type: "itemNode",
            position: {
              x: item.canvasX ?? (60 + col * COL_WIDTH),
              y: item.canvasY ?? (groupY + row * ROW_HEIGHT),
            },
            data: {
              item,
              zoomTier,
              groupLabel: group.label,
              isFirst: idx === 0,
            } satisfies ItemNodeData,
            draggable: true,
            selectable: true,
          });
        });

        groupY +=
          Math.ceil(items.length / ITEMS_PER_ROW) * ROW_HEIGHT + 48;
      }
    }
    return nodes;
  }

  // Otherwise show workspace territories
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
      data: { workspace: ws, zoomTier } satisfies WorkspaceNodeData,
      draggable: false,
      selectable: true,
    });
  });

  return nodes;
}

/* ─── Node Type Registry ─── */

const NODE_TYPES = {
  workspaceTerritory: WorkspaceTerritoryNode,
  itemNode: ItemNode,
  groupLabel: GroupLabelNode,
};

/* ─── Canvas ─── */

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
  const committedWorkspaceId = useWorkspaceStore((s) => s.committedWorkspaceId);
  const setViewport = useWorkspaceStore((s) => s.setViewport);
  const panelOpen = useWorkspaceStore((s) => s.panelOpen);
  const setFocusedItem = useWorkspaceStore((s) => s.setFocusedItem);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reactFlowInstance = useReactFlow();

  const nodes = useMemo(
    () => buildNodes(workspaces, zoomTier, committedWorkspaceId),
    [workspaces, zoomTier, committedWorkspaceId],
  );

  const edges: Edge[] = useMemo(() => [], []);

  const handleViewportChange = useCallback(
    (vp: Viewport) => {
      // Debounce store updates to avoid excessive renders
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        setViewport(vp.x, vp.y, vp.zoom);
      }, 40);
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

  const handlePaneClick = useCallback(() => {
    setFocusedItem(null);
  }, [setFocusedItem]);

  // Fit view on committed workspace change
  useEffect(() => {
    if (committedWorkspaceId) {
      // Slight delay so ReactFlow layout settles
      const timer = setTimeout(() => {
        reactFlowInstance.fitView({
          padding: 0.2,
          duration: 350,
        });
      }, 80);
      return () => clearTimeout(timer);
    }
  }, [committedWorkspaceId, reactFlowInstance]);

  return (
    <div
      className={cn(
        "h-full w-full transition-opacity duration-300",
        panelOpen && "opacity-[0.88]",
      )}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        onViewportChange={handleViewportChange}
        onNodeClick={handleNodeClick}
        onPaneClick={handlePaneClick}
        /* Scroll = zoom (spec requirement) */
        zoomOnScroll={true}
        panOnScroll={false}
        panOnDrag={true}
        zoomOnPinch={true}
        /* Viewport bounds */
        minZoom={VP.MIN_ZOOM}
        maxZoom={VP.MAX_ZOOM}
        defaultViewport={{ x: 200, y: 100, zoom: VP.DEFAULT_ZOOM }}
        /* Clean canvas — no extra controls */
        proOptions={{ hideAttribution: true }}
        fitView={false}
        deleteKeyCode={null}
        selectionKeyCode={null}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={28}
          size={1}
        />
      </ReactFlow>
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
