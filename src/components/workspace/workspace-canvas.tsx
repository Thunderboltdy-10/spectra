"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  ControlButton,
  Controls,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
  type Node,
  type NodeProps,
  type ReactFlowInstance,
  type Viewport,
} from "@xyflow/react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Crosshair, FileText, Home, Layers, MessageSquare, Plus, ZoomIn,
  Copy, Move, Pin, Archive, History, Code2, Image as ImageIcon, CalendarClock,
  Sparkles, Merge, ArrowRight, ChevronRight, Search,
  SortAsc, FolderOpen, PenLine,
} from "lucide-react";
import { useWorkspaceStore, type WorkspaceBackgroundMode, type ZoomBand } from "@/stores/workspace-store";
import type { Workstream } from "@/hooks/use-workspace-data";
import { cn } from "@/lib/utils";
import { getWorkstreamColor } from "@/lib/workspace/zoom-helpers";
import { stripGeneratedDocumentMarkers } from "@/lib/document-generator";
import {
  computeCanonicalLayout,
  applyOverrides,
  getLifecycleVisuals,
  WORKSTREAM_TERRITORY,
} from "@/lib/workspace/auto-layout";
import {
  saveLocalOverride,
  loadLocalOverrides,
  initPersistenceListeners,
} from "@/lib/workspace/position-persistence";
import {
  WorkspaceFieldNode,
  WorkstreamTitleNode,
  CategoryFieldNode,
  EmptyStateNode,
  FocusTimerNode,
  buildWorkspaceNodes,
  buildWorkspaceWidgetNodes,
  type ThreadSummary,
  type NoteSummary,
  type PlannerItemSummary,
  type ArtifactSummary,
  type WorkspaceWidgetSummary,
  WorkspaceWidgetNode,
} from "@/components/workspace/views/internal-content-nodes";
import { subscribeWorkspaceContentMutated } from "@/lib/workspace/events";

/* ─── Types ──────────────────────────────────────────────── */

type WorkspaceCanvasProps = {
  workstreams: Workstream[];
  onNewWorkstream?: () => void;
  onWorkstreamUpdate?: (workstreamId: string, data: Partial<Workstream>) => void;
  focusWorkstreamId?: string;
  searchQuery?: string;
  onOpenWorkstream?: (workstreamId: string) => void;
  onOpenHub?: () => void;
  onCommitWorkstream?: (workstreamId: string | null) => void;
  onOpenPanel?: (type: import("@/stores/workspace-store").PanelType, id: string) => void;
  onCreateArtifact?: () => void;
  panelWidth?: number;
};

type WorkstreamNodeData = {
  workstream: Workstream;
  band: ZoomBand;
  isFocused: boolean;
  isDimmed: boolean;
  isCommitted: boolean;
  neighborOpacity: number;
  lifecycle: { opacity: number; scale: number; dashed: boolean };
  onOpen: (workstreamId: string) => void;
};



/* ─── Context menu item ─────────────────────────────────── */

function ContextMenuItem({ icon, label, hint, onClick }: {
  icon: React.ReactNode;
  label: string;
  hint?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-hover)]"
    >
      <span className="text-[var(--text-tertiary)]">{icon}</span>
      <span className="flex-1">{label}</span>
      {hint && <kbd className="text-[10px] text-[var(--text-tertiary)] bg-[var(--bg-secondary)] px-1.5 py-0.5 rounded">{hint}</kbd>}
    </button>
  );
}

/* ─── Time-of-day ambient class & greeting ─────────────── */

function getAmbientClass(): string {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) return "workspace-ambient-morning";
  if (hour >= 12 && hour < 17) return "workspace-ambient-afternoon";
  if (hour >= 17 && hour < 21) return "workspace-ambient-evening";
  return "workspace-ambient-night";
}

/* ─── Zoom helpers ───────────────────────────────────────── */

function getNeighborOpacity(zoom: number): number {
  if (zoom <= 0.55) return 1;
  if (zoom >= 1.05) return 0;
  return Math.max(0, 1 - (zoom - 0.55) / 0.5);
}

function restoreViewport(): Viewport {
  const defaultVp: Viewport = { x: 0, y: 0, zoom: 0.18 };
  if (typeof window === "undefined") {
    return defaultVp;
  }
  try {
    const saved = window.localStorage.getItem("workspace:viewport");
    if (!saved) return defaultVp;
    const parsed = JSON.parse(saved) as Viewport;
    if (
      typeof parsed.x === "number"
      && typeof parsed.y === "number"
      && typeof parsed.zoom === "number"
    ) {
      return parsed;
    }
  } catch {
    // Ignore
  }
  return defaultVp;
}

export const __workspaceCanvasTestUtils = {
  restoreViewport,
  getNeighborOpacity,
};

/* ─── Edge builders ──────────────────────────────────────── */

function resolveHandlePositions() {
  return [
    { id: "top", position: Position.Top },
    { id: "right", position: Position.Right },
    { id: "bottom", position: Position.Bottom },
    { id: "left", position: Position.Left },
  ] as const;
}

function pickDirectionalHandles(
  source: { x: number; y: number },
  target: { x: number; y: number },
) {
  const dx = target.x - source.x;
  const dy = target.y - source.y;

  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0
      ? { sourceHandle: "source-right", targetHandle: "target-left" }
      : { sourceHandle: "source-left", targetHandle: "target-right" };
  }

  return dy >= 0
    ? { sourceHandle: "source-bottom", targetHandle: "target-top" }
    : { sourceHandle: "source-top", targetHandle: "target-bottom" };
}

function buildPeerLinks(workstreams: Workstream[], positions: Map<string, { x: number; y: number }>) {
  const active = workstreams.filter((ws) => ws.status === "active");
  const edges: Edge[] = [];

  const tokenize = (v: string) =>
    v.toLowerCase().split(/[^a-z0-9]+/i).filter((t) => t.length >= 4);

  const sharedTokenCount = (a: Workstream, b: Workstream) => {
    const aTokens = new Set([
      ...tokenize(a.title), ...tokenize(a.description ?? ""),
      ...(a.subjectCode ? tokenize(a.subjectCode) : []),
    ]);
    const bTokens = new Set([
      ...tokenize(b.title), ...tokenize(b.description ?? ""),
      ...(b.subjectCode ? tokenize(b.subjectCode) : []),
    ]);
    let count = 0;
    for (const t of aTokens) if (bTokens.has(t)) count++;
    return count;
  };

  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i]!;
      const b = active[j]!;
      const related =
        a.type === b.type
        || (a.subjectCode && b.subjectCode && a.subjectCode === b.subjectCode)
        || sharedTokenCount(a, b) > 0;
      if (!related) continue;
      const sourcePos = positions.get(a._id) ?? { x: 0, y: 0 };
      const targetPos = positions.get(b._id) ?? { x: 0, y: 0 };
      const { sourceHandle, targetHandle } = pickDirectionalHandles(
        { x: sourcePos.x + 600, y: sourcePos.y + 400 },
        { x: targetPos.x + 600, y: targetPos.y + 400 },
      );
      edges.push({
        id: `peer-${a._id}-${b._id}`,
        source: `ws-${a._id}`,
        target: `ws-${b._id}`,
        sourceHandle,
        targetHandle,
        type: "smoothstep",
        animated: false,
        selectable: false,
        deletable: false,
        style: {
          stroke: "color-mix(in oklab, var(--accent-mint) 30%, var(--border-default))",
          strokeWidth: 1,
          strokeDasharray: "6 10",
          opacity: 0.4,
        },
      });
    }
  }
  return edges.slice(0, 18);
}

function buildEdges(
  workstreams: Workstream[],
  positions: Map<string, { x: number; y: number }>,
  showConnections: boolean,
  committedId?: string,
): Edge[] {
  if (!showConnections) return [];
  // Hide edges when inside a committed workstream
  if (committedId) return [];
  return buildPeerLinks(workstreams, positions);
}

type CachedWorkspaceContent = {
  threads: ThreadSummary[];
  notes: NoteSummary[];
  plannerItems: PlannerItemSummary[];
  artifacts: ArtifactSummary[];
  widgets: WorkspaceWidgetSummary[];
  hubQuickNotes: Array<{ id: string; title: string; updatedAt: number }>;
  hubDeadlines: Array<{ id: string; title: string; dueAt: number; workstreamTitle?: string }>;
  hubActivity: Array<{ id: string; title: string; type: string; timestamp: number }>;
};

const WORKSPACE_CACHE_MAX = 7;
const HUB_CACHE_KEY = "__hub__";
const CONTEXT_MENU_MARGIN = 18;

/**
 * Bounded LRU map.  Access order is maintained by deleting + re-inserting on
 * every `get` and `set`, relying on JS Map's guaranteed insertion-order
 * iteration.  The first entry is always the least-recently-used.
 */
class LruMap<K, V> {
  private readonly max: number;
  private readonly store: Map<K, V>;

  constructor(max: number) {
    this.max = max;
    this.store = new Map();
  }

  has(key: K): boolean {
    return this.store.has(key);
  }

  get(key: K): V | undefined {
    if (!this.store.has(key)) return undefined;
    const value = this.store.get(key)!;
    // Promote to most-recently-used by deleting and re-inserting
    this.store.delete(key);
    this.store.set(key, value);
    return value;
  }

  set(key: K, value: V): void {
    if (this.store.has(key)) {
      this.store.delete(key);
    } else if (this.store.size >= this.max) {
      // Evict the first (least-recently-used) entry
      const lruKey = this.store.keys().next().value;
      if (lruKey !== undefined) this.store.delete(lruKey);
    }
    this.store.set(key, value);
  }

  delete(key: K): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }

  entries(): Array<[K, V]> {
    return Array.from(this.store.entries());
  }
}

type WorkspaceContentSnapshot = {
  contentById: Record<string, CachedWorkspaceContent>;
  loadingContentIds: string[];
  cacheKeys: string[];
  inFlightKeys: string[];
};

export function createWorkspaceContentController(config: {
  fetchWorkstreamContent: (workstreamId: string) => Promise<CachedWorkspaceContent>;
  onStateChange?: (snapshot: WorkspaceContentSnapshot) => void;
  cacheMax?: number;
}) {
  const cache = new LruMap<string, CachedWorkspaceContent>(config.cacheMax ?? WORKSPACE_CACHE_MAX);
  const inFlight = new Map<string, Promise<CachedWorkspaceContent>>();
  const loading = new Set<string>();
  let contentById: Record<string, CachedWorkspaceContent> = {};
  let mutationVersion = 0;

  const emit = () => {
    config.onStateChange?.({
      contentById,
      loadingContentIds: Array.from(loading),
      cacheKeys: cache.entries().map(([key]) => key),
      inFlightKeys: Array.from(inFlight.keys()),
    });
  };

  const getCachedContent = (workstreamId: string) =>
    contentById[workstreamId] ?? cache.get(workstreamId) ?? emptyWorkspaceContent();

  const invalidate = (workstreamId?: string, options?: { includeHub?: boolean }) => {
    mutationVersion += 1;
    if (!workstreamId) {
      cache.clear();
      inFlight.clear();
      loading.clear();
      contentById = {};
      emit();
      return mutationVersion;
    }

    cache.delete(workstreamId);
    inFlight.delete(workstreamId);
    loading.delete(workstreamId);

    const next = { ...contentById };
    delete next[workstreamId];

    if (options?.includeHub) {
      cache.delete(HUB_CACHE_KEY);
      inFlight.delete(HUB_CACHE_KEY);
      loading.delete(HUB_CACHE_KEY);
      delete next[HUB_CACHE_KEY];
    }

    contentById = next;
    emit();
    return mutationVersion;
  };

  const fetch = async (workstreamId: string) => {
    if (cache.has(workstreamId)) {
      return getCachedContent(workstreamId);
    }

    const existingPromise = inFlight.get(workstreamId);
    if (existingPromise) {
      return existingPromise;
    }

    const requestVersion = mutationVersion;
    loading.add(workstreamId);
    emit();

    const promise = config.fetchWorkstreamContent(workstreamId)
      .then((next) => {
        if (requestVersion === mutationVersion) {
          cache.set(workstreamId, next);
          contentById = { ...contentById, [workstreamId]: next };
          emit();
        }
        return next;
      })
      .finally(() => {
        inFlight.delete(workstreamId);
        if (loading.delete(workstreamId)) {
          emit();
        }
      });

    inFlight.set(workstreamId, promise);
    return promise;
  };

  return {
    fetch,
    invalidate,
    getCachedContent,
    snapshot: () => ({
      contentById,
      loadingContentIds: Array.from(loading),
      cacheKeys: cache.entries().map(([key]) => key),
      inFlightKeys: Array.from(inFlight.keys()),
      cacheSize: cache.size,
    }),
  };
}

function emptyWorkspaceContent(): CachedWorkspaceContent {
  return {
    threads: [],
    notes: [],
    plannerItems: [],
    artifacts: [],
    widgets: [],
    hubQuickNotes: [],
    hubDeadlines: [],
    hubActivity: [],
  };
}

function clampContextMenuPosition(
  x: number,
  y: number,
  containerRect: DOMRect,
  menuWidth = 220,
  menuHeight = 260,
) {
  return {
    x: Math.min(
      Math.max(x, CONTEXT_MENU_MARGIN),
      Math.max(CONTEXT_MENU_MARGIN, containerRect.width - menuWidth - CONTEXT_MENU_MARGIN),
    ),
    y: Math.min(
      Math.max(y, CONTEXT_MENU_MARGIN),
      Math.max(CONTEXT_MENU_MARGIN, containerRect.height - menuHeight - CONTEXT_MENU_MARGIN),
    ),
  };
}

function namespaceFlowNodes(prefix: string, nodes: Node[]) {
  return nodes.map((node) => ({
    ...node,
    id: `${prefix}:${node.id}`,
  }));
}

function namespaceFlowEdges(prefix: string, edges: Edge[]) {
  return edges.map((edge) => ({
    ...edge,
    id: `${prefix}:${edge.id}`,
    source: `${prefix}:${edge.source}`,
    target: `${prefix}:${edge.target}`,
  }));
}

/* ─── Workstream Node ────────────────────────────────────── */

const WorkstreamNode = memo(function WorkstreamNode({
  data,
}: NodeProps<Node<WorkstreamNodeData>>) {
  const { workstream, band, isFocused, isDimmed, isCommitted, neighborOpacity, lifecycle, onOpen } = data;
  const color = getWorkstreamColor(workstream.color);

  // Unified V2 scale
  const width = band === "overview" ? 800 : band === "summary" ? 1200 : WORKSTREAM_TERRITORY.width;
  const dissolving = isCommitted;

  return (
    <div className="relative">
      {resolveHandlePositions().map((handle) => (
        <Handle
          key={`target-${handle.id}`}
          id={`target-${handle.id}`}
          type="target"
          position={handle.position}
          className="!h-2 !w-2 !border-0 !bg-transparent !opacity-0"
        />
      ))}
      {resolveHandlePositions().map((handle) => (
        <Handle
          key={`source-${handle.id}`}
          id={`source-${handle.id}`}
          type="source"
          position={handle.position}
          className="!h-2 !w-2 !border-0 !bg-transparent !opacity-0"
        />
      ))}

      <motion.button
        type="button"
        onClick={() => !dissolving && onOpen(workstream._id)}
        animate={{
          opacity: dissolving ? 0.85 : isDimmed ? lifecycle.opacity * neighborOpacity : lifecycle.opacity,
          scale: dissolving ? 0.92 : lifecycle.scale,
          y: dissolving ? -4 : 0,
        }}
        whileHover={dissolving ? undefined : { scale: 1.015, y: -1.5 }}
        transition={{ duration: dissolving ? 0.35 : 0.25, ease: [0.22, 1, 0.36, 1] }}
        className={cn(
          "group relative text-left transition-[box-shadow,border-color] duration-300",
          dissolving ? "rounded-[16px]" : "rounded-[22px]",
          dissolving && "pointer-events-none",
          isFocused && !dissolving && "ring-2 ring-[color:var(--accent-cyan)] ring-offset-2 ring-offset-[var(--bg-primary)]",
        )}
        style={{
          width: dissolving ? width * 0.8 : width,
          background: dissolving
            ? "transparent"
            : isFocused
              ? "var(--bg-elevated)"
              : "color-mix(in oklab, var(--bg-primary) 30%, transparent)",
          borderWidth: 1,
          borderStyle: lifecycle.dashed ? "dashed" : "solid",
          borderColor: dissolving
            ? `${color.value}40`
            : isFocused
              ? "var(--border-default)"
              : "color-mix(in oklab, var(--border-default) 40%, transparent)",
          backdropFilter: !isFocused && !dissolving ? "blur(8px)" : undefined,
          boxShadow: dissolving
            ? `0 0 18px -10px ${color.value}30`
            : isFocused
              ? `0 0 0 1px color-mix(in oklab, ${color.value} 26%, transparent), 0 18px 36px -28px rgba(15,23,42,0.45)`
              : `0 8px 16px -12px rgba(0,0,0,0.1)`,
        }}
      >
        {!isFocused && !dissolving && (
          <div
            className="pointer-events-none absolute -left-10 -top-10 h-40 w-40 rounded-full opacity-60 blur-3xl transition-opacity duration-300 group-hover:opacity-80"
            style={{ background: `${color.value}45` }}
          />
        )}

        <div className={cn("relative flex flex-col", dissolving ? "px-3 py-2" : "px-4 py-3.5")}>
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <span className={cn(dissolving ? "text-sm" : "text-lg", !isFocused && !dissolving && "text-base")}>
                {workstream.emoji || "📚"}
              </span>
              <div className="min-w-0">
                <h3
                  className={cn(
                    "font-display leading-snug text-[var(--text-primary)]",
                    dissolving && "text-xs",
                    !dissolving && !isFocused && "text-xl",
                    !dissolving && isFocused && "text-base",
                  )}
                >
                  {workstream.title}
                </h3>
              </div>
            </div>
            {!dissolving && isFocused && (
              <span
                className="mt-0.5 shrink-0 rounded-md px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider"
                style={{ background: color.bg, color: color.value }}
              >
                {workstream.type}
              </span>
            )}
          </div>

          {/* Description — shows at summary/detail zoom OR when focused */}
          <AnimatePresence>
            {(isFocused || band !== "overview") && !dissolving && (
              <motion.p
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2 }}
                className="mt-2 line-clamp-2 text-xs leading-relaxed text-[var(--text-secondary)]"
              >
                {workstream.description || "A space for threads, artifacts, and tasks."}
              </motion.p>
            )}
          </AnimatePresence>

          {/* Stats bar — shows at summary/detail zoom OR when focused */}
          <AnimatePresence>
            {(isFocused || band !== "overview") && !dissolving && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2, delay: 0.05 }}
                className="mt-3 flex items-center gap-3 text-[10px] text-[var(--text-tertiary)]"
              >
                <span>
                  {workstream.threadCount ?? 0} threads
                </span>
                <span className="h-3 w-px bg-[var(--border-default)]" />
                <span>
                  {workstream.artifactCount ?? 0} artifacts
                </span>
                <span className="h-3 w-px bg-[var(--border-default)]" />
                <span>
                  {formatActivity(workstream.lastActivityAt)}
                </span>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Footer with CTA — only at detail zoom or when focused */}
          <AnimatePresence>
            {(isFocused || band === "detail") && !dissolving && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2, delay: 0.1 }}
                className="mt-3 flex items-center justify-between pt-3 border-t border-[var(--border-default)]"
              >
                <span className="text-[10px] text-[var(--text-tertiary)]">
                  Click to enter
                </span>
                <span className="text-xs font-medium text-[var(--accent-cyan)] transition-transform duration-150 group-hover:translate-x-1">
                  Open field →
                </span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.button>
    </div>
  );
});


function formatActivity(timestamp?: number) {
  if (!timestamp) return "Fresh";
  const delta = Date.now() - timestamp;
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h`;
  return `${Math.floor(delta / 86_400_000)}d`;
}

/* ─── Background ─────────────────────────────────────────── */

function FlowBackground({
  mode,
}: {
  mode: WorkspaceBackgroundMode;
}) {
  if (mode === "blank") return null;
  const isDots = mode === "dots";
  return (
    <Background
      gap={isDots ? 28 : 56}
      size={isDots ? 1.45 : 0.8}
      variant={isDots ? BackgroundVariant.Dots : BackgroundVariant.Lines}
      color={isDots
            ? "color-mix(in oklab, var(--border-default) 74%, transparent)"
            : "color-mix(in oklab, var(--border-default) 60%, transparent)"}
    />
  );
}

/* ─── Breadcrumb ─────────────────────────────────────────── */


const FLOW_NODE_TYPES = {
  workstream: WorkstreamNode,
  workspaceField: WorkspaceFieldNode,
  workstreamTitle: WorkstreamTitleNode,
  categoryField: CategoryFieldNode,
  workspaceWidget: WorkspaceWidgetNode,
  emptyState: EmptyStateNode,
  focusTimer: FocusTimerNode,
} as const;

/* ─── Canvas Inner ───────────────────────────────────────── */

function WorkspaceCanvasInner({
  workstreams,
  onNewWorkstream,
  focusWorkstreamId,
  searchQuery = "",
  onOpenWorkstream,
  onOpenHub,
  onCommitWorkstream,
  onOpenPanel,
}: WorkspaceCanvasProps) {
  const reactFlowRef = useRef<ReactFlowInstance | null>(null);
  const initializedRef = useRef(false);
  const commitDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commitAnimationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const animatedCommitRef = useRef<string | null>(null);
  const prefetchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const workstreamDragThrottleRef = useRef(new Map<string, number>());
  const lastViewportRef = useRef<{ x: number; y: number; zoom: number }>({ x: 0, y: 0, zoom: 0.35 });
  const contentControllerRef = useRef<ReturnType<typeof createWorkspaceContentController> | null>(null);
  const internalNodeOverridesRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const widgetLayoutMetaRef = useRef(new Map<string, { itemId: string; origin: { x: number; y: number } }>());
  const {
    showArchived,
    showConnections,
    backgroundMode,
    primaryWorkstreamId,
    visibleWorkstreamIds,
    viewMode,
    setCamera,
    setZoomBand,
    commitWorkstream,
    setVisibleWorkstreamIds,
    exitWorkstream,
    setPreviousViewport,
  } = useWorkspaceStore();
  const [zoom, setZoom] = useState(restoreViewport().zoom);
  const semanticBand = useMemo<ZoomBand>(() => {
    if (primaryWorkstreamId) return "detail";
    if (zoom < 0.20) return "overview";
    if (zoom < 0.55) return "summary";
    return "detail";
  }, [primaryWorkstreamId, zoom]);
  const [localOverrides, setLocalOverrides] = useState(() => loadLocalOverrides());
  const [internalNodeOverrides, setInternalNodeOverrides] = useState<Map<string, { x: number; y: number }>>(new Map());
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [itemContextMenu, setItemContextMenu] = useState<{ x: number; y: number; itemId: string; itemType: "thread" | "note" | "planner" | "artifact" } | null>(null);
  const [groupContextMenu, setGroupContextMenu] = useState<{ x: number; y: number; groupType: string } | null>(null);
  const [focusedItemId, setFocusedItemId] = useState<string | null>(null);
  const [movePicker, setMovePicker] = useState<{ itemId: string; sourceWorkstreamId: string } | null>(null);
  const [movePickerSearch, setMovePickerSearch] = useState("");
  const positionContextMenu = useCallback((clientX: number, clientY: number, width?: number, height?: number) => {
    const root = document.querySelector("[data-workspace-flow-root]");
    const rect = root?.getBoundingClientRect();
    if (!rect) {
      return { x: clientX, y: clientY };
    }
    return clampContextMenuPosition(clientX - rect.left, clientY - rect.top, rect, width, height);
  }, []);
  const lastMutationIdRef = useRef<string | null>(null);
  const [contentById, setContentById] = useState<Record<string, CachedWorkspaceContent>>({});
  const [loadingContentIds, setLoadingContentIds] = useState<string[]>([]);
  const sanitizeTitle = useCallback((value: unknown) => {
    const text = typeof value === "string" ? stripGeneratedDocumentMarkers(value).trim() : "";
    return text || "Untitled";
  }, []);

  useEffect(() => {
    internalNodeOverridesRef.current = new Map();
    setInternalNodeOverrides(new Map());
  }, [viewMode]);

  useEffect(() => {
    const cleanup = initPersistenceListeners();
    return cleanup;
  }, []);

  const visibleWorkstreams = useMemo(() => {
    const trimmed = searchQuery.trim().toLowerCase();
    return (showArchived
      ? workstreams
      : workstreams.filter((ws) => ws.status !== "archived"))
      .filter((ws) => {
        if (!trimmed) return true;
        return [ws.title, ws.description ?? "", ws.subjectCode ?? ""]
          .some((v) => v.toLowerCase().includes(trimmed));
      });
  }, [searchQuery, showArchived, workstreams]);

  const band = semanticBand;
  const neighborOpacity = getNeighborOpacity(zoom);
  const panelOpener = onOpenPanel ?? useWorkspaceStore.getState().openPanel;

  const positions = useMemo(() => {
    const canonical = computeCanonicalLayout(workstreams);
    return applyOverrides(canonical, workstreams, localOverrides);
  }, [workstreams, localOverrides]);

  // Auto-exit when zooming far out of a committed workstream
  useEffect(() => {
    if (!primaryWorkstreamId || zoom >= 0.15) return;
    if (onCommitWorkstream) {
      onCommitWorkstream(null);
    } else {
      exitWorkstream();
    }
  }, [zoom, primaryWorkstreamId, exitWorkstream, onCommitWorkstream]);


  useEffect(() => {
    setZoomBand(band);
  }, [band, setZoomBand]);

  const fetchWorkstreamContent = useCallback(async (workstreamId: string) => {
        if (workstreamId === HUB_CACHE_KEY) {
          const [docsRes, plannerRes, activityRes] = await Promise.all([
            fetch("/api/artifacts?action=hub&type=document&limit=12"),
            fetch("/api/planner?action=hub&limit=12&days=14"),
            fetch("/api/chats?limit=10"),
          ]);

          const next: CachedWorkspaceContent = emptyWorkspaceContent();
          if (docsRes.ok) {
            const data = await docsRes.json();
            next.hubQuickNotes = (data.artifacts ?? []).map((artifact: Record<string, unknown>) => ({
              id: String(artifact._id),
              title: sanitizeTitle(artifact.title),
              updatedAt: Number(artifact.updatedAt ?? Date.now()),
            }));
          }
          if (plannerRes.ok) {
            const data = await plannerRes.json();
            next.hubDeadlines = (data.aggregatedDeadlines ?? []).map((item: Record<string, unknown>) => ({
              id: String(item._id),
              title: sanitizeTitle(item.title),
              dueAt: Number(item.dueAt ?? Date.now()),
              workstreamTitle: typeof item.workstreamId === "string"
                ? workstreams.find((ws) => ws._id === item.workstreamId)?.title
                : undefined,
            }));
          }
          if (activityRes.ok) {
            const data = await activityRes.json();
            next.hubActivity = (data.chats ?? []).map((chat: Record<string, unknown>) => ({
              id: String(chat._id),
              title: sanitizeTitle(chat.title ?? chat.latestUserPrompt ?? "Conversation"),
              type: String(chat.threadType ?? "chat"),
              timestamp: Number(chat.updatedAt ?? Date.now()),
            }));
          }
          return next;
        }

        const [chatsRes, docsRes, artifactsRes, plannerRes, widgetsRes] = await Promise.all([
          fetch(`/api/chats?workstreamId=${workstreamId}&limit=20`),
          fetch(`/api/artifacts?workstreamId=${workstreamId}&type=document&limit=20`),
          fetch(`/api/artifacts?workstreamId=${workstreamId}&limit=20`),
          fetch(`/api/planner?workstreamId=${workstreamId}&limit=20`),
          fetch(`/api/workspace-items?workstreamId=${workstreamId}`),
        ]);

        const next: CachedWorkspaceContent = emptyWorkspaceContent();
        if (chatsRes.ok) {
          const data = await chatsRes.json();
          next.threads = (data.chats ?? []).map((chat: Record<string, unknown>) => ({
            id: String(chat._id),
            title: sanitizeTitle(chat.title ?? chat.latestUserPrompt ?? "Untitled"),
            messageCount: Number(chat.messageCount ?? 0),
            lastActivityAt: Number(chat.updatedAt ?? Date.now()),
          }));
        }
        if (docsRes.ok) {
          const data = await docsRes.json();
          next.notes = (data.artifacts ?? []).map((artifact: Record<string, unknown>) => ({
            id: String(artifact._id),
            title: sanitizeTitle(artifact.title),
            updatedAt: Number(artifact.updatedAt ?? Date.now()),
            editorMode: String(artifact.editorMode ?? "standard"),
          }));
        }
        if (artifactsRes.ok) {
          const data = await artifactsRes.json();
          next.artifacts = (data.artifacts ?? [])
            .filter((artifact: Record<string, unknown>) => artifact.type !== "document")
            .map((artifact: Record<string, unknown>) => ({
              id: String(artifact._id),
              title: sanitizeTitle(artifact.title),
              type: String(artifact.type ?? "artifact"),
              createdAt: Number(artifact.createdAt ?? Date.now()),
            }));
        }
        if (plannerRes.ok) {
          const data = await plannerRes.json();
          next.plannerItems = (data.plannerItems ?? []).map((item: Record<string, unknown>) => ({
            id: String(item._id),
            title: sanitizeTitle(item.title),
            dueAt: typeof item.dueAt === "number" ? item.dueAt : undefined,
            status: (item.status as PlannerItemSummary["status"]) ?? "pending",
          }));
        }
        if (widgetsRes.ok) {
          const data = await widgetsRes.json();
          next.widgets = (data.items ?? []).flatMap((item: Record<string, unknown>) => {
            const id = String(item._id ?? "");
            const panelId = String(item.sourceArtifactId ?? item.sourceChatId ?? item.sourcePlannerItemId ?? "");
            if (!id || !panelId) return [];
            const itemType = String(item.type ?? "custom");
            const panelType = item.sourceArtifactId
              ? "artifact"
              : item.sourceChatId
                ? "chat"
                : item.sourcePlannerItemId
                  ? "planner"
                  : "artifact";
            return [{
              id,
              title: sanitizeTitle(item.title),
              itemType,
              renderMode: typeof item.renderMode === "string" ? item.renderMode : undefined,
              contentSummary: typeof item.contentSummary === "string" ? item.contentSummary : undefined,
              x: Number(item.x ?? 0),
              y: Number(item.y ?? 0),
              width: typeof item.width === "number" ? item.width : undefined,
              height: typeof item.height === "number" ? item.height : undefined,
              panelType,
              panelId,
            } satisfies WorkspaceWidgetSummary];
          });
        }
        return next;
  }, [sanitizeTitle, workstreams]);

  useEffect(() => {
    contentControllerRef.current = createWorkspaceContentController({
      fetchWorkstreamContent,
      cacheMax: WORKSPACE_CACHE_MAX,
      onStateChange: (snapshot) => {
        setContentById(snapshot.contentById);
        setLoadingContentIds(snapshot.loadingContentIds);
      },
    });
    setContentById({});
    setLoadingContentIds([]);
  }, [fetchWorkstreamContent]);

  const getCachedContent = useCallback((workstreamId: string) => {
    return contentControllerRef.current?.getCachedContent(workstreamId) ?? emptyWorkspaceContent();
  }, []);

  const invalidateWorkstreamContent = useCallback((workstreamId?: string, options?: { includeHub?: boolean }) => {
    contentControllerRef.current?.invalidate(workstreamId, options);
  }, []);

  const fetchContentForWorkstream = useCallback(async (workstreamId: string) => {
    await contentControllerRef.current?.fetch(workstreamId);
  }, []);

  useEffect(() => {
    return subscribeWorkspaceContentMutated((detail) => {
      if (detail.workstreamId) {
        invalidateWorkstreamContent(detail.workstreamId, { includeHub: detail.refreshHub });
        if (visibleWorkstreamIds.includes(detail.workstreamId)) {
          void fetchContentForWorkstream(detail.workstreamId);
        }
        if (detail.refreshHub && visibleWorkstreamIds.includes(HUB_CACHE_KEY)) {
          void fetchContentForWorkstream(HUB_CACHE_KEY);
        }
        return;
      }

      invalidateWorkstreamContent(undefined);
      if (primaryWorkstreamId) {
        void fetchContentForWorkstream(primaryWorkstreamId);
      }
      if (visibleWorkstreamIds.includes(HUB_CACHE_KEY)) {
        void fetchContentForWorkstream(HUB_CACHE_KEY);
      }
    });
  }, [
    fetchContentForWorkstream,
    invalidateWorkstreamContent,
    primaryWorkstreamId,
    visibleWorkstreamIds,
  ]);

  useEffect(() => {
    if (!primaryWorkstreamId || visibleWorkstreamIds.length === 0) {
      return;
    }
    void Promise.all(visibleWorkstreamIds.map((workstreamId) => fetchContentForWorkstream(workstreamId)));
  }, [primaryWorkstreamId, fetchContentForWorkstream, visibleWorkstreamIds]);

  const handleOpenWorkstream = useCallback(
    (workstreamId: string) => {
      if (primaryWorkstreamId === workstreamId) return;
      if (commitAnimationTimeoutRef.current) {
        clearTimeout(commitAnimationTimeoutRef.current);
      }
      const instance = reactFlowRef.current;
      if (instance) {
        animatedCommitRef.current = workstreamId;
        setPreviousViewport({ ...lastViewportRef.current });
        const node = instance.getNode(`ws-${workstreamId}`);
        if (node) {
          instance.setCenter(
            node.position.x + WORKSTREAM_TERRITORY.width / 2,
            node.position.y + WORKSTREAM_TERRITORY.height / 2,
            { zoom: 0.85, duration: 450 },
          );
        }
      }

      commitAnimationTimeoutRef.current = setTimeout(() => {
        setVisibleWorkstreamIds([workstreamId]);
        commitWorkstream(workstreamId);
        void fetchContentForWorkstream(workstreamId);
        onOpenWorkstream?.(workstreamId);
      }, 450);
    },
    [commitWorkstream, fetchContentForWorkstream, onOpenWorkstream, primaryWorkstreamId, setPreviousViewport, setVisibleWorkstreamIds],
  );

  const handleExitWorkstream = useCallback(() => {
    if (commitAnimationTimeoutRef.current) {
      clearTimeout(commitAnimationTimeoutRef.current);
    }
    animatedCommitRef.current = null;
    exitWorkstream();
    onCommitWorkstream?.(null);

    const instance = reactFlowRef.current;
    if (instance) {
      setTimeout(() => {
        instance.fitView({ padding: 0.08, duration: 400, nodes: undefined });
      }, 50);
    }
  }, [exitWorkstream, onCommitWorkstream]);

  const handleOpenHub = useCallback(
    () => {
      if (primaryWorkstreamId === HUB_CACHE_KEY) return;
      if (commitAnimationTimeoutRef.current) {
        clearTimeout(commitAnimationTimeoutRef.current);
      }
      const instance = reactFlowRef.current;
      if (instance) {
        animatedCommitRef.current = HUB_CACHE_KEY;
        setPreviousViewport({ ...lastViewportRef.current });
        instance.setCenter(0, 0, { zoom: 0.85, duration: 450 });
      }
      commitAnimationTimeoutRef.current = setTimeout(() => {
        setVisibleWorkstreamIds([HUB_CACHE_KEY]);
        commitWorkstream(HUB_CACHE_KEY);
        void fetchContentForWorkstream(HUB_CACHE_KEY);
        onOpenHub?.();
      }, 450);
    },
    [commitWorkstream, fetchContentForWorkstream, onOpenHub, primaryWorkstreamId, setPreviousViewport, setVisibleWorkstreamIds],
  );

  useEffect(() => {
    const instance = reactFlowRef.current;
    if (!instance || !initializedRef.current) return;

    if (!primaryWorkstreamId) {
      animatedCommitRef.current = null;
      return;
    }

    if (animatedCommitRef.current === primaryWorkstreamId) return;

    if (primaryWorkstreamId === HUB_CACHE_KEY) {
      animatedCommitRef.current = HUB_CACHE_KEY;
      setPreviousViewport({ ...lastViewportRef.current });
      setVisibleWorkstreamIds([HUB_CACHE_KEY]);
      void fetchContentForWorkstream(HUB_CACHE_KEY);
      instance.setCenter(0, 0, { zoom: 0.85, duration: 450 });
      return;
    }

    const node = instance.getNode(`ws-${primaryWorkstreamId}`);
    if (!node) return;
    animatedCommitRef.current = primaryWorkstreamId;
    setPreviousViewport({ ...lastViewportRef.current });
    setVisibleWorkstreamIds([primaryWorkstreamId]);
    void fetchContentForWorkstream(primaryWorkstreamId);
    instance.setCenter(
      node.position.x + WORKSTREAM_TERRITORY.width / 2,
      node.position.y + WORKSTREAM_TERRITORY.height / 2,
      { zoom: 0.85, duration: 450 },
    );
  }, [fetchContentForWorkstream, positions, primaryWorkstreamId, setPreviousViewport, setVisibleWorkstreamIds]);

  useEffect(() => () => {
    if (commitDebounceRef.current) clearTimeout(commitDebounceRef.current);
    if (commitAnimationTimeoutRef.current) clearTimeout(commitAnimationTimeoutRef.current);
    if (prefetchDebounceRef.current) clearTimeout(prefetchDebounceRef.current);
  }, []);

  const { nodes, edges } = useMemo<{ nodes: Node[]; edges: Edge[] }>(() => {
    const generatedNodes: Node[] = [];
    const generatedEdges: Edge[] = [];
    const nextWidgetLayoutMeta = new Map<string, { itemId: string; origin: { x: number; y: number } }>();



    const workstreamNodes: Node<WorkstreamNodeData>[] = visibleWorkstreams.map((ws) => {
      const pos = positions.get(ws._id) ?? { x: 0, y: 0 };
      const isCommitted = primaryWorkstreamId === ws._id;
      const isSecondaryVisible = visibleWorkstreamIds.includes(ws._id) && !isCommitted;
      const isDimmed = !!primaryWorkstreamId && !isCommitted && !isSecondaryVisible;
      const lifecycle = getLifecycleVisuals(ws);

      return {
        id: `ws-${ws._id}`,
        type: "workstream",
        position: pos,
        draggable: !primaryWorkstreamId,
        selectable: false,
        hidden: isCommitted || (isDimmed && neighborOpacity <= 0),
        data: {
          workstream: ws,
          band,
          isFocused: focusWorkstreamId === ws._id,
          isDimmed,
          isCommitted,
          neighborOpacity,
          lifecycle,
          onOpen: handleOpenWorkstream,
        },
      };
    });

    generatedNodes.push(...workstreamNodes);
    generatedEdges.push(...buildEdges(visibleWorkstreams, positions, showConnections, primaryWorkstreamId));

    if (visibleWorkstreamIds.length > 0) {
      for (const workstreamId of visibleWorkstreamIds) {
        const loading = loadingContentIds.includes(workstreamId) && !(workstreamId in contentById);
        const cached = getCachedContent(workstreamId);



        // Build actual UI-specific internal nodes for the workstream!
        if (primaryWorkstreamId === workstreamId) {
          const workstreamPos = positions.get(workstreamId) ?? { x: 0, y: 0 };
          const basePos = { x: workstreamPos.x, y: workstreamPos.y + 400 };
          const focusWorkstream = workstreams.find((ws) => ws._id === workstreamId);

          const contentData = {
            threads: cached.threads,
            notes: cached.notes,
            plannerItems: cached.plannerItems,
            artifacts: cached.artifacts,
            widgets: cached.widgets,
            loading,
            workstreamEmoji: focusWorkstream?.emoji,
            workstreamTitle: focusWorkstream?.title,
            onOpenPanel: panelOpener,
            band,
            // W2: Touch tier + context menus
            focusedItemId: focusedItemId ?? undefined,
            onFocusItem: (id: string) => setFocusedItemId(id),
            onBlurItem: () => setFocusedItemId(null),
            onItemContextMenu: (id: string, itemType: "thread" | "note" | "planner" | "artifact", x: number, y: number) => {
              const next = positionContextMenu(x, y, 220, 260);
              setItemContextMenu({ itemId: id, itemType, x: next.x, y: next.y });
            },
            onGroupContextMenu: (groupType: string, x: number, y: number) => {
              const next = positionContextMenu(x, y, 220, 220);
              setGroupContextMenu({ groupType, x: next.x, y: next.y });
            },
          };

          const builderResult = buildWorkspaceNodes(contentData, basePos);

          generatedNodes.push(...namespaceFlowNodes(`internal:${workstreamId}`, builderResult.nodes).map(node => ({
            ...node,
            position: internalNodeOverrides.get(node.id) ?? node.position,
          })));
          generatedEdges.push(...namespaceFlowEdges(`internal:${workstreamId}`, builderResult.edges));

          const widgetNodes = namespaceFlowNodes(
            `internal:${workstreamId}`,
            buildWorkspaceWidgetNodes(contentData, basePos),
          ).map((node) => {
            const overriddenPosition = internalNodeOverrides.get(node.id) ?? node.position;
            const rawWidgetId = node.id.split(":").pop() ?? node.id;
            const itemId = rawWidgetId.replace(/^widget-/, "");
            nextWidgetLayoutMeta.set(node.id, {
              itemId,
              origin: basePos,
            });
            return {
              ...node,
              position: overriddenPosition,
            };
          });
          generatedNodes.push(...widgetNodes);
        }
      }
    }

    widgetLayoutMetaRef.current = nextWidgetLayoutMeta;
    return { nodes: generatedNodes, edges: generatedEdges };
  }, [
    band,
    contentById,
    focusWorkstreamId,
    focusedItemId,
    getCachedContent,
    handleOpenWorkstream,
    internalNodeOverrides,
    loadingContentIds,
    neighborOpacity,
    panelOpener,
    positionContextMenu,
    positions,
    primaryWorkstreamId,
    visibleWorkstreamIds,
    visibleWorkstreams,
    showConnections,
    workstreams,
  ]);

  const handleInit = useCallback((instance: ReactFlowInstance) => {
    reactFlowRef.current = instance;
    if (initializedRef.current) return;
    initializedRef.current = true;
    // Use focusWorkstreamId (from URL param) as fallback when the store hasn't synced yet.
    // This handles the timing gap where the canvas mounts before the URL-sync useEffect fires.
    const initWorkstreamId = primaryWorkstreamId ?? focusWorkstreamId;
    if (initWorkstreamId) {
      // Workspace pre-committed via URL param.
      // Mark animatedCommitRef so the canvas effect doesn't re-zoom on top.
      animatedCommitRef.current = initWorkstreamId;
      // Immediately surface internal nodes — without this, the useEffect guard above
      // (animatedCommitRef check) would prevent the effect from ever calling
      // setVisibleWorkstreamIds, leaving the workspace interior blank.
      setVisibleWorkstreamIds([initWorkstreamId]);
      void fetchContentForWorkstream(initWorkstreamId);
      // Restore saved viewport if it was inside this workspace (zoom > 0.5)
      const saved = restoreViewport();
      if (saved.zoom > 0.5) {
        instance.setViewport(saved, { duration: 0 });
        setCamera({ x: saved.x, y: saved.y, z: saved.zoom });
        setZoom(saved.zoom);
      } else {
        // Saved viewport is overview zoom — center on the workspace node at a good zoom level
        const node = instance.getNode(`ws-${initWorkstreamId}`);
        if (node) {
          instance.setCenter(
            node.position.x + WORKSTREAM_TERRITORY.width / 2,
            node.position.y + WORKSTREAM_TERRITORY.height / 2,
            { zoom: 0.85, duration: 0 },
          );
          const vp = instance.getViewport();
          setCamera({ x: vp.x, y: vp.y, z: vp.zoom });
          setZoom(vp.zoom);
        } else {
          instance.setViewport(saved, { duration: 0 });
          setCamera({ x: saved.x, y: saved.y, z: saved.zoom });
          setZoom(saved.zoom);
        }
      }
    } else {
      setTimeout(() => {
        instance.fitView({ padding: 0.08, duration: 400 });
        const vp = instance.getViewport();
        setCamera({ x: vp.x, y: vp.y, z: vp.zoom });
        setZoom(vp.zoom);
      }, 50);
    }
  }, [fetchContentForWorkstream, focusWorkstreamId, primaryWorkstreamId, setCamera, setVisibleWorkstreamIds]);

  const handleMove = useCallback((_: unknown, viewport: Viewport) => {
    setZoom(viewport.zoom);
    lastViewportRef.current = { x: viewport.x, y: viewport.y, zoom: viewport.zoom };

    if (!primaryWorkstreamId && viewport.zoom >= 0.62) {
      if (commitDebounceRef.current) {
        clearTimeout(commitDebounceRef.current);
      }
      commitDebounceRef.current = setTimeout(() => {
        const instance = reactFlowRef.current;
        if (!instance || primaryWorkstreamId) return;
        const viewportState = instance.getViewport();
        if (viewportState.zoom < 0.62) return;
        const viewportNow = instance.getViewport();
        const bounds = document
          .querySelector("[data-workspace-flow-root]")
          ?.getBoundingClientRect();
        const center = bounds
          ? {
              x: (bounds.width / 2 - viewportNow.x) / viewportNow.zoom,
              y: (bounds.height / 2 - viewportNow.y) / viewportNow.zoom,
            }
          : { x: 0, y: 0 };
        const candidate = visibleWorkstreams
          .map((ws) => {
            const pos = positions.get(ws._id) ?? { x: 0, y: 0 };
            const dx = center.x - (pos.x + WORKSTREAM_TERRITORY.width / 2);
            const dy = center.y - (pos.y + WORKSTREAM_TERRITORY.height / 2);
            return { ws, distance: Math.hypot(dx, dy) };
          })
          .sort((a, b) => a.distance - b.distance)[0];

        if (candidate && candidate.distance <= 1100) {
          handleOpenWorkstream(candidate.ws._id);
        }
      }, 220);
    }
  }, [handleOpenWorkstream, positions, primaryWorkstreamId, visibleWorkstreams]);

  const handleMoveEnd = useCallback(
    (_: unknown, viewport: Viewport) => {
      setZoom(viewport.zoom);
      setCamera({ x: viewport.x, y: viewport.y, z: viewport.zoom });
      lastViewportRef.current = { x: viewport.x, y: viewport.y, zoom: viewport.zoom };
      try {
        window.localStorage.setItem("workspace:viewport", JSON.stringify(viewport));
      } catch {
        // Ignore
      }
    },
    [setCamera],
  );

  const persistWorkstreamPosition = useCallback((workstreamId: string, x: number, y: number) => {
    void fetch("/api/workstreams", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      body: JSON.stringify({
        action: "update",
        workstreamId,
        canvasX: x,
        canvasY: y,
      }),
    });
  }, []);

  const persistWidgetPosition = useCallback((itemId: string, x: number, y: number) => {
    void fetch("/api/workspace-items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      body: JSON.stringify({
        action: "update",
        itemId,
        x,
        y,
      }),
    });
  }, []);

  const handleNodeDragStop = useCallback(
    (_: unknown, node: Node) => {
      const x = Math.round(node.position.x);
      const y = Math.round(node.position.y);

      if (node.id.startsWith("ws-")) {
        const workstreamId = node.id.slice(3);
        setLocalOverrides((current) => {
          const next = new Map(current);
          next.set(workstreamId, { x, y });
          return next;
        });
        saveLocalOverride(workstreamId, x, y);
        persistWorkstreamPosition(workstreamId, x, y);
        return;
      }

      internalNodeOverridesRef.current.set(node.id, { x, y });
      setInternalNodeOverrides((current) => {
        const next = new Map(current);
        next.set(node.id, { x, y });
        return next;
      });

      const widgetMeta = widgetLayoutMetaRef.current.get(node.id);
      if (widgetMeta) {
        const relativeX = x - widgetMeta.origin.x;
        const relativeY = y - widgetMeta.origin.y;
        persistWidgetPosition(widgetMeta.itemId, relativeX, relativeY);
      }
    },
    [persistWidgetPosition, persistWorkstreamPosition],
  );

  const handleNodeDrag = useCallback((_: unknown, node: Node) => {
    const x = Math.round(node.position.x);
    const y = Math.round(node.position.y);

    const lastUpdate = workstreamDragThrottleRef.current.get(node.id) ?? 0;
    const now = Date.now();
    if (now - lastUpdate < 50) {
      return;
    }
    workstreamDragThrottleRef.current.set(node.id, now);

    if (node.id.startsWith("ws-")) {
      const workstreamId = node.id.slice(3);
      setLocalOverrides((current) => {
        const next = new Map(current);
        next.set(workstreamId, { x, y });
        return next;
      });
      return;
    }

    internalNodeOverridesRef.current.set(node.id, { x, y });
    setInternalNodeOverrides((current) => {
      const next = new Map(current);
      next.set(node.id, { x, y });
      return next;
    });
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isModZ = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z" && !e.shiftKey;
      if (isModZ) {
        if (lastMutationIdRef.current) {
          const mutId = lastMutationIdRef.current;
          lastMutationIdRef.current = null;
          void fetch("/api/workspace-items", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "revertMutation", mutationId: mutId }),
          }).then((r) => {
            if (r.ok && primaryWorkstreamId) {
              invalidateWorkstreamContent(primaryWorkstreamId);
              void fetchContentForWorkstream(primaryWorkstreamId);
            }
          });
        }
        return;
      }
      if (e.key === "Escape") {
        if (focusedItemId) { setFocusedItemId(null); return; }
        if (itemContextMenu) { setItemContextMenu(null); return; }
        if (groupContextMenu) { setGroupContextMenu(null); return; }
        if (movePicker) { setMovePicker(null); return; }
        if (contextMenu) { setContextMenu(null); return; }
        if (primaryWorkstreamId) { handleExitWorkstream(); }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    handleExitWorkstream, primaryWorkstreamId, focusedItemId,
    itemContextMenu, groupContextMenu, movePicker, contextMenu,
    invalidateWorkstreamContent, fetchContentForWorkstream,
  ]);

  useEffect(() => {
    if (!contextMenu && !itemContextMenu && !groupContextMenu) return;
    const handleWindowContextMenu = () => {
      setContextMenu(null);
      setItemContextMenu(null);
      setGroupContextMenu(null);
    };
    window.addEventListener("contextmenu", handleWindowContextMenu);
    return () => window.removeEventListener("contextmenu", handleWindowContextMenu);
  }, [contextMenu, groupContextMenu, itemContextMenu]);

  useEffect(() => {
    const handler = () => {
      const instance = reactFlowRef.current;
      if (!instance) return;
      if (primaryWorkstreamId) {
        handleExitWorkstream();
      } else {
        instance.fitView({ padding: 0.08, duration: 500 });
      }
    };
    window.addEventListener("workspace:center-home", handler);
    return () => window.removeEventListener("workspace:center-home", handler);
  }, [handleExitWorkstream, primaryWorkstreamId]);

  useEffect(() => {
    const instance = reactFlowRef.current;
    if (!instance || !focusWorkstreamId) return;
    const target = instance.getNode(`ws-${focusWorkstreamId}`);
    if (!target) return;
    instance.setCenter(
      target.position.x + WORKSTREAM_TERRITORY.width / 2,
      target.position.y + WORKSTREAM_TERRITORY.height / 2,
      { zoom: 0.6, duration: 600 },
    );
  }, [focusWorkstreamId]);

  useEffect(() => {
    // Use capture phase so the handler fires before stopPropagation in child elements,
    // ensuring context menus close on ANY click outside them.
    const handler = (e: MouseEvent) => {
      // Don't close if clicking inside a context menu element itself.
      // Browser automation and ReactFlow can dispatch events with non-HTMLElement targets.
      const target = e.target;
      if (target instanceof Element && target.closest("[data-context-menu]")) return;
      setContextMenu(null);
      setItemContextMenu(null);
      setGroupContextMenu(null);
    };
    window.addEventListener("mousedown", handler, true);
    return () => window.removeEventListener("mousedown", handler, true);
  }, []);

  return (
    <div
      className="relative h-full w-full overflow-hidden bg-[var(--bg-primary)]"
      data-workspace-flow-root
      style={{ transition: "width 300ms ease-out" }}
      onContextMenu={(event) => {
        const target = event.target as HTMLElement | null;
        if (target?.closest(".react-flow__node")) return;
        event.preventDefault();
        const bounds = event.currentTarget.getBoundingClientRect();
        setContextMenu(
          clampContextMenuPosition(
            event.clientX - bounds.left,
            event.clientY - bounds.top,
            bounds,
            220,
            260,
          ),
        );
      }}
    >
      <AnimatePresence>
      </AnimatePresence>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        fitView={false}
        minZoom={0.12}
        maxZoom={2.0}
        defaultViewport={restoreViewport()}
        nodeTypes={FLOW_NODE_TYPES}
        onInit={handleInit}
        onMove={handleMove}
        onMoveEnd={handleMoveEnd}
        onNodeDrag={handleNodeDrag}
        onNodeDragStop={handleNodeDragStop}
        nodesConnectable={false}
        nodesDraggable
        elementsSelectable={false}
        selectionOnDrag={false}
        panOnDrag
        panOnScroll={false}
        zoomOnScroll={true}
        zoomOnPinch={true}
        zoomOnDoubleClick={false}
        proOptions={{ hideAttribution: true }}
        className={cn("workspace-react-flow", getAmbientClass())}
        onNodeClick={(_: React.MouseEvent, node: Node) => {
          if (typeof node.id !== "string") return;
          if (!node.id.startsWith("ws-")) return;
          const workstreamId = node.id.slice(3);
          if (!workstreamId) return;
          handleOpenWorkstream(workstreamId);
        }}
      >
      <div
        className="pointer-events-none absolute inset-0 z-0"
        style={{
          background: "transparent",
        }}
      />
      <FlowBackground mode={backgroundMode} />
        <Controls position="top-right" showInteractive={false}>
          <ControlButton
            onClick={() => reactFlowRef.current?.zoomTo(0.7, { duration: 350 })}
            title="Focus detail band"
          >
            <ZoomIn className="h-4 w-4" />
          </ControlButton>
          <ControlButton
            onClick={() => {
              if (primaryWorkstreamId) {
                handleExitWorkstream();
              } else {
                reactFlowRef.current?.fitView({ padding: 0.08, duration: 500 });
              }
            }}
            title="Fit all workstreams"
          >
            <Crosshair className="h-4 w-4" />
          </ControlButton>
        </Controls>
      </ReactFlow>

      {/* ─── Empty canvas context menu ─── */}
      {contextMenu && (
        <div
          data-context-menu
          onMouseDown={(e) => e.stopPropagation()}
          className="absolute z-40 min-w-[220px] overflow-hidden rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)]/96 p-1.5 shadow-[0_18px_48px_-18px_rgba(15,23,42,0.38)] backdrop-blur-xl"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          {primaryWorkstreamId && primaryWorkstreamId !== HUB_CACHE_KEY ? (
            <>
              <ContextMenuItem icon={<FileText className="h-3.5 w-3.5" />} label="New note" onClick={() => { setContextMenu(null); panelOpener("artifact", "new"); }} />
              <ContextMenuItem icon={<MessageSquare className="h-3.5 w-3.5" />} label="New thread" onClick={() => { setContextMenu(null); panelOpener("chat", "new"); }} />
              <ContextMenuItem icon={<ImageIcon className="h-3.5 w-3.5" />} label="New diagram" onClick={() => { setContextMenu(null); panelOpener("artifact", "new-diagram"); }} />
              <ContextMenuItem icon={<Code2 className="h-3.5 w-3.5" />} label="New code" onClick={() => { setContextMenu(null); panelOpener("artifact", "new-code"); }} />
              <ContextMenuItem icon={<CalendarClock className="h-3.5 w-3.5" />} label="New planner task" onClick={() => { setContextMenu(null); panelOpener("planner", "new"); }} />
              <div className="my-1 h-px bg-[var(--border-default)]/50" />
              <ContextMenuItem icon={<FolderOpen className="h-3.5 w-3.5" />} label="Paste from clipboard" onClick={() => { setContextMenu(null); }} />
            </>
          ) : (
            <>
              <ContextMenuItem icon={<Layers className="h-3.5 w-3.5" />} label="New workstream" hint="W" onClick={() => { setContextMenu(null); onNewWorkstream?.(); }} />
              <ContextMenuItem icon={<Home className="h-3.5 w-3.5" />} label="Open hub" onClick={() => { setContextMenu(null); handleOpenHub(); }} />
              <div className="my-1 h-px bg-[var(--border-default)]/50" />
              <ContextMenuItem icon={<FolderOpen className="h-3.5 w-3.5" />} label="Paste from clipboard" onClick={() => { setContextMenu(null); }} />
            </>
          )}
        </div>
      )}

      {/* ─── Item context menu ─── */}
      {itemContextMenu && (
        <div
          data-context-menu
          onMouseDown={(e) => e.stopPropagation()}
          className="absolute z-40 min-w-[220px] overflow-hidden rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)]/96 p-1.5 shadow-[0_18px_48px_-18px_rgba(15,23,42,0.38)] backdrop-blur-xl"
          style={{ left: itemContextMenu.x, top: itemContextMenu.y }}
        >
          <ContextMenuItem
            icon={<FolderOpen className="h-3.5 w-3.5" />}
            label="Open in editor"
            onClick={() => {
              setItemContextMenu(null);
              const panelType = itemContextMenu.itemType === "thread" ? "chat" : itemContextMenu.itemType === "planner" ? "planner" : "artifact";
              panelOpener(panelType, itemContextMenu.itemId);
            }}
          />
          <ContextMenuItem
            icon={<Sparkles className="h-3.5 w-3.5" />}
            label="Edit with AI…"
            onClick={() => {
              setItemContextMenu(null);
              panelOpener("artifact", itemContextMenu.itemId);
            }}
          />
          <ContextMenuItem
            icon={<Copy className="h-3.5 w-3.5" />}
            label="Duplicate"
            onClick={async () => {
              const { itemId } = itemContextMenu;
              setItemContextMenu(null);
              const r = await fetch("/api/workspace-items", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "duplicate", itemId }),
              });
              if (r.ok) {
                const data = await r.json() as { mutationId?: string };
                if (data.mutationId) lastMutationIdRef.current = data.mutationId;
                if (primaryWorkstreamId) {
                  invalidateWorkstreamContent(primaryWorkstreamId);
                  void fetchContentForWorkstream(primaryWorkstreamId);
                }
              }
            }}
          />
          <div className="my-1 h-px bg-[var(--border-default)]/50" />
          <ContextMenuItem
            icon={<Move className="h-3.5 w-3.5" />}
            label="Move to workspace…"
            onClick={() => {
              const src = primaryWorkstreamId ?? "";
              setItemContextMenu(null);
              setMovePicker({ itemId: itemContextMenu.itemId, sourceWorkstreamId: src });
              setMovePickerSearch("");
            }}
          />
          <div className="my-1 h-px bg-[var(--border-default)]/50" />
          <ContextMenuItem
            icon={<Pin className="h-3.5 w-3.5" />}
            label="Pin to top"
            onClick={async () => {
              const { itemId } = itemContextMenu;
              setItemContextMenu(null);
              await fetch("/api/workspace-items", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "pin", itemId, pinned: true }),
              });
              if (primaryWorkstreamId) {
                invalidateWorkstreamContent(primaryWorkstreamId);
                void fetchContentForWorkstream(primaryWorkstreamId);
              }
            }}
          />
          <ContextMenuItem
            icon={<History className="h-3.5 w-3.5" />}
            label="Version history"
            onClick={() => {
              setItemContextMenu(null);
              panelOpener("artifact", itemContextMenu.itemId);
            }}
          />
          <ContextMenuItem
            icon={<Archive className="h-3.5 w-3.5" />}
            label="Archive"
            onClick={async () => {
              const { itemId } = itemContextMenu;
              setItemContextMenu(null);
              await fetch("/api/workspace-items", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "archive", itemId }),
              });
              if (primaryWorkstreamId) {
                invalidateWorkstreamContent(primaryWorkstreamId);
                void fetchContentForWorkstream(primaryWorkstreamId);
              }
            }}
          />
        </div>
      )}

      {/* ─── Group context menu ─── */}
      {groupContextMenu && (
        <div
          data-context-menu
          onMouseDown={(e) => e.stopPropagation()}
          className="absolute z-40 min-w-[220px] overflow-hidden rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)]/96 p-1.5 shadow-[0_18px_48px_-18px_rgba(15,23,42,0.38)] backdrop-blur-xl"
          style={{ left: groupContextMenu.x, top: groupContextMenu.y }}
        >
          <ContextMenuItem icon={<Plus className="h-3.5 w-3.5" />} label="Add item to group" onClick={() => { setGroupContextMenu(null); panelOpener("artifact", "new"); }} />
          <ContextMenuItem icon={<PenLine className="h-3.5 w-3.5" />} label="Rename group" onClick={() => { setGroupContextMenu(null); }} />
          <ContextMenuItem icon={<SortAsc className="h-3.5 w-3.5" />} label="Sort by…" onClick={() => { setGroupContextMenu(null); }} />
          <div className="my-1 h-px bg-[var(--border-default)]/50" />
          <ContextMenuItem icon={<ChevronRight className="h-3.5 w-3.5" />} label="Collapse group" onClick={() => { setGroupContextMenu(null); }} />
          <ContextMenuItem icon={<FolderOpen className="h-3.5 w-3.5" />} label="Open all in editor" onClick={() => { setGroupContextMenu(null); }} />
          <ContextMenuItem icon={<Sparkles className="h-3.5 w-3.5" />} label="AI: Summarize group" onClick={() => { setGroupContextMenu(null); }} />
          <ContextMenuItem icon={<Merge className="h-3.5 w-3.5" />} label="Merge with…" onClick={() => { setGroupContextMenu(null); }} />
        </div>
      )}

      {/* ─── Move to workspace picker ─── */}
      {movePicker && (
        <div
          data-context-menu
          onMouseDown={(e) => e.stopPropagation()}
          className="absolute z-50 w-72 overflow-hidden rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] shadow-[0_24px_56px_-16px_rgba(15,23,42,0.48)] backdrop-blur-xl"
          style={{ left: "50%", top: "50%", transform: "translate(-50%,-50%)" }}
        >
          <div className="px-4 pt-4 pb-2">
            <div className="text-[13px] font-semibold text-[var(--text-primary)] mb-3">Move to workspace</div>
            <div className="flex items-center gap-2 rounded-xl border border-[var(--border-default)]/60 bg-[var(--bg-secondary)] px-3 py-2">
              <Search className="h-3.5 w-3.5 shrink-0 text-[var(--text-tertiary)]" />
              <input
                autoFocus
                type="text"
                placeholder="Search workspaces…"
                value={movePickerSearch}
                onChange={(e) => setMovePickerSearch(e.target.value)}
                className="flex-1 bg-transparent text-[13px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]"
              />
            </div>
          </div>
          <div className="max-h-52 overflow-y-auto px-2 pb-2">
            {workstreams
              .filter((ws) => ws.status === "active" && ws._id !== movePicker.sourceWorkstreamId)
              .filter((ws) => !movePickerSearch || ws.title.toLowerCase().includes(movePickerSearch.toLowerCase()))
              .map((ws) => (
                <button
                  key={ws._id}
                  type="button"
                  onClick={async () => {
                    const { itemId, sourceWorkstreamId } = movePicker;
                    setMovePicker(null);
                    const r = await fetch("/api/workspace-items", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ action: "moveWidget", itemId, workstreamId: ws._id }),
                    });
                    if (r.ok) {
                      const data = await r.json() as { mutationId?: string };
                      if (data.mutationId) lastMutationIdRef.current = data.mutationId;
                      // Invalidate both source and destination
                      invalidateWorkstreamContent(sourceWorkstreamId);
                      invalidateWorkstreamContent(ws._id);
                      if (primaryWorkstreamId) void fetchContentForWorkstream(primaryWorkstreamId);
                    }
                  }}
                  className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm hover:bg-[var(--bg-hover)]"
                >
                  <span className="text-base">{ws.emoji || "📚"}</span>
                  <span className="text-[13px] text-[var(--text-primary)]">{ws.title}</span>
                  <ArrowRight className="ml-auto h-3.5 w-3.5 text-[var(--text-tertiary)]" />
                </button>
              ))
            }
          </div>
          <div className="border-t border-[var(--border-default)]/40 px-4 py-2.5">
            <button
              type="button"
              onClick={() => setMovePicker(null)}
              className="text-[12px] text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
            >
              Cancel
            </button>
          </div>
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
