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
  CalendarCheck,
  Code2,
  FileText,
  Image as ImageIcon,
  MessageSquare,
  Wand2,
  Trash2,
  Link,
  ExternalLink,
  Layers,
} from "lucide-react";
import { ArtifactContent, ThreadContent } from "./focus-panel";

/* ─── Shared helpers ─── */

const TINT_BG_COLORS: Record<string, string> = {
  warm: "rgba(245, 158, 11, 0.15)",
  cool: "rgba(14, 142, 232, 0.12)",
  neutral: "rgba(107, 95, 82, 0.10)",
  accent: "rgba(32, 184, 178, 0.12)",
  muted: "rgba(158, 144, 130, 0.10)",
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
  zoom: number;
};

/* ═══════════════════════════════════════════════════════════════
   Workspace Territory Node — semantic zoom representation
   ═══════════════════════════════════════════════════════════════ */

function WorkspaceTerritoryNode({ data }: { data: WorkspaceNodeData }) {
  const { workspace, zoom } = data;
  
  const targetZoom = 0.3;
  const scale = zoom < targetZoom ? targetZoom / zoom : 1;
  
  // A subtle glow effect that spans the entire space of a workspace,
  // removing the hard card container borders and integrating fully with the canvas.
  // The size is dynamically adjusted based on ReactFlow rendering.
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        pointerEvents: "none",
      }}
      className="relative flex flex-col justify-start items-center opacity-70 transition-opacity duration-500"
    >
      {/* Soft radial aura representing the workspace background territory */}
      <div 
        className="absolute w-full h-full"
        style={{
          background: `radial-gradient(ellipse at 50% 30%, ${tintBg(TYPE_TO_TINT[workspace.items[0]?.itemType as CanonicalWorkspaceType] ?? "neutral")} 0%, transparent 65%)`,
          filter: 'blur(120px)',
          zIndex: -1,
        }}
      />
      
      {/* Extremely faint structural guide */}
      <div 
        className="absolute top-10 w-[80%] h-[1px] opacity-20"
        style={{
          background: `linear-gradient(90deg, transparent 0%, var(--border-default) 50%, transparent 100%)`
        }}
      />

      {/* Floating Header */}
      <div 
        className="relative flex flex-col items-center gap-12 mt-40 z-10 opacity-90"
        style={{ 
          transform: `scale(${scale})`, 
          transformOrigin: 'top center',
          transition: 'transform 0.1s linear'
        }}
      >
        <div className="flex items-center justify-center h-[360px] w-[360px] rounded-[5rem] bg-[var(--bg-elevated)]/50 backdrop-blur-2xl border border-[var(--border-default)]/20 shadow-[0_24px_64px_-16px_rgba(7,20,35,0.15)]">
          <span className="text-[200px] leading-none" style={{ filter: 'drop-shadow(0 8px 16px rgba(0,0,0,0.12))' }}>{workspace.emoji}</span>
        </div>
        <div className="flex flex-col items-center gap-6">
          <h3 className="font-bold text-[var(--text-primary)] text-[140px] tracking-[-0.02em]" style={{ textShadow: '0 4px 24px rgba(0,0,0,0.1)' }}>
            {workspace.name}
          </h3>
          <div className="flex items-center gap-8">
            <span className="text-[52px] font-medium tracking-wide text-[var(--text-tertiary)] uppercase bg-[var(--bg-secondary)]/30 backdrop-blur-md px-12 py-6 rounded-full border border-[var(--border-default)]/20">
              {workspace.itemCount} item{workspace.itemCount !== 1 ? "s" : ""}
            </span>
            <StatusDot status={workspace.status} className="h-10 w-10" />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Group Label Node ─── */

function GroupLabelNode({ data }: { data: GroupLabelNodeData }) {
  const targetZoom = 0.3;
  const scale = data.zoom < targetZoom ? targetZoom / data.zoom : 1;

  return (
    <div 
      className="flex items-center gap-8 px-6 select-none pointer-events-none w-full"
      style={{ 
        transform: `scale(${scale})`, 
        transformOrigin: 'left center',
        transition: 'transform 0.1s linear'
      }}
    >
      <span className="text-[64px] font-bold uppercase tracking-[0.15em] text-[var(--text-tertiary)]/60">
        {data.label}
      </span>
      <span className="text-[48px] tabular-nums text-[var(--text-tertiary)]/40 font-semibold">
        {data.count}
      </span>
      <div className="flex-1 h-[4px] bg-[var(--border-default)]/30 ml-8" />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Item Node — adapts representation by zoom level
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

  const isLandscape = zoomTier === "landscape";
  const isSummary = zoomTier === "summary";
  const isDetail = zoomTier === "detail";
  // Reveal preview at high zoom tiers or progressively, revealing slower
  const showPreview = isDetail || (isSummary && zoomProgress > 0.6);

  const canvasWidth = TERRITORY.ITEM_COL_WIDTH - 20; // 480
  const canvasHeight = isDetail ? TERRITORY.ITEM_ROW_HEIGHT * 2.5 : TERRITORY.ITEM_ROW_HEIGHT - 20;

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

        {isDetail ? (
          // --- DETAIL TIER (Deep Edit inline) ---
          <div className="flex-1 overflow-hidden w-full h-full pointer-events-auto bg-[var(--bg-elevated)]">
             {item.itemType === "thread" ? <ThreadContent item={item} /> : <ArtifactContent item={item} />}
          </div>
        ) : (
          // --- LANDSCAPE / SUMMARY TIERS ---
          <>
            {/* Header row */}
            <div className={cn("flex items-center gap-4 px-6 pt-6", isLandscape && "pb-6")}>
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

            {!isLandscape && (
              <>
                <div className="flex-1 flex flex-col justify-center min-h-0 mt-2 px-6">
                  {/* Preview text — appears progressively as height allows */}
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
   Build Nodes — layout engine
   ═══════════════════════════════════════════════════════════════ */

function buildNodes(
  workspaces: WorkspaceData[],
  zoomTier: "landscape" | "summary" | "detail",
  zoomProgress: number,
  zoom: number,
): Node[] {
  const nodes: Node[] = [];

  const rowHeight = zoomTier === "detail" ? TERRITORY.ITEM_ROW_HEIGHT * 2.6 : TERRITORY.ITEM_ROW_HEIGHT;

  // Show all workspace territories in grid
  workspaces.forEach((ws, idx) => {
    const col = idx % TERRITORY.COLS;
    const row = Math.floor(idx / TERRITORY.COLS);
    
    // Dynamic height based on content
    const grouped: Record<string, WorkspaceItemData[]> = {};
    for (const item of ws.items) {
      const key = item.itemType;
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(item);
    }
    
    let requiredHeight = 900; // Base header height (increased to accommodate massive fonts)
    for (const [, group] of Object.entries(TYPE_GROUP_LABELS)) {
      const items = group.types.flatMap((t) => grouped[t] ?? []);
      if (items.length > 0) {
        requiredHeight += 120 + Math.ceil(items.length / TERRITORY.ITEMS_PER_ROW) * rowHeight + 40;
      }
    }
    const territoryHeight = Math.max(TERRITORY.HEIGHT, requiredHeight);
    const territoryWidth = Math.max(TERRITORY.WIDTH, 80 + TERRITORY.ITEMS_PER_ROW * TERRITORY.ITEM_COL_WIDTH + 60); // Dynamic width based on columns
    
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
      style: { width: territoryWidth, height: territoryHeight, zIndex: 0 },
    });

    // Render items as child nodes
    let groupY = 900; // Offset below header

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

      items.forEach((item, idx) => {
        const itemCol = idx % TERRITORY.ITEMS_PER_ROW;
        const itemRow = Math.floor(idx / TERRITORY.ITEMS_PER_ROW);
        nodes.push({
          id: `item-${item.id}`,
          type: "itemNode",
          parentId: `ws-${ws.id}`,
          position: {
            x: item.canvasX ?? (80 + itemCol * TERRITORY.ITEM_COL_WIDTH),
            y: item.canvasY ?? (groupY + itemRow * rowHeight),
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
          style: { zIndex: 2 },
        });
      });

      groupY +=
        Math.ceil(items.length / TERRITORY.ITEMS_PER_ROW) * rowHeight + 40;
    }
  });

  return nodes;
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
  const viewportX = useWorkspaceStore((s) => s.viewportX);
  const viewportY = useWorkspaceStore((s) => s.viewportY);
  const setViewport = useWorkspaceStore((s) => s.setViewport);
  const setFocusedItem = useWorkspaceStore((s) => s.setFocusedItem);
  const backgroundMode = useWorkspaceStore((s) => s.backgroundMode);
  const committedWorkspaceId = useWorkspaceStore((s) => s.committedWorkspaceId);

  const { setCenter } = useReactFlow();

  useEffect(() => {
    if (committedWorkspaceId) {
      const idx = workspaces.findIndex(w => w.id === committedWorkspaceId);
      if (idx >= 0) {
        const col = idx % TERRITORY.COLS;
        const row = Math.floor(idx / TERRITORY.COLS);
        const centerX = col * TERRITORY.SPACING_X + TERRITORY.WIDTH / 2;
        const centerY = row * TERRITORY.SPACING_Y + TERRITORY.HEIGHT / 2;
        
        setCenter(centerX, centerY, { zoom: VP.DEFAULT_ZOOM, duration: 800 });
      }
    }
  }, [committedWorkspaceId, workspaces, setCenter]);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Commit transition: soften the harsh mode jump when entering/leaving a workspace
  const transitioning = false;

  const nodes = useMemo(
    () => buildNodes(workspaces, zoomTier, zoomProgress, zoom),
    [workspaces, zoomTier, zoomProgress, zoom],
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

  const [contextMenu, setContextMenu] = useState<{ x: number, y: number, type: 'pane' | 'node', id?: string } | null>(null);

  const handlePaneContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, type: 'pane' });
  }, []);

  const handleNodeContextMenu = useCallback((e: React.MouseEvent, node: Node) => {
    e.preventDefault();
    if (node.type === 'itemNode') {
      setContextMenu({ x: e.clientX, y: e.clientY, type: 'node', id: node.id.replace('item-', '') });
    } else {
      setContextMenu({ x: e.clientX, y: e.clientY, type: 'pane' });
    }
  }, []);

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
    <div 
      className="h-full w-full relative"
      style={{
        backgroundImage: backgroundMode === "dots" 
          ? "radial-gradient(circle, var(--border-default) 1.5px, transparent 1.5px)"
          : backgroundMode === "grid" 
            ? "linear-gradient(var(--border-default) 1px, transparent 1px), linear-gradient(90deg, var(--border-default) 1px, transparent 1px)"
            : "none",
        backgroundSize: backgroundMode === "dots" ? "32px 32px" : backgroundMode === "grid" ? "48px 48px" : "auto",
        backgroundPosition: `${viewportX}px ${viewportY}px`
      }}
    >
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
          fitViewOptions={{ padding: 0.3, maxZoom: VP.DEFAULT_ZOOM + 0.05 }}
          deleteKeyCode={null}
          selectionKeyCode={null}
        >
        </ReactFlow>

        {/* Context Menu */}
        {contextMenu && (
          <div
            className="fixed z-[100] flex min-w-[180px] flex-col gap-0.5 rounded-xl border border-[var(--border-default)]/50 bg-[var(--bg-elevated)]/95 p-1.5 shadow-[0_12px_28px_-12px_rgba(8,22,40,0.30)] backdrop-blur-xl"
            style={{ top: contextMenu.y, left: contextMenu.x }}
            onClick={(e) => e.stopPropagation()}
          >
            {contextMenu.type === "pane" ? (
              <>
                <div className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-tertiary)]">
                  Create new
                </div>
                <button type="button" className="flex items-center gap-2.5 rounded-lg px-2 py-2 text-[13px] font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]">
                  <Layers className="h-4 w-4 shrink-0 text-[var(--text-tertiary)]" />
                  <span className="flex-1 text-left">New Workspace</span>
                </button>
                <button type="button" className="flex items-center gap-2.5 rounded-lg px-2 py-2 text-[13px] font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]">
                  <Wand2 className="h-4 w-4 shrink-0 text-[var(--accent-cyan)]/80" />
                  <span className="flex-1 text-left">Ask AI</span>
                </button>
                <button type="button" className="flex items-center gap-2.5 rounded-lg px-2 py-2 text-[13px] font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]">
                  <FileText className="h-4 w-4 shrink-0 text-[var(--text-tertiary)]" />
                  <span className="flex-1 text-left">Note</span>
                </button>
                <button type="button" className="flex items-center gap-2.5 rounded-lg px-2 py-2 text-[13px] font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]">
                  <Code2 className="h-4 w-4 shrink-0 text-[var(--text-tertiary)]" />
                  <span className="flex-1 text-left">Code</span>
                </button>
                <button type="button" className="flex items-center gap-2.5 rounded-lg px-2 py-2 text-[13px] font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]">
                  <ImageIcon className="h-4 w-4 shrink-0 text-[var(--text-tertiary)]" />
                  <span className="flex-1 text-left">Visual</span>
                </button>
                <button type="button" className="flex items-center gap-2.5 rounded-lg px-2 py-2 text-[13px] font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]">
                  <CalendarCheck className="h-4 w-4 shrink-0 text-[var(--text-tertiary)]" />
                  <span className="flex-1 text-left">Task</span>
                </button>
                <div className="my-0.5 h-px bg-[var(--border-default)]/25" />
                <button type="button" className="flex items-center gap-2.5 rounded-lg px-2 py-2 text-[13px] font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]">
                  <MessageSquare className="h-4 w-4 shrink-0 text-[var(--text-tertiary)]" />
                  <span className="flex-1 text-left">Thread</span>
                </button>
              </>
            ) : (
              <>
                <button type="button" onClick={() => { onItemClick?.(contextMenu.id!); setContextMenu(null); }} className="flex items-center gap-2.5 rounded-lg px-2 py-2 text-[13px] font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]">
                  <ExternalLink className="h-4 w-4 shrink-0 text-[var(--text-tertiary)]" />
                  <span className="flex-1 text-left">Open in Right Hub</span>
                </button>
                <button type="button" onClick={() => setContextMenu(null)} className="flex items-center gap-2.5 rounded-lg px-2 py-2 text-[13px] font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]">
                  <Link className="h-4 w-4 shrink-0 text-[var(--text-tertiary)]" />
                  <span className="flex-1 text-left">Copy Link</span>
                </button>
                <div className="my-0.5 h-px bg-[var(--border-default)]/25" />
                <button type="button" onClick={() => setContextMenu(null)} className="flex items-center gap-2.5 rounded-lg px-2 py-2 text-[13px] font-medium text-[var(--danger)] transition-colors hover:bg-[var(--danger)]/10">
                  <Trash2 className="h-4 w-4 shrink-0 text-[var(--danger)]/80" />
                  <span className="flex-1 text-left">Delete Item</span>
                </button>
              </>
            )}
          </div>
        )}
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
