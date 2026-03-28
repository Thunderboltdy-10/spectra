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
import { Crosshair, ZoomIn } from "lucide-react";
import { useWorkspaceStore, type WorkspaceBackgroundMode } from "@/stores/workspace-store";
import type { Workstream } from "@/hooks/use-workspace-data";
import { cn } from "@/lib/utils";
import { getWorkstreamColor } from "@/lib/workspace/zoom-helpers";

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
};

type RepresentationBand = "overview" | "summary" | "detail";

type WorkstreamNodeData = {
  workstream: Workstream;
  band: RepresentationBand;
  isFocused: boolean;
  isDimmed: boolean;
  onOpen: (workstreamId: string, target: HTMLElement) => void;
};

type HubNodeData = {
  userName: string;
  userAvatar: string;
  totalWorkstreams: number;
  band: RepresentationBand;
  onOpen: (target: HTMLElement) => void;
};

const HUB_NODE_ID = "hub-node";

/* ─── Zoom helpers ───────────────────────────────────────── */

function getRepresentationBand(zoom: number): RepresentationBand {
  if (zoom < 0.62) return "overview";
  if (zoom < 1.05) return "summary";
  return "detail";
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
    // Ignore invalid persisted viewport data.
  }

  return { x: 0, y: 0, zoom: 0.78 };
}

/* ─── Edge builders ──────────────────────────────────────── */

function buildPeerLinks(workstreams: Workstream[]) {
  const active = workstreams.filter((workstream) => workstream.status === "active");
  const edges: Edge[] = [];

  const tokenize = (value: string) =>
    value
      .toLowerCase()
      .split(/[^a-z0-9]+/i)
      .filter((token) => token.length >= 4);

  const sharedTokenCount = (left: Workstream, right: Workstream) => {
    const leftTokens = new Set([
      ...tokenize(left.title),
      ...tokenize(left.description ?? ""),
      ...(left.subjectCode ? tokenize(left.subjectCode) : []),
    ]);
    const rightTokens = new Set([
      ...tokenize(right.title),
      ...tokenize(right.description ?? ""),
      ...(right.subjectCode ? tokenize(right.subjectCode) : []),
    ]);

    let count = 0;
    for (const token of leftTokens) {
      if (rightTokens.has(token)) count += 1;
    }
    return count;
  };

  for (let index = 0; index < active.length; index += 1) {
    for (let peerIndex = index + 1; peerIndex < active.length; peerIndex += 1) {
      const left = active[index]!;
      const right = active[peerIndex]!;
      const related =
        left.type === right.type
        || (left.subjectCode && right.subjectCode && left.subjectCode === right.subjectCode)
        || sharedTokenCount(left, right) > 0;

      if (!related) continue;

      edges.push({
        id: `peer-${left._id}-${right._id}`,
        source: `ws-${left._id}`,
        target: `ws-${right._id}`,
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

function buildEdges(workstreams: Workstream[], showConnections: boolean): Edge[] {
  if (!showConnections) return [];

  const hubEdges: Edge[] = workstreams.map((workstream) => {
    const color = getWorkstreamColor(workstream.color).value;
    const lastActivityAge = workstream.lastActivityAt ? Date.now() - workstream.lastActivityAt : Number.MAX_SAFE_INTEGER;
    const recentOpacity =
      lastActivityAge < 2 * 24 * 60 * 60 * 1000
        ? 0.7
        : lastActivityAge < 7 * 24 * 60 * 60 * 1000
          ? 0.45
          : 0.22;

    return {
      id: `hub-${workstream._id}`,
      source: HUB_NODE_ID,
      target: `ws-${workstream._id}`,
      animated: false,
      selectable: false,
      deletable: false,
      style: {
        stroke: color,
        strokeWidth: workstream.status === "completed" ? 0.8 : 1.2,
        strokeDasharray: workstream.status === "completed" ? "4 6" : undefined,
        opacity: workstream.status === "archived" ? 0.1 : recentOpacity,
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

/* ─── Helper: relative bounds for morph ──────────────────── */

function relativeBounds(target: HTMLElement) {
  const cardRect = target.getBoundingClientRect();
  const root = target.closest("[data-workspace-flow-root]");
  const rootRect = root?.getBoundingClientRect() ?? cardRect;

  return {
    x: cardRect.left - rootRect.left,
    y: cardRect.top - rootRect.top,
    w: cardRect.width,
    h: cardRect.height,
  };
}

/* ─── Workstream Node ────────────────────────────────────── */

const WorkstreamNode = memo(function WorkstreamNode({
  data,
}: NodeProps<Node<WorkstreamNodeData>>) {
  const { workstream, band, isFocused, isDimmed, onOpen } = data;
  const color = getWorkstreamColor(workstream.color);
  const [hovered, setHovered] = useState(false);

  return (
    <div className="relative">
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !border-0 !bg-transparent" />
      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !border-0 !bg-transparent" />

      <motion.button
        type="button"
        onClick={(event) => onOpen(workstream._id, event.currentTarget)}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{
          opacity: isDimmed ? 0.3 : 1,
          scale: hovered ? 1.02 : 1,
          y: hovered ? -2 : 0,
        }}
        transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
        className={cn(
          "group relative text-left transition-[box-shadow] duration-300",
          band === "overview" && "w-[260px] rounded-2xl",
          band === "summary" && "w-[300px] rounded-[22px]",
          band === "detail" && "w-[320px] rounded-[24px]",
          isFocused && "ring-2 ring-[color:var(--accent-cyan)] ring-offset-2 ring-offset-[var(--bg-primary)]",
        )}
        style={{
          background: "var(--bg-elevated)",
          border: `1px solid ${hovered ? color.value + "60" : "var(--border-default)"}`,
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
          {/* Top row: emoji + type + status */}
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
                    band === "detail" && "text-base",
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

          {/* Description (summary + detail) */}
          <AnimatePresence>
            {band !== "overview" && (
              <motion.p
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2 }}
                className="mt-2 line-clamp-2 text-xs leading-relaxed text-[var(--text-secondary)]"
              >
                {workstream.description || "A space for threads, notes, and the next concrete step."}
              </motion.p>
            )}
          </AnimatePresence>

          {/* Metrics (summary + detail) */}
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

          {/* Detail band: enter affordance */}
          <AnimatePresence>
            {band === "detail" && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2, delay: 0.1 }}
                className="mt-3 flex items-center justify-between border-t border-[var(--border-default)] pt-3"
              >
                <span className="text-[10px] text-[var(--text-tertiary)]">
                  Click to focus
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
    .map((part: string) => part[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="relative">
      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !border-0 !bg-transparent" />

      <motion.button
        type="button"
        onClick={(event) => data.onOpen(event.currentTarget)}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        initial={{ opacity: 0, scale: 0.85 }}
        animate={{
          opacity: 1,
          scale: hovered ? 1.03 : 1,
          y: hovered ? -3 : 0,
        }}
        transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
        className={cn(
          "group relative flex items-center justify-center overflow-hidden transition-[box-shadow] duration-300",
          data.band === "overview" && "h-[140px] w-[140px] rounded-[28px]",
          data.band === "summary" && "h-[180px] w-[180px] rounded-[32px]",
          data.band === "detail" && "h-[220px] w-[220px] rounded-[36px]",
        )}
        style={{
          background: "var(--bg-elevated)",
          border: `1px solid ${hovered ? "var(--accent-cyan)" : "var(--border-default)"}`,
          boxShadow: hovered
            ? "0 24px 60px -20px rgba(14, 142, 232, 0.3), 0 8px 16px -8px rgba(0,0,0,0.06)"
            : "0 2px 8px -4px rgba(0,0,0,0.06)",
        }}
      >
        {/* Subtle gradient ring */}
        <div
          className="pointer-events-none absolute inset-0 rounded-[inherit] opacity-30"
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
                data.band === "detail" && "h-14 w-14",
              )}
            />
          ) : (
            <div
              className={cn(
                "flex items-center justify-center rounded-full bg-[linear-gradient(135deg,var(--accent-cyan),var(--accent-mint))] font-semibold text-white",
                data.band === "overview" && "h-10 w-10 text-sm",
                data.band === "summary" && "h-12 w-12 text-base",
                data.band === "detail" && "h-14 w-14 text-lg",
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
            {data.band === "detail" && (
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
}: WorkspaceCanvasProps) {
  const reactFlowRef = useRef<ReactFlowInstance<Node, Edge> | null>(null);
  const initializedRef = useRef(false);
  const {
    showArchived,
    showConnections,
    backgroundMode,
    setCamera,
    focusWorkstream,
    focusHub,
  } = useWorkspaceStore();
  const [zoom, setZoom] = useState(restoreViewport().zoom);

  const visibleWorkstreams = useMemo(() => {
    const trimmed = searchQuery.trim().toLowerCase();
    return (showArchived
      ? workstreams
      : workstreams.filter((workstream) => workstream.status !== "archived"))
      .filter((workstream) => {
        if (!trimmed) return true;
        return [
          workstream.title,
          workstream.description ?? "",
          workstream.subjectCode ?? "",
        ].some((value) => value.toLowerCase().includes(trimmed));
      });
  }, [searchQuery, showArchived, workstreams]);

  const band = getRepresentationBand(zoom);

  const handleOpenWorkstream = useCallback(
    (workstreamId: string, target: HTMLElement) => {
      focusWorkstream(workstreamId, relativeBounds(target));
      onOpenWorkstream?.(workstreamId);
    },
    [focusWorkstream, onOpenWorkstream],
  );

  const handleOpenHub = useCallback(
    (target: HTMLElement) => {
      focusHub(relativeBounds(target));
      onOpenHub?.();
    },
    [focusHub, onOpenHub],
  );

  const nodes = useMemo<Node[]>(() => {
    const hubNode: Node<HubNodeData> = {
      id: HUB_NODE_ID,
      type: "hub",
      position: { x: -80, y: -80 },
      draggable: false,
      selectable: false,
      data: {
        userName,
        userAvatar,
        totalWorkstreams: workstreams.filter((workstream) => workstream.status === "active").length,
        band,
        onOpen: handleOpenHub,
      },
    };

    const workstreamNodes: Node<WorkstreamNodeData>[] = visibleWorkstreams.map((workstream, index) => {
      const defaultAngle = (Math.PI * 2 * index) / Math.max(visibleWorkstreams.length, 1);
      const radius = 420 + (index % 3) * 60;
      const position = {
        x: workstream.canvasX ?? Math.cos(defaultAngle - Math.PI / 2) * radius,
        y: workstream.canvasY ?? Math.sin(defaultAngle - Math.PI / 2) * radius,
      };

      return {
        id: `ws-${workstream._id}`,
        type: "workstream",
        position,
        draggable: true,
        selectable: false,
        data: {
          workstream,
          band,
          isFocused: focusWorkstreamId === workstream._id,
          isDimmed: Boolean(focusWorkstreamId) && focusWorkstreamId !== workstream._id,
          onOpen: handleOpenWorkstream,
        },
      };
    });

    return [hubNode, ...workstreamNodes];
  }, [band, focusWorkstreamId, handleOpenHub, handleOpenWorkstream, userAvatar, userName, visibleWorkstreams, workstreams]);

  const edges = useMemo(
    () => buildEdges(visibleWorkstreams, showConnections),
    [showConnections, visibleWorkstreams],
  );

  const handleInit = useCallback((instance: ReactFlowInstance<Node, Edge>) => {
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
      try {
        window.localStorage.setItem("workspace:viewport", JSON.stringify(viewport));
      } catch {
        // Ignore storage failures.
      }
    },
    [setCamera],
  );

  const handleNodeDragStop = useCallback(
    (_: unknown, node: Node) => {
      if (!node.id.startsWith("ws-")) return;
      const workstreamId = node.id.slice(3);
      void onWorkstreamUpdate?.(workstreamId, {
        canvasX: Math.round(node.position.x),
        canvasY: Math.round(node.position.y),
      });
    },
    [onWorkstreamUpdate],
  );

  // Center on focused workstream
  useEffect(() => {
    const instance = reactFlowRef.current;
    if (!instance) return;

    const targetId = focusWorkstreamId ? `ws-${focusWorkstreamId}` : HUB_NODE_ID;
    const target = instance.getNode(targetId);
    if (!target) return;

    const zoomLevel = focusWorkstreamId ? 1.1 : 0.82;
    const centerX = target.position.x + (focusWorkstreamId ? 150 : 80);
    const centerY = target.position.y + (focusWorkstreamId ? 100 : 80);
    instance.setCenter(centerX, centerY, { zoom: zoomLevel, duration: 600 });
  }, [focusWorkstreamId]);

  // Center hub event listener
  useEffect(() => {
    const handler = () => {
      const instance = reactFlowRef.current;
      if (!instance) return;
      // Center on hub node position (which is at -80, -80, so center at 0,0)
      instance.setCenter(0, 0, { zoom: 0.82, duration: 600 });
    };

    window.addEventListener("workspace:center-hub", handler);
    return () => window.removeEventListener("workspace:center-hub", handler);
  }, []);

  return (
    <div
      className="relative h-full w-full overflow-hidden bg-[var(--bg-primary)]"
      data-workspace-flow-root
    >
      {/* Ambient gradient overlay */}
      <div
        className="pointer-events-none absolute inset-0 opacity-60"
        style={{
          background:
            "radial-gradient(ellipse 50% 40% at 15% 10%, rgba(14, 142, 232, 0.06), transparent), radial-gradient(ellipse 40% 30% at 85% 15%, rgba(32, 184, 178, 0.05), transparent)",
        }}
      />

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
        nodesDraggable
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
          <ControlButton onClick={() => reactFlowRef.current?.zoomTo(1.12, { duration: 350 })} title="Focus detail band">
            <ZoomIn className="h-4 w-4" />
          </ControlButton>
          <ControlButton onClick={() => reactFlowRef.current?.setCenter(0, 0, { zoom: 0.82, duration: 500 })} title="Return to hub">
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
