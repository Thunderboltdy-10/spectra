"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  ControlButton,
  Controls,
  Handle,
  MarkerType,
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
import { ChevronLeft, Crosshair, ZoomIn } from "lucide-react";
import { useWorkspaceStore, type WorkspaceBackgroundMode, type ZoomBand } from "@/stores/workspace-store";
import type { Workstream } from "@/hooks/use-workspace-data";
import { cn } from "@/lib/utils";
import { getWorkstreamColor } from "@/lib/workspace/zoom-helpers";
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

/* ─── Types ──────────────────────────────────────────────── */

type WorkspaceCanvasProps = {
  workstreams: Workstream[];
  userName: string;
  userAvatar: string;
  onWorkstreamUpdate?: (workstreamId: string, data: Partial<Workstream>) => void;
  focusWorkstreamId?: string;
  searchQuery?: string;
  onOpenWorkstream?: (workstreamId: string) => void;
  onOpenHub?: () => void;
  /** Called when zoom-based commit happens */
  onCommitWorkstream?: (workstreamId: string | null) => void;
  /** Canvas width adjustment when push-panel is open */
  panelWidth?: number;
};

type WorkstreamNodeData = {
  workstream: Workstream;
  band: ZoomBand;
  isFocused: boolean;
  isDimmed: boolean;
  isCommitted: boolean;
  lifecycle: { opacity: number; scale: number; dashed: boolean };
  onOpen: (workstreamId: string, target: HTMLElement) => void;
};

type HubNodeData = {
  userName: string;
  userAvatar: string;
  totalWorkstreams: number;
  band: ZoomBand;
  isDimmed: boolean;
  onOpen: (target: HTMLElement) => void;
};

const HUB_NODE_ID = "hub-node";

/* ─── Zoom helpers ───────────────────────────────────────── */

function getRepresentationBand(zoom: number): ZoomBand {
  if (zoom < 0.5) return "overview";
  if (zoom < 0.7) return "summary";
  if (zoom < 0.9) return "detail";
  return "internal";
}

/** Calculate opacity for non-focused workstreams during deep zoom */
function getNeighborOpacity(zoom: number): number {
  if (zoom < 0.7) return 1;
  if (zoom > 1.2) return 0;
  // Linear fade from 1.0 → 0 between zoom 0.7 and 1.2
  return Math.max(0, 1 - (zoom - 0.7) / 0.5);
}

function restoreViewport(): Viewport {
  if (typeof window === "undefined") {
    return { x: 0, y: 0, zoom: 0.78 };
  }
  try {
    const saved = window.localStorage.getItem("workspace:viewport");
    if (!saved) return { x: 0, y: 0, zoom: 0.78 };
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
  return { x: 0, y: 0, zoom: 0.78 };
}

/* ─── Edge builders ──────────────────────────────────────── */

function buildPeerLinks(workstreams: Workstream[]) {
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
      edges.push({
        id: `peer-${a._id}-${b._id}`,
        source: `ws-${a._id}`,
        target: `ws-${b._id}`,
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

function buildEdges(workstreams: Workstream[], showConnections: boolean, committedId?: string): Edge[] {
  if (!showConnections) return [];
  // Hide edges when inside a committed workstream
  if (committedId) return [];

  const hubEdges: Edge[] = workstreams.map((ws) => {
    const color = getWorkstreamColor(ws.color).value;
    const age = ws.lastActivityAt ? Date.now() - ws.lastActivityAt : Number.MAX_SAFE_INTEGER;
    const opacity = age < 2 * 86400000 ? 0.7 : age < 7 * 86400000 ? 0.45 : 0.22;

    return {
      id: `hub-${ws._id}`,
      source: HUB_NODE_ID,
      target: `ws-${ws._id}`,
      animated: false,
      selectable: false,
      deletable: false,
      style: {
        stroke: color,
        strokeWidth: ws.status === "completed" ? 0.8 : 1.2,
        strokeDasharray: ws.status === "completed" ? "4 6" : undefined,
        opacity: ws.status === "archived" ? 0.1 : opacity,
      },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color,
        width: 14,
        height: 14,
      },
    };
  });

  return [...hubEdges, ...buildPeerLinks(workstreams)];
}

/* ─── Workstream Node ────────────────────────────────────── */

const WorkstreamNode = memo(function WorkstreamNode({
  data,
}: NodeProps<Node<WorkstreamNodeData>>) {
  const { workstream, band, isFocused, isDimmed, isCommitted, lifecycle, onOpen } = data;
  const color = getWorkstreamColor(workstream.color);
  const [hovered, setHovered] = useState(false);

  // Node width by band
  const width = band === "overview" ? 220 : band === "summary" ? 280 : band === "detail" ? 320 : 360;

  // When this node is committed (internal zoom), it expands and border dissolves
  if (isCommitted && band === "internal") {
    return null; // Internal view is rendered separately, not as a node
  }

  return (
    <div className="relative">
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !border-0 !bg-transparent" />
      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !border-0 !bg-transparent" />

      <motion.button
        type="button"
        onClick={(e) => onOpen(workstream._id, e.currentTarget)}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        animate={{
          opacity: isDimmed ? lifecycle.opacity * getNeighborOpacity(1) : lifecycle.opacity,
          scale: (hovered ? 1.02 : 1) * lifecycle.scale,
          y: hovered ? -2 : 0,
        }}
        transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
        className={cn(
          "group relative text-left transition-[box-shadow] duration-300",
          "rounded-2xl",
          isFocused && "ring-2 ring-[color:var(--accent-cyan)] ring-offset-2 ring-offset-[var(--bg-primary)]",
        )}
        style={{
          width,
          background: "var(--bg-elevated)",
          border: `1px solid ${hovered ? color.value + "60" : lifecycle.dashed ? "transparent" : "var(--border-default)"}`,
          borderStyle: lifecycle.dashed ? "dashed" : "solid",
          borderColor: lifecycle.dashed ? "var(--border-default)" : undefined,
          boxShadow: hovered
            ? `0 20px 50px -16px ${color.value}35, 0 8px 16px -8px rgba(0,0,0,0.08)`
            : "0 2px 8px -4px rgba(0,0,0,0.06)",
        }}
      >
        {/* Top accent bar */}
        <div
          className="absolute inset-x-0 top-0 h-[2px] rounded-t-[inherit]"
          style={{
            background: `linear-gradient(90deg, ${color.value}, ${color.value}40, transparent)`,
            opacity: band === "overview" ? 0.6 : 0.8,
          }}
        />

        <div className="relative flex flex-col px-4 py-3.5">
          {/* Top row: emoji + title + type */}
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <span className={cn("text-lg", band === "overview" && "text-base")}>
                {workstream.emoji || "📚"}
              </span>
              <div className="min-w-0">
                <h3
                  className={cn(
                    "font-display leading-snug text-[var(--text-primary)]",
                    band === "overview" && "text-sm",
                    band === "summary" && "text-[0.95rem]",
                    (band === "detail" || band === "internal") && "text-base",
                  )}
                >
                  {workstream.title}
                </h3>
              </div>
            </div>
            <span
              className="mt-0.5 shrink-0 rounded-md px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider"
              style={{ background: color.bg, color: color.value }}
            >
              {workstream.type}
            </span>
          </div>

          {/* Description (summary+) */}
          <AnimatePresence>
            {band !== "overview" && (
              <motion.p
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2 }}
                className="mt-2 line-clamp-2 text-xs leading-relaxed text-[var(--text-secondary)]"
              >
                {workstream.description || "A space for threads, notes, and tasks."}
              </motion.p>
            )}
          </AnimatePresence>

          {/* Metrics (summary+) */}
          <AnimatePresence>
            {band !== "overview" && (
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

          {/* Detail band: thread/note previews + enter affordance */}
          <AnimatePresence>
            {(band === "detail" || (band === "internal" && !isCommitted)) && (
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
                <motion.span
                  className="text-xs font-medium text-[var(--accent-cyan)]"
                  animate={{ x: hovered ? 3 : 0 }}
                  transition={{ duration: 0.15 }}
                >
                  Enter →
                </motion.span>
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

/* ─── Hub Node ───────────────────────────────────────────── */

const HubNode = memo(function HubNode({
  data,
}: NodeProps<Node<HubNodeData>>) {
  const [hovered, setHovered] = useState(false);
  const initials = (data.userName || "Y")
    .split(" ")
    .map((p: string) => p[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="relative">
      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !border-0 !bg-transparent" />

      <motion.button
        type="button"
        onClick={(e) => data.onOpen(e.currentTarget)}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        animate={{
          opacity: data.isDimmed ? 0.3 : 1,
          scale: hovered ? 1.03 : 1,
          y: hovered ? -3 : 0,
        }}
        transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
        className={cn(
          "group relative flex items-center justify-center overflow-hidden transition-[box-shadow] duration-300",
          data.band === "overview" && "h-[140px] w-[140px] rounded-[28px]",
          data.band === "summary" && "h-[180px] w-[180px] rounded-[32px]",
          (data.band === "detail" || data.band === "internal") && "h-[220px] w-[220px] rounded-[36px]",
        )}
        style={{
          background: "var(--bg-elevated)",
          border: `1px solid ${hovered ? "var(--accent-cyan)" : "var(--border-default)"}`,
          boxShadow: hovered
            ? "0 24px 60px -20px rgba(14, 142, 232, 0.3), 0 8px 16px -8px rgba(0,0,0,0.06)"
            : "0 2px 8px -4px rgba(0,0,0,0.06)",
        }}
      >
        <div className="pointer-events-none absolute inset-0 rounded-[inherit] opacity-30"
          style={{
            background: "radial-gradient(circle at 30% 25%, var(--accent-cyan), transparent 60%)",
          }}
        />
        <div className="relative flex flex-col items-center gap-2 px-4 text-center">
          {data.userAvatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={data.userAvatar}
              alt=""
              className={cn(
                "rounded-full object-cover ring-2 ring-[var(--accent-cyan)]/20",
                data.band === "overview" && "h-10 w-10",
                data.band === "summary" && "h-12 w-12",
                (data.band === "detail" || data.band === "internal") && "h-14 w-14",
              )}
            />
          ) : (
            <div
              className={cn(
                "flex items-center justify-center rounded-full bg-[linear-gradient(135deg,var(--accent-cyan),var(--accent-mint))] font-semibold text-white",
                data.band === "overview" && "h-10 w-10 text-sm",
                data.band === "summary" && "h-12 w-12 text-base",
                (data.band === "detail" || data.band === "internal") && "h-14 w-14 text-lg",
              )}
            >
              {initials}
            </div>
          )}
          <div>
            <div className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">
              Hub
            </div>
            <h3 className={cn(
              "font-display text-[var(--text-primary)]",
              data.band === "overview" && "text-xs",
              data.band !== "overview" && "text-sm",
            )}>
              {data.userName}
            </h3>
          </div>
          <AnimatePresence>
            {(data.band === "detail" || data.band === "internal") && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="flex items-center gap-3 text-[10px] text-[var(--text-tertiary)]"
              >
                <span>{data.totalWorkstreams} streams</span>
                <span className="h-3 w-px bg-[var(--border-default)]" />
                <span>Notes</span>
                <span className="h-3 w-px bg-[var(--border-default)]" />
                <span>Planner</span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.button>
    </div>
  );
});

/* ─── Background ─────────────────────────────────────────── */

function FlowBackground({ mode }: { mode: WorkspaceBackgroundMode }) {
  if (mode === "blank") return null;
  return (
    <Background
      gap={mode === "dots" ? 28 : 56}
      size={mode === "dots" ? 0.8 : 0.6}
      variant={mode === "dots" ? BackgroundVariant.Dots : BackgroundVariant.Lines}
      color="color-mix(in oklab, var(--border-default) 50%, transparent)"
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

/* ─── Canvas Inner ───────────────────────────────────────── */

function WorkspaceCanvasInner({
  workstreams,
  userName,
  userAvatar,
  onWorkstreamUpdate,
  focusWorkstreamId,
  searchQuery = "",
  onOpenWorkstream,
  onOpenHub,
  onCommitWorkstream,
  panelWidth = 0,
}: WorkspaceCanvasProps) {
  const reactFlowRef = useRef<ReactFlowInstance | null>(null);
  const initializedRef = useRef(false);
  const commitDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastViewportRef = useRef<{ x: number; y: number; zoom: number }>({ x: 0, y: 0, zoom: 0.78 });
  const {
    showArchived,
    showConnections,
    backgroundMode,
    committedWorkstreamId,
    setCamera,
    setZoomBand,
    commitWorkstream,
    exitWorkstream,
    focusHub,
    setPreviousViewport,
  } = useWorkspaceStore();
  const [zoom, setZoom] = useState(restoreViewport().zoom);
  const [localOverrides] = useState(() => loadLocalOverrides());

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

  const band = getRepresentationBand(zoom);
  const neighborOpacity = getNeighborOpacity(zoom);

  // Compute positions using auto-layout + overrides
  const positions = useMemo(() => {
    const canonical = computeCanonicalLayout(workstreams);
    return applyOverrides(canonical, workstreams, localOverrides);
  }, [workstreams, localOverrides]);

  // Update zoom band in store
  useEffect(() => {
    setZoomBand(band);
  }, [band, setZoomBand]);

  const handleOpenWorkstream = useCallback(
    (workstreamId: string) => {
      // Animated zoom into the workstream
      const instance = reactFlowRef.current;
      if (instance) {
        // Save current viewport for zoom-out restoration
        setPreviousViewport({ ...lastViewportRef.current });

        // Get node position and zoom to it
        const node = instance.getNode(`ws-${workstreamId}`);
        if (node) {
          instance.setCenter(
            node.position.x + 150,
            node.position.y + 100,
            { zoom: 1.1, duration: 500 },
          );
        }
      }

      // Commit after animation
      setTimeout(() => {
        commitWorkstream(workstreamId);
        onOpenWorkstream?.(workstreamId);
      }, 500);
    },
    [commitWorkstream, onOpenWorkstream, setPreviousViewport],
  );

  const handleExitWorkstream = useCallback(() => {
    const { previousViewport } = useWorkspaceStore.getState();
    exitWorkstream();
    onCommitWorkstream?.(null);

    // Restore previous viewport
    const instance = reactFlowRef.current;
    if (instance && previousViewport) {
      instance.setViewport(previousViewport, { duration: 400 });
    } else if (instance) {
      instance.setCenter(0, 0, { zoom: 0.78, duration: 400 });
    }
  }, [exitWorkstream, onCommitWorkstream]);

  const handleOpenHub = useCallback(
    (target: HTMLElement) => {
      const cardRect = target.getBoundingClientRect();
      const root = target.closest("[data-workspace-flow-root]");
      const rootRect = root?.getBoundingClientRect() ?? cardRect;
      focusHub({
        x: cardRect.left - rootRect.left,
        y: cardRect.top - rootRect.top,
        w: cardRect.width,
        h: cardRect.height,
      });
      onOpenHub?.();
    },
    [focusHub, onOpenHub],
  );

  // Debounced zoom-based commit
  const handleZoomCommit = useCallback(
    (currentZoom: number) => {
      if (commitDebounceRef.current) {
        clearTimeout(commitDebounceRef.current);
      }

      commitDebounceRef.current = setTimeout(() => {
        const currentBand = getRepresentationBand(currentZoom);

        if (currentBand === "internal" && !committedWorkstreamId) {
          // Find the nearest workstream to viewport center
          const vp = lastViewportRef.current;
          const centerX = (-vp.x + window.innerWidth / 2) / vp.zoom;
          const centerY = (-vp.y + window.innerHeight / 2) / vp.zoom;

          let nearestId: string | null = null;
          let nearestDist = Infinity;

          for (const ws of visibleWorkstreams) {
            const pos = positions.get(ws._id);
            if (!pos) continue;
            const dx = pos.x - centerX;
            const dy = pos.y - centerY;
            const dist = dx * dx + dy * dy;
            if (dist < nearestDist) {
              nearestDist = dist;
              nearestId = ws._id;
            }
          }

          if (nearestId) {
            commitWorkstream(nearestId);
            onCommitWorkstream?.(nearestId);
          }
        }
      }, 200); // 200ms debounce as per plan
    },
    [committedWorkstreamId, commitWorkstream, onCommitWorkstream, positions, visibleWorkstreams],
  );

  const nodes = useMemo<Node[]>(() => {
    const hubNode: Node<HubNodeData> = {
      id: HUB_NODE_ID,
      type: "hub",
      position: { x: -110, y: -110 },
      draggable: false,
      selectable: false,
      hidden: !!committedWorkstreamId,
      data: {
        userName,
        userAvatar,
        totalWorkstreams: workstreams.filter((ws) => ws.status === "active").length,
        band,
        isDimmed: !!committedWorkstreamId,
        onOpen: handleOpenHub,
      },
    };

    const workstreamNodes: Node<WorkstreamNodeData>[] = visibleWorkstreams.map((ws) => {
      const pos = positions.get(ws._id) ?? { x: 0, y: 0 };
      const isCommitted = committedWorkstreamId === ws._id;
      const isDimmed = !!committedWorkstreamId && !isCommitted;
      const lifecycle = getLifecycleVisuals(ws);

      return {
        id: `ws-${ws._id}`,
        type: "workstream",
        position: pos,
        draggable: !committedWorkstreamId,
        selectable: false,
        hidden: isDimmed && neighborOpacity <= 0,
        data: {
          workstream: ws,
          band,
          isFocused: focusWorkstreamId === ws._id,
          isDimmed,
          isCommitted,
          lifecycle,
          onOpen: handleOpenWorkstream,
        },
      };
    });

    return [hubNode, ...workstreamNodes];
  }, [band, committedWorkstreamId, focusWorkstreamId, handleOpenHub, handleOpenWorkstream, neighborOpacity, positions, userAvatar, userName, visibleWorkstreams, workstreams]);

  const edges = useMemo(
    () => buildEdges(visibleWorkstreams, showConnections, committedWorkstreamId),
    [showConnections, visibleWorkstreams, committedWorkstreamId],
  );

  const handleInit = useCallback((instance: ReactFlowInstance) => {
    reactFlowRef.current = instance;
    if (initializedRef.current) return;
    initializedRef.current = true;
    const saved = restoreViewport();
    instance.setViewport(saved, { duration: 0 });
    setCamera({ x: saved.x, y: saved.y, z: saved.zoom });
    setZoom(saved.zoom);
  }, [setCamera]);

  const handleMoveEnd = useCallback(
    (_: unknown, viewport: Viewport) => {
      setZoom(viewport.zoom);
      setCamera({ x: viewport.x, y: viewport.y, z: viewport.zoom });
      lastViewportRef.current = { x: viewport.x, y: viewport.y, zoom: viewport.zoom };
      handleZoomCommit(viewport.zoom);
      try {
        window.localStorage.setItem("workspace:viewport", JSON.stringify(viewport));
      } catch {
        // Ignore
      }
    },
    [setCamera, handleZoomCommit],
  );

  const handleNodeDragStop = useCallback(
    (_: unknown, node: Node) => {
      if (!node.id.startsWith("ws-")) return;
      const workstreamId = node.id.slice(3);
      const x = Math.round(node.position.x);
      const y = Math.round(node.position.y);

      // Save to localStorage immediately
      saveLocalOverride(workstreamId, x, y);

      // Also save to Convex
      void onWorkstreamUpdate?.(workstreamId, { canvasX: x, canvasY: y });
    },
    [onWorkstreamUpdate],
  );

  // Escape key handler
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && committedWorkstreamId) {
        handleExitWorkstream();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [committedWorkstreamId, handleExitWorkstream]);

  // Center hub event listener
  useEffect(() => {
    const handler = () => {
      const instance = reactFlowRef.current;
      if (!instance) return;
      if (committedWorkstreamId) {
        handleExitWorkstream();
      }
      instance.setCenter(0, 0, { zoom: 0.78, duration: 500 });
    };
    window.addEventListener("workspace:center-hub", handler);
    return () => window.removeEventListener("workspace:center-hub", handler);
  }, [committedWorkstreamId, handleExitWorkstream]);

  // Center on focused workstream from URL
  useEffect(() => {
    const instance = reactFlowRef.current;
    if (!instance || !focusWorkstreamId) return;
    const target = instance.getNode(`ws-${focusWorkstreamId}`);
    if (!target) return;
    instance.setCenter(
      target.position.x + 150,
      target.position.y + 100,
      { zoom: 1.1, duration: 600 },
    );
  }, [focusWorkstreamId]);

  const committedWorkstream = committedWorkstreamId
    ? workstreams.find((ws) => ws._id === committedWorkstreamId)
    : undefined;

  return (
    <div
      className="relative h-full w-full overflow-hidden bg-[var(--bg-primary)]"
      data-workspace-flow-root
      style={{
        // Adjust canvas width when push-panel is open
        width: panelWidth > 0 ? `calc(100% - ${panelWidth}px)` : "100%",
        transition: "width 300ms ease-out",
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

      {/* Breadcrumb — only when committed */}
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
        minZoom={0.28}
        maxZoom={2}
        defaultViewport={restoreViewport()}
        nodeTypes={{
          workstream: WorkstreamNode,
          hub: HubNode,
        }}
        onInit={handleInit}
        onMoveEnd={handleMoveEnd}
        onNodeDragStop={handleNodeDragStop}
        nodesConnectable={false}
        nodesDraggable={!committedWorkstreamId}
        elementsSelectable={false}
        selectionOnDrag={false}
        panOnDrag
        panOnScroll={false}
        zoomOnScroll
        zoomOnDoubleClick={false}
        proOptions={{ hideAttribution: true }}
        className="workspace-react-flow"
      >
        <FlowBackground mode={backgroundMode} />
        <Controls position="bottom-left" showInteractive={false}>
          <ControlButton
            onClick={() => reactFlowRef.current?.zoomTo(1.12, { duration: 350 })}
            title="Focus detail band"
          >
            <ZoomIn className="h-4 w-4" />
          </ControlButton>
          <ControlButton
            onClick={() => {
              if (committedWorkstreamId) {
                handleExitWorkstream();
              }
              reactFlowRef.current?.setCenter(0, 0, { zoom: 0.78, duration: 500 });
            }}
            title="Return to hub"
          >
            <Crosshair className="h-4 w-4" />
          </ControlButton>
        </Controls>
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
