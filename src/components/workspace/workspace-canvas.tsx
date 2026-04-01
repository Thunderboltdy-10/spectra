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
import { ChevronLeft, Crosshair, FileText, Home, Layers, MessageSquare, Plus, ZoomIn } from "lucide-react";
import { useWorkspaceStore, type WorkspaceBackgroundMode, type ZoomBand } from "@/stores/workspace-store";
import type { Workstream } from "@/hooks/use-workspace-data";
import { cn } from "@/lib/utils";
import { getWorkstreamColor } from "@/lib/workspace/zoom-helpers";
import { stripGeneratedDocumentMarkers } from "@/lib/document-generator";
import {
  computeCanonicalLayout,
  applyOverrides,
  getLifecycleVisuals,
} from "@/lib/workspace/auto-layout";
import {
  saveLocalOverride,
  loadLocalOverrides,
  initPersistenceListeners,
} from "@/lib/workspace/position-persistence";
import {
  GroupNode,
  ColumnNode,
  GraphItemNode,
  GraphOverflowNode,
  EmptyStateNode,
  FocusTimerNode,
  buildStructuredNodes,
  buildColumnNodes,
  buildGraphNodes,
  type ThreadSummary,
  type NoteSummary,
  type PlannerItemSummary,
  type ArtifactSummary,
} from "@/components/workspace/views/internal-content-nodes";
import { buildHubNodes } from "@/components/workspace/hub-internal-view";

/* ─── Types ──────────────────────────────────────────────── */

type WorkspaceCanvasProps = {
  workstreams: Workstream[];
  userName: string;
  userAvatar: string;
  onNewWorkstream?: () => void;
  onWorkstreamUpdate?: (workstreamId: string, data: Partial<Workstream>) => void;
  focusWorkstreamId?: string;
  searchQuery?: string;
  onOpenWorkstream?: (workstreamId: string) => void;
  onOpenHub?: () => void;
  /** Called when zoom-based commit happens */
  onCommitWorkstream?: (workstreamId: string | null) => void;
  onOpenPanel?: (type: import("@/stores/workspace-store").PanelType, id: string) => void;
  /** Open artifact creation dialog */
  onCreateArtifact?: () => void;
  /** Canvas width adjustment when push-panel is open */
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

function getTimeGreeting(): string {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) return "Good morning";
  if (hour >= 12 && hour < 17) return "Good afternoon";
  if (hour >= 17 && hour < 22) return "Good evening";
  return "Night owl";
}

/* ─── Zoom helpers ───────────────────────────────────────── */

function getRepresentationBand(zoom: number): ZoomBand {
  if (zoom < 0.25) return "overview";
  if (zoom < 0.5) return "summary";
  if (zoom < 0.9) return "detail";
  return "internal";
}

/** Calculate opacity for non-focused workstreams during deep zoom */
function getNeighborOpacity(zoom: number): number {
  if (zoom <= 0.7) return 1;
  if (zoom >= 1.0) return 0;
  return Math.max(0, 1 - (zoom - 0.7) / 0.3);
}

function restoreViewport(): Viewport {
  // Default zoom is low enough to see the full 2.5x-scaled layout
  const defaultVp: Viewport = { x: 0, y: 0, zoom: 0.35 };
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
        { x: sourcePos.x + 260, y: sourcePos.y + 140 },
        { x: targetPos.x + 260, y: targetPos.y + 140 },
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

  // Hub is now a persistent bar — only peer links remain on canvas
  return buildPeerLinks(workstreams, positions);
}

type CachedWorkspaceContent = {
  threads: ThreadSummary[];
  notes: NoteSummary[];
  plannerItems: PlannerItemSummary[];
  artifacts: ArtifactSummary[];
  hubQuickNotes: Array<{ id: string; title: string; updatedAt: number }>;
  hubDeadlines: Array<{ id: string; title: string; dueAt: number; workstreamTitle?: string }>;
  hubActivity: Array<{ id: string; title: string; type: string; timestamp: number }>;
};

function emptyWorkspaceContent(): CachedWorkspaceContent {
  return {
    threads: [],
    notes: [],
    plannerItems: [],
    artifacts: [],
    hubQuickNotes: [],
    hubDeadlines: [],
    hubActivity: [],
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

  // Node width by band (scaled up for 2.5x layout)
  const width = band === "overview" ? 420 : band === "summary" ? 520 : band === "detail" ? 620 : 700;

  // When committed: dissolve border (opacity + blur), don't hide entirely
  // so internal canvas-native nodes can coexist
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
          dissolving ? "rounded-xl" : "rounded-2xl",
          dissolving && "pointer-events-none",
          isFocused && !dissolving && "ring-2 ring-[color:var(--accent-cyan)] ring-offset-2 ring-offset-[var(--bg-primary)]",
        )}
        style={{
          width: dissolving ? width * 0.8 : width,
          background: "var(--bg-elevated)",
          borderWidth: 1,
          borderStyle: lifecycle.dashed ? "dashed" : "solid",
          borderColor: dissolving ? color.value + "40" : "var(--border-default)",
          boxShadow: dissolving
            ? `0 0 20px -8px ${color.value}30`
            : isFocused
              ? `0 4px 16px -4px ${color.value}20, 0 2px 8px -4px rgba(0,0,0,0.06)`
              : "0 2px 8px -4px rgba(0,0,0,0.06)",
        }}
      >
        {/* Ambient color stripe — warm accent at top and bottom */}
        <div
          className="absolute inset-x-0 top-0 h-[3px] rounded-t-2xl opacity-0 group-hover:opacity-60 transition-opacity duration-300"
          style={{ background: color.value }}
        />
        <div
          className="absolute inset-x-0 bottom-0 h-[3px] rounded-b-2xl opacity-0 group-hover:opacity-30 transition-opacity duration-300"
          style={{ background: color.value }}
        />

        <div className={cn("relative flex flex-col", dissolving ? "px-3 py-2" : "px-4 py-3.5")}>
          {/* Top row: emoji + title + type */}
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <span className={cn(dissolving ? "text-sm" : "text-lg", band === "overview" && !dissolving && "text-base")}>
                {workstream.emoji || "📚"}
              </span>
              <div className="min-w-0">
                <h3
                  className={cn(
                    "font-display leading-snug text-[var(--text-primary)]",
                    dissolving && "text-xs",
                    !dissolving && band === "overview" && "text-sm",
                    !dissolving && band === "summary" && "text-[0.95rem]",
                    !dissolving && (band === "detail" || band === "internal") && "text-base",
                  )}
                >
                  {workstream.title}
                </h3>
              </div>
            </div>
            {!dissolving && (
              <span
                className="mt-0.5 shrink-0 rounded-md px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider"
                style={{ background: color.bg, color: color.value }}
              >
                {workstream.type}
              </span>
            )}
          </div>

          {/* Description (summary+, hidden when dissolving) */}
          <AnimatePresence>
            {band !== "overview" && !dissolving && (
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

          {/* Metrics (summary+, hidden when dissolving) */}
          <AnimatePresence>
            {band !== "overview" && !dissolving && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2, delay: 0.05 }}
                className="mt-3 flex items-center gap-3 text-[10px] text-[var(--text-tertiary)]"
              >
                <span>{workstream.threadCount ?? 0} threads</span>
                <span className="h-3 w-px bg-[var(--border-default)]" />
                <span>{workstream.artifactCount ?? 0} artifacts</span>
                <span className="h-3 w-px bg-[var(--border-default)]" />
                <span>{formatActivity(workstream.lastActivityAt)}</span>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Detail band: enter affordance */}
          <AnimatePresence>
            {(band === "detail" || (band === "internal" && !isCommitted)) && !dissolving && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2, delay: 0.1 }}
                className="mt-3 flex items-center justify-between border-t border-[var(--border-default)] pt-3"
              >
                <span className="text-[10px] text-[var(--text-tertiary)]">
                  Click to enter
                </span>
                <span className="text-xs font-medium text-[var(--accent-cyan)] transition-transform duration-150 group-hover:translate-x-1">
                  Enter →
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

function FlowBackground({ mode, zoom }: { mode: WorkspaceBackgroundMode; zoom: number }) {
  if (mode === "blank") return null;
  const isDots = mode === "dots";
  const gap = isDots
    ? Math.max(22, Math.min(34, 28 / Math.max(zoom, 0.82)))
    : 56;
  return (
    <Background
      gap={gap}
      size={isDots ? 1.45 : 0.8}
      variant={isDots ? BackgroundVariant.Dots : BackgroundVariant.Lines}
      color={isDots
        ? "color-mix(in oklab, var(--border-default) 74%, transparent)"
        : "color-mix(in oklab, var(--border-default) 60%, transparent)"}
    />
  );
}

/* ─── Breadcrumb ─────────────────────────────────────────── */

function WorkspaceBreadcrumb({
  workstream,
  onBack,
}: {
  workstream: Workstream;
  onBack: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.2 }}
      className="absolute top-3 left-4 z-30 flex items-center gap-1.5"
    >
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
      >
        <ChevronLeft className="w-4 h-4" />
        <span>Workspace</span>
      </button>
      <span className="text-[var(--text-tertiary)]">/</span>
      <span className="text-sm font-medium text-[var(--text-primary)]">
        {workstream.emoji} {workstream.title}
      </span>
    </motion.div>
  );
}

const FLOW_NODE_TYPES = {
  workstream: WorkstreamNode,
  contentGroup: GroupNode,
  contentColumn: ColumnNode,
  graphItem: GraphItemNode,
  graphOverflow: GraphOverflowNode,
  emptyState: EmptyStateNode,
  focusTimer: FocusTimerNode,
} as const;

/* ─── Canvas Inner ───────────────────────────────────────── */

function WorkspaceCanvasInner({
  workstreams,
  userName,
  userAvatar,
  onNewWorkstream,
  focusWorkstreamId,
  searchQuery = "",
  onOpenWorkstream,
  onOpenHub,
  onCommitWorkstream,
  onOpenPanel,
  onCreateArtifact,
}: WorkspaceCanvasProps) {
  const reactFlowRef = useRef<ReactFlowInstance | null>(null);
  const initializedRef = useRef(false);
  const commitDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commitAnimationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const animatedCommitRef = useRef<string | null>(null);
  const prefetchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const workstreamDragThrottleRef = useRef(new Map<string, number>());
  const lastViewportRef = useRef<{ x: number; y: number; zoom: number }>({ x: 0, y: 0, zoom: 0.35 });
  const contentCacheRef = useRef(new Map<string, CachedWorkspaceContent>());
  const inFlightContentRef = useRef(new Map<string, Promise<void>>());
  const internalNodeOverridesRef = useRef<Map<string, { x: number; y: number }>>(new Map());
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
    timerState,
    startTimer,
    pauseTimer,
    resetTimer,
  } = useWorkspaceStore();
  const [zoom, setZoom] = useState(restoreViewport().zoom);
  const [semanticBand, setSemanticBand] = useState<ZoomBand>(() => getRepresentationBand(restoreViewport().zoom));
  const [localOverrides, setLocalOverrides] = useState(() => loadLocalOverrides());
  const [internalNodeOverrides, setInternalNodeOverrides] = useState<Map<string, { x: number; y: number }>>(new Map());
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [contentById, setContentById] = useState<Record<string, CachedWorkspaceContent>>({});
  const [loadingContentIds, setLoadingContentIds] = useState<string[]>([]);
  const sanitizeTitle = useCallback((value: unknown) => {
    const text = typeof value === "string" ? stripGeneratedDocumentMarkers(value).trim() : "";
    return text || "Untitled";
  }, []);

  useEffect(() => {
    const timeout = setTimeout(() => {
      setSemanticBand(getRepresentationBand(zoom));
    }, 180);
    return () => clearTimeout(timeout);
  }, [zoom]);

  useEffect(() => {
    internalNodeOverridesRef.current = new Map();
    setInternalNodeOverrides(new Map());
  }, [viewMode]);

  // Initialize persistence listeners
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

  // Compute positions using auto-layout + overrides
  const positions = useMemo(() => {
    const canonical = computeCanonicalLayout(workstreams);
    return applyOverrides(canonical, workstreams, localOverrides);
  }, [workstreams, localOverrides]);

  // Update zoom band in store
  useEffect(() => {
    setZoomBand(band);
  }, [band, setZoomBand]);

  const getCachedContent = useCallback((workstreamId: string) => {
    return contentById[workstreamId] ?? contentCacheRef.current.get(workstreamId) ?? emptyWorkspaceContent();
  }, [contentById]);

  const fetchContentForWorkstream = useCallback(async (workstreamId: string) => {
    if (contentCacheRef.current.has(workstreamId)) {
      return;
    }
    const existingPromise = inFlightContentRef.current.get(workstreamId);
    if (existingPromise) {
      await existingPromise;
      return;
    }

    const promise = (async () => {
      setLoadingContentIds((current) => (current.includes(workstreamId) ? current : [...current, workstreamId]));
      try {
        if (workstreamId === "__hub__") {
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
          contentCacheRef.current.set(workstreamId, next);
          setContentById((current) => ({ ...current, [workstreamId]: next }));
          return;
        }

        const [chatsRes, docsRes, artifactsRes, plannerRes] = await Promise.all([
          fetch(`/api/chats?workstreamId=${workstreamId}&limit=20`),
          fetch(`/api/artifacts?workstreamId=${workstreamId}&type=document&limit=20`),
          fetch(`/api/artifacts?workstreamId=${workstreamId}&limit=20`),
          fetch(`/api/planner?workstreamId=${workstreamId}&limit=20`),
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
        contentCacheRef.current.set(workstreamId, next);
        setContentById((current) => ({ ...current, [workstreamId]: next }));
      } finally {
        setLoadingContentIds((current) => current.filter((id) => id !== workstreamId));
        inFlightContentRef.current.delete(workstreamId);
      }
    })();

    inFlightContentRef.current.set(workstreamId, promise);
    await promise;
  }, [sanitizeTitle, workstreams]);

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
      // Animated zoom into the workstream
      const instance = reactFlowRef.current;
      if (instance) {
        animatedCommitRef.current = workstreamId;
        // Save current viewport for zoom-out restoration
        setPreviousViewport({ ...lastViewportRef.current });

        // Get node position and zoom to it — centered on the card
        const node = instance.getNode(`ws-${workstreamId}`);
        if (node) {
          instance.setCenter(
            node.position.x + 260,
            node.position.y + 120,
            { zoom: 1.0, duration: 450 },
          );
        }
      }

      // Commit after animation — set visibility for this workstream
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

    // Zoom out to fit all workstreams — always centered
    const instance = reactFlowRef.current;
    if (instance) {
      // Small delay to let nodes reappear before fitting
      setTimeout(() => {
        instance.fitView({ padding: 0.15, duration: 400, nodes: undefined });
      }, 50);
    }
  }, [exitWorkstream, onCommitWorkstream]);

  const handleOpenHub = useCallback(
    () => {
      if (primaryWorkstreamId === "__hub__") return;
      if (commitAnimationTimeoutRef.current) {
        clearTimeout(commitAnimationTimeoutRef.current);
      }
      const instance = reactFlowRef.current;
      if (instance) {
        animatedCommitRef.current = "__hub__";
        setPreviousViewport({ ...lastViewportRef.current });
        instance.setCenter(0, 0, { zoom: 1.0, duration: 450 });
      }
      commitAnimationTimeoutRef.current = setTimeout(() => {
        setVisibleWorkstreamIds(["__hub__"]);
        commitWorkstream("__hub__");
        void fetchContentForWorkstream("__hub__");
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

    if (primaryWorkstreamId === "__hub__") {
      animatedCommitRef.current = "__hub__";
      setPreviousViewport({ ...lastViewportRef.current });
      setVisibleWorkstreamIds(["__hub__"]);
      void fetchContentForWorkstream("__hub__");
      instance.setCenter(0, 0, { zoom: 1.0, duration: 450 });
      return;
    }

    const node = instance.getNode(`ws-${primaryWorkstreamId}`);
    if (!node) return;
    animatedCommitRef.current = primaryWorkstreamId;
    setPreviousViewport({ ...lastViewportRef.current });
    setVisibleWorkstreamIds([primaryWorkstreamId]);
    void fetchContentForWorkstream(primaryWorkstreamId);
    instance.setCenter(
      node.position.x + 260,
      node.position.y + 120,
      { zoom: 1.0, duration: 450 },
    );
  }, [fetchContentForWorkstream, positions, primaryWorkstreamId, setPreviousViewport, setVisibleWorkstreamIds]);

  useEffect(() => () => {
    if (commitDebounceRef.current) clearTimeout(commitDebounceRef.current);
    if (commitAnimationTimeoutRef.current) clearTimeout(commitAnimationTimeoutRef.current);
    if (prefetchDebounceRef.current) clearTimeout(prefetchDebounceRef.current);
  }, []);

  const nodes = useMemo<Node[]>(() => {
    // Hub is now a persistent bar — no hub node on canvas

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
        hidden: isDimmed && neighborOpacity <= 0,
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

    let internalNodes: Node[] = [];
    if (visibleWorkstreamIds.length > 0 && primaryWorkstreamId) {
      for (const workstreamId of visibleWorkstreamIds) {
        const isPrimary = primaryWorkstreamId === workstreamId;
        const loading = loadingContentIds.includes(workstreamId) && !contentCacheRef.current.has(workstreamId);
        const cached = getCachedContent(workstreamId);

        if (workstreamId === "__hub__") {
          const namespacedHubNodes = namespaceFlowNodes(`internal:${workstreamId}`, buildHubNodes(
            {
              quickNotes: cached.hubQuickNotes,
              deadlines: cached.hubDeadlines,
              recentActivity: cached.hubActivity,
              loading,
              onOpenPanel: panelOpener,
              onNewWorkstream,
              timerState,
              onTimerStart: () => startTimer(),
              onTimerPause: () => pauseTimer(),
              onTimerReset: () => resetTimer(),
            },
            { x: 80, y: 120 },
          ));
          internalNodes.push(...namespacedHubNodes.map((node) => ({
            ...node,
            position: internalNodeOverrides.get(node.id) ?? node.position,
            style: {
              ...node.style,
              opacity: isPrimary ? 1 : 0.6,
            },
          })));
          continue;
        }

        const focusWorkstream = workstreams.find((workstream) => workstream._id === workstreamId);
        const workstreamPos = positions.get(workstreamId) ?? { x: 0, y: 0 };
        const basePos = { x: workstreamPos.x - 40, y: workstreamPos.y + 120 };
        const contentData = {
          threads: cached.threads,
          notes: cached.notes,
          plannerItems: cached.plannerItems,
          artifacts: cached.artifacts,
          loading,
          workstreamEmoji: focusWorkstream?.emoji,
          workstreamTitle: focusWorkstream?.title,
          onOpenPanel: panelOpener,
        };

        let builtNodes: Node[] = [];
        if (viewMode === "structured") {
          builtNodes = buildStructuredNodes(contentData, basePos);
        } else if (viewMode === "columns") {
          builtNodes = buildColumnNodes(contentData, basePos);
        } else {
          builtNodes = buildGraphNodes(contentData, basePos).nodes;
        }

        const namespacedNodes = namespaceFlowNodes(`internal:${workstreamId}`, builtNodes);

        // Zone background: subtle gradient tint for spatial identity
        const wsColor = getWorkstreamColor(focusWorkstream?.color);
        const zoneNode: Node = {
          id: `zone-${workstreamId}`,
          type: "default",
          position: { x: basePos.x - 60, y: basePos.y - 40 },
          draggable: false,
          selectable: false,
          data: {},
          style: {
            width: 600,
            height: 500,
            background: `radial-gradient(ellipse at center, ${wsColor.value}06 0%, transparent 70%)`,
            borderRadius: 40,
            border: "none",
            pointerEvents: "none" as const,
            zIndex: -1,
          },
        };
        internalNodes.unshift(zoneNode);

        internalNodes.push(...namespacedNodes.map((node) => ({
          ...node,
          position: internalNodeOverrides.get(node.id) ?? node.position,
          style: {
            ...node.style,
            opacity: isPrimary ? 1 : 0.6,
          },
        })));
      }
    }

    return [...workstreamNodes, ...internalNodes];
  }, [
    band,
    focusWorkstreamId,
    getCachedContent,
    handleOpenHub,
    handleOpenWorkstream,
    internalNodeOverrides,
    loadingContentIds,
    neighborOpacity,
    onNewWorkstream,
    panelOpener,
    positions,
    primaryWorkstreamId,
    userAvatar,
    userName,
    viewMode,
    visibleWorkstreamIds,
    visibleWorkstreams,
    workstreams,
    timerState,
    startTimer,
    pauseTimer,
    resetTimer,
  ]);

  const edges = useMemo(() => {
    const baseEdges = buildEdges(visibleWorkstreams, positions, showConnections, primaryWorkstreamId);

    if (viewMode !== "graph" || !primaryWorkstreamId) {
      return baseEdges;
    }

    const graphEdges = visibleWorkstreamIds
      .filter((workstreamId) => workstreamId !== "__hub__")
      .flatMap((workstreamId) => {
        const focusWorkstream = workstreams.find((workstream) => workstream._id === workstreamId);
        const workstreamPos = positions.get(workstreamId) ?? { x: 0, y: 0 };
        const basePos = { x: workstreamPos.x - 40, y: workstreamPos.y + 120 };
        const cached = getCachedContent(workstreamId);
        const graphResult = buildGraphNodes({
          threads: cached.threads,
          notes: cached.notes,
          plannerItems: cached.plannerItems,
          artifacts: cached.artifacts,
          loading: loadingContentIds.includes(workstreamId) && !contentCacheRef.current.has(workstreamId),
          workstreamEmoji: focusWorkstream?.emoji,
          workstreamTitle: focusWorkstream?.title,
          onOpenPanel: panelOpener,
        }, basePos);
        return namespaceFlowEdges(`internal:${workstreamId}`, graphResult.edges);
      });

    return [...baseEdges, ...graphEdges];
  }, [band, getCachedContent, loadingContentIds, panelOpener, positions, primaryWorkstreamId, showConnections, viewMode, visibleWorkstreamIds, visibleWorkstreams, workstreams]);

  const handleInit = useCallback((instance: ReactFlowInstance) => {
    reactFlowRef.current = instance;
    if (initializedRef.current) return;
    initializedRef.current = true;
    // If a workstream is already committed (URL param), don't fitView
    if (primaryWorkstreamId) {
      const saved = restoreViewport();
      instance.setViewport(saved, { duration: 0 });
      setCamera({ x: saved.x, y: saved.y, z: saved.zoom });
      setZoom(saved.zoom);
    } else {
      // FitView to center all workstreams on load
      setTimeout(() => {
        instance.fitView({ padding: 0.15, duration: 400 });
        const vp = instance.getViewport();
        setCamera({ x: vp.x, y: vp.y, z: vp.zoom });
        setZoom(vp.zoom);
      }, 50);
    }
  }, [primaryWorkstreamId, setCamera]);

  const handleMove = useCallback((_: unknown, viewport: Viewport) => {
    setZoom(viewport.zoom);
    lastViewportRef.current = { x: viewport.x, y: viewport.y, zoom: viewport.zoom };
    // No auto-commit on zoom/pan — commitment only via explicit click
  }, []);

  const handleMoveEnd = useCallback(
    (_: unknown, viewport: Viewport) => {
      setZoom(viewport.zoom);
      setCamera({ x: viewport.x, y: viewport.y, z: viewport.zoom });
      lastViewportRef.current = { x: viewport.x, y: viewport.y, zoom: viewport.zoom };
      // No auto-commit on zoom/pan — commitment only via explicit click
      try {
        window.localStorage.setItem("workspace:viewport", JSON.stringify(viewport));
      } catch {
        // Ignore
      }
    },
    [setCamera],
  );

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
        return;
      }

      internalNodeOverridesRef.current.set(node.id, { x, y });
      setInternalNodeOverrides((current) => {
        const next = new Map(current);
        next.set(node.id, { x, y });
        return next;
      });
    },
    [],
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

  // Escape key handler
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && primaryWorkstreamId) {
        handleExitWorkstream();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleExitWorkstream, primaryWorkstreamId]);

  // Center home event listener
  useEffect(() => {
    const handler = () => {
      const instance = reactFlowRef.current;
      if (!instance) return;
      if (primaryWorkstreamId) {
        handleExitWorkstream();
      } else {
        instance.fitView({ padding: 0.15, duration: 500 });
      }
    };
    window.addEventListener("workspace:center-home", handler);
    return () => window.removeEventListener("workspace:center-home", handler);
  }, [handleExitWorkstream, primaryWorkstreamId]);

  // Center on focused workstream from URL (just center, don't enter)
  useEffect(() => {
    const instance = reactFlowRef.current;
    if (!instance || !focusWorkstreamId) return;
    const target = instance.getNode(`ws-${focusWorkstreamId}`);
    if (!target) return;
    instance.setCenter(
      target.position.x + 260,
      target.position.y + 120,
      { zoom: 0.6, duration: 600 },
    );
  }, [focusWorkstreamId]);

  useEffect(() => {
    const handler = () => setContextMenu(null);
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, []);

  const committedWorkstream = primaryWorkstreamId
    ? workstreams.find((ws) => ws._id === primaryWorkstreamId)
    : undefined;

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
        setContextMenu({ x: event.clientX - bounds.left, y: event.clientY - bounds.top });
      }}
    >
      {/* Subtle ambient gradient */}
      <div
        className="pointer-events-none absolute inset-0 opacity-60"
        style={{
          background:
            "radial-gradient(ellipse 50% 40% at 15% 10%, rgba(14, 142, 232, 0.06), transparent), radial-gradient(ellipse 40% 30% at 85% 15%, rgba(32, 184, 178, 0.05), transparent)",
        }}
      />

      {/* Breadcrumb — only when committed to a workstream */}
      <AnimatePresence>
        {committedWorkstream && (
          <WorkspaceBreadcrumb
            workstream={committedWorkstream}
            onBack={handleExitWorkstream}
          />
        )}
      </AnimatePresence>

      <ReactFlow
        nodes={nodes}
        edges={edges}
        fitView={false}
        minZoom={0.08}
        maxZoom={2.5}
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
        zoomOnScroll
        zoomOnDoubleClick={false}
        proOptions={{ hideAttribution: true }}
        className={cn("workspace-react-flow", getAmbientClass())}
      >
        <FlowBackground mode={backgroundMode} zoom={zoom} />
        <Controls position="bottom-left" showInteractive={false}>
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
                reactFlowRef.current?.fitView({ padding: 0.15, duration: 500 });
              }
            }}
            title="Fit all workstreams"
          >
            <Crosshair className="h-4 w-4" />
          </ControlButton>
        </Controls>
      </ReactFlow>

      {contextMenu && (
        <div
          className="absolute z-40 min-w-[220px] overflow-hidden rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)]/96 p-1.5 shadow-[0_18px_48px_-18px_rgba(15,23,42,0.38)] backdrop-blur-xl"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          {/* Always: Create actions */}
          <ContextMenuItem
            icon={<Layers className="h-3.5 w-3.5" />}
            label="New workstream"
            hint="W"
            onClick={() => { setContextMenu(null); onNewWorkstream?.(); }}
          />
          <ContextMenuItem
            icon={<FileText className="h-3.5 w-3.5" />}
            label="New document"
            hint="D"
            onClick={() => { setContextMenu(null); onCreateArtifact ? onCreateArtifact() : panelOpener("artifact", "new"); }}
          />

          {/* In workstream: scoped actions */}
          {primaryWorkstreamId && primaryWorkstreamId !== "__hub__" && (
            <>
              <ContextMenuItem
                icon={<MessageSquare className="h-3.5 w-3.5" />}
                label="New thread"
                hint="T"
                onClick={() => { setContextMenu(null); panelOpener("chat", "new"); }}
              />
              <ContextMenuItem
                icon={<Plus className="h-3.5 w-3.5" />}
                label="New planner item"
                hint="P"
                onClick={() => { setContextMenu(null); panelOpener("planner", "new"); }}
              />
            </>
          )}

          {/* Not in workstream: navigation */}
          {!primaryWorkstreamId && (
            <>
              <div className="my-1 h-px bg-[var(--border-default)]/50" />
              <ContextMenuItem
                icon={<Home className="h-3.5 w-3.5" />}
                label="Open hub"
                onClick={() => { setContextMenu(null); handleOpenHub(); }}
              />
            </>
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
