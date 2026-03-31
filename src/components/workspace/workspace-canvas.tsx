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

type HubNodeData = {
  userName: string;
  userAvatar: string;
  totalWorkstreams: number;
  band: ZoomBand;
  isDimmed: boolean;
  isCommitted: boolean;
  onOpen: () => void;
};

const HUB_NODE_ID = "hub-node";

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
  if (zoom < 0.45) return "overview";
  if (zoom < 0.9) return "summary";
  if (zoom < 1.7) return "detail";
  return "internal";
}

/** Calculate opacity for non-focused workstreams during deep zoom */
function getNeighborOpacity(zoom: number): number {
  if (zoom <= 1.3) return 1;
  if (zoom >= 1.7) return 0;
  return Math.max(0, 1 - (zoom - 1.3) / 0.4);
}

function distanceFromHub(x: number, y: number) {
  return Math.sqrt(x * x + y * y);
}

function restoreViewport(): Viewport {
  if (typeof window === "undefined") {
    return { x: 0, y: 0, zoom: 0.9 };
  }
  try {
    const saved = window.localStorage.getItem("workspace:viewport");
    if (!saved) return { x: 0, y: 0, zoom: 0.9 };
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
  return { x: 0, y: 0, zoom: 0.9 };
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
        { x: sourcePos.x + 160, y: sourcePos.y + 110 },
        { x: targetPos.x + 160, y: targetPos.y + 110 },
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

  const hubEdges: Edge[] = workstreams.map((ws) => {
    const color = getWorkstreamColor(ws.color).value;
    const age = ws.lastActivityAt ? Date.now() - ws.lastActivityAt : Number.MAX_SAFE_INTEGER;
    const opacity = age < 2 * 86400000 ? 0.7 : age < 7 * 86400000 ? 0.45 : 0.22;
    const targetPos = positions.get(ws._id) ?? { x: 0, y: 0 };
    const { sourceHandle, targetHandle } = pickDirectionalHandles(
      { x: 0, y: 0 },
      { x: targetPos.x + 160, y: targetPos.y + 110 },
    );

    return {
      id: `hub-${ws._id}`,
      source: HUB_NODE_ID,
      target: `ws-${ws._id}`,
      sourceHandle,
      targetHandle,
      type: "smoothstep",
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

  return [...hubEdges, ...buildPeerLinks(workstreams, positions)];
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

function sameIds(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
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

  // Node width by band
  const width = band === "overview" ? 250 : band === "summary" ? 320 : band === "detail" ? 390 : 440;

  // When committed: dissolve border (opacity + blur), don't hide entirely
  // so internal canvas-native nodes can coexist
  const dissolving = isCommitted && band === "internal";

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
        {/* Ambient color stripe at top of card */}
        <div
          className="absolute inset-x-0 top-0 h-[2px] rounded-t-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-300"
          style={{ background: `linear-gradient(90deg, ${color.value}60, ${color.value}20)` }}
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

/* ─── Hub Node ───────────────────────────────────────────── */

const HubNode = memo(function HubNode({
  data,
}: NodeProps<Node<HubNodeData>>) {
  const initials = (data.userName || "Y")
    .split(" ")
    .map((p: string) => p[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="relative">
      {resolveHandlePositions().map((handle) => (
        <Handle
          key={`hub-target-${handle.id}`}
          id={`target-${handle.id}`}
          type="target"
          position={handle.position}
          className="!h-2 !w-2 !border-0 !bg-transparent !opacity-0"
        />
      ))}
      {resolveHandlePositions().map((handle) => (
        <Handle
          key={`hub-source-${handle.id}`}
          id={`source-${handle.id}`}
          type="source"
          position={handle.position}
          className="!h-2 !w-2 !border-0 !bg-transparent !opacity-0"
        />
      ))}

      <motion.button
        type="button"
        onClick={() => data.onOpen()}
        animate={{
          opacity: data.isCommitted ? 0 : data.isDimmed ? 0.3 : 1,
          scale: data.isCommitted ? 1.08 : 1,
          y: data.isCommitted ? -6 : 0,
          filter: data.isCommitted ? "blur(4px)" : "blur(0px)",
        }}
        whileHover={data.isCommitted ? undefined : { scale: 1.03, y: -3 }}
        transition={{ duration: data.isCommitted ? 0.5 : 0.3, ease: [0.22, 1, 0.36, 1] }}
        className={cn(
          "group relative flex items-center justify-center overflow-hidden transition-[box-shadow,border-color] duration-300",
          data.band === "overview" && "h-[164px] w-[164px] rounded-[30px]",
          data.band === "summary" && "h-[214px] w-[214px] rounded-[34px]",
          (data.band === "detail" || data.band === "internal") && "h-[268px] w-[268px] rounded-[40px]",
        )}
        style={{
          background: "var(--bg-elevated)",
          border: `1px solid var(--border-default)`,
          boxShadow: "0 2px 8px -4px rgba(0,0,0,0.06)",
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
                data.band === "overview" && "h-11 w-11",
                data.band === "summary" && "h-14 w-14",
                (data.band === "detail" || data.band === "internal") && "h-16 w-16",
              )}
            />
          ) : (
            <div
              className={cn(
                "flex items-center justify-center rounded-full bg-[linear-gradient(135deg,var(--accent-cyan),var(--accent-mint))] font-semibold text-white",
                data.band === "overview" && "h-11 w-11 text-sm",
                data.band === "summary" && "h-14 w-14 text-base",
                (data.band === "detail" || data.band === "internal") && "h-16 w-16 text-lg",
              )}
            >
              {initials}
            </div>
          )}
          <div>
            <div className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">
              {getTimeGreeting()}
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
                <span>Artifacts</span>
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
  hub: HubNode,
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
}: WorkspaceCanvasProps) {
  const reactFlowRef = useRef<ReactFlowInstance | null>(null);
  const initializedRef = useRef(false);
  const commitDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commitAnimationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const animatedCommitRef = useRef<string | null>(null);
  const prefetchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const workstreamDragThrottleRef = useRef(new Map<string, number>());
  const lastViewportRef = useRef<{ x: number; y: number; zoom: number }>({ x: 0, y: 0, zoom: 0.78 });
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
    setPrimaryWorkstreamId,
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
    if (band !== "internal" || visibleWorkstreamIds.length === 0) {
      return;
    }
    void Promise.all(visibleWorkstreamIds.map((workstreamId) => fetchContentForWorkstream(workstreamId)));
  }, [band, fetchContentForWorkstream, visibleWorkstreamIds]);

  const updateVisibilityModel = useCallback((currentZoom: number) => {
    if (commitDebounceRef.current) {
      clearTimeout(commitDebounceRef.current);
    }

    commitDebounceRef.current = setTimeout(() => {
      const currentBand = getRepresentationBand(currentZoom);
      const vp = lastViewportRef.current;
      const centerX = (-vp.x + window.innerWidth / 2) / vp.zoom;
      const centerY = (-vp.y + window.innerHeight / 2) / vp.zoom;

      const nearby = visibleWorkstreams
        .map((ws) => {
          const pos = positions.get(ws._id);
          if (!pos) return null;
          const dx = pos.x - centerX;
          const dy = pos.y - centerY;
          return {
            id: ws._id,
            distance: Math.sqrt(dx * dx + dy * dy),
          };
        })
        .filter((row): row is { id: string; distance: number } => Boolean(row))
        .sort((left, right) => left.distance - right.distance);

      if (currentBand === "internal") {
        let nextVisible = nearby.filter((row) => row.distance <= 600).map((row) => row.id);
        const hubDistance = distanceFromHub(centerX, centerY);
        if (hubDistance <= 400) {
          nextVisible.push("__hub__");
        }
        
        let nextPrimary = nextVisible[0];
        if (hubDistance <= 320 && (!nextPrimary || nextPrimary === "__hub__" || hubDistance < nearby[0]?.distance)) {
          nextPrimary = "__hub__";
        }

        if (!sameIds(visibleWorkstreamIds, nextVisible)) {
          setVisibleWorkstreamIds(nextVisible);
        }
        if (nextPrimary !== primaryWorkstreamId) {
          setPrimaryWorkstreamId(nextPrimary);
          onCommitWorkstream?.(nextPrimary ?? null);
        }
        return;
      }

      if (currentBand === "detail") {
        if (prefetchDebounceRef.current) {
          clearTimeout(prefetchDebounceRef.current);
        }
        prefetchDebounceRef.current = setTimeout(() => {
          const targets = nearby
            .filter((row) => row.distance <= 600)
            .map((row) => row.id);
          if (distanceFromHub(centerX, centerY) <= 320) {
            targets.unshift("__hub__");
          }
          void Promise.all(Array.from(new Set(targets)).map((workstreamId) => fetchContentForWorkstream(workstreamId)));
        }, 300);
        return;
      }

      if (visibleWorkstreamIds.length > 0 || primaryWorkstreamId) {
        setVisibleWorkstreamIds([]);
        setPrimaryWorkstreamId(undefined);
        onCommitWorkstream?.(null);
      }
    }, 400);
  }, [
    fetchContentForWorkstream,
    onCommitWorkstream,
    positions,
    primaryWorkstreamId,
    setPrimaryWorkstreamId,
    setVisibleWorkstreamIds,
    visibleWorkstreamIds,
    visibleWorkstreams,
  ]);

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

        // Get node position and zoom to it
        const node = instance.getNode(`ws-${workstreamId}`);
        if (node) {
          instance.setCenter(
            node.position.x + 150,
            node.position.y + 100,
            { zoom: 1.7, duration: 450 },
          );
        }
      }

      // Commit after animation
      commitAnimationTimeoutRef.current = setTimeout(() => {
        commitWorkstream(workstreamId);
        onOpenWorkstream?.(workstreamId);
      }, 450);
    },
    [commitWorkstream, onOpenWorkstream, primaryWorkstreamId, setPreviousViewport],
  );

  const handleExitWorkstream = useCallback(() => {
    const { previousViewport } = useWorkspaceStore.getState();
    if (commitAnimationTimeoutRef.current) {
      clearTimeout(commitAnimationTimeoutRef.current);
    }
    animatedCommitRef.current = null;
    exitWorkstream();
    onCommitWorkstream?.(null);

    // Restore previous viewport
    const instance = reactFlowRef.current;
    if (instance && previousViewport) {
      instance.setViewport(previousViewport, { duration: 400 });
    } else if (instance) {
      instance.setCenter(0, 0, { zoom: 0.9, duration: 400 });
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
        instance.setCenter(0, 0, { zoom: 1.7, duration: 450 });
      }
      commitAnimationTimeoutRef.current = setTimeout(() => {
        commitWorkstream("__hub__");
        onOpenHub?.();
      }, 450);
    },
    [commitWorkstream, onOpenHub, primaryWorkstreamId, setPreviousViewport],
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
      instance.setCenter(0, 0, { zoom: 1.7, duration: 450 });
      return;
    }

    const node = instance.getNode(`ws-${primaryWorkstreamId}`);
    if (!node) return;
    animatedCommitRef.current = primaryWorkstreamId;
    setPreviousViewport({ ...lastViewportRef.current });
    instance.setCenter(
      node.position.x + 150,
      node.position.y + 100,
      { zoom: 1.7, duration: 450 },
    );
  }, [positions, primaryWorkstreamId, setPreviousViewport]);

  useEffect(() => () => {
    if (commitDebounceRef.current) clearTimeout(commitDebounceRef.current);
    if (commitAnimationTimeoutRef.current) clearTimeout(commitAnimationTimeoutRef.current);
    if (prefetchDebounceRef.current) clearTimeout(prefetchDebounceRef.current);
  }, []);

  const nodes = useMemo<Node[]>(() => {
    const hubNode: Node<HubNodeData> = {
      id: HUB_NODE_ID,
      type: "hub",
      position: { x: -110, y: -110 },
      draggable: false,
      selectable: false,
      data: {
        userName,
        userAvatar,
        totalWorkstreams: workstreams.filter((ws) => ws.status === "active").length,
        band,
        isDimmed: !!primaryWorkstreamId && primaryWorkstreamId !== "__hub__",
        isCommitted: primaryWorkstreamId === "__hub__",
        onOpen: handleOpenHub,
      },
    };

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
    if (visibleWorkstreamIds.length > 0 && band === "internal") {
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

    return [hubNode, ...workstreamNodes, ...internalNodes];
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

    if (viewMode !== "graph" || band !== "internal") {
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
    const saved = restoreViewport();
    instance.setViewport(saved, { duration: 0 });
    setCamera({ x: saved.x, y: saved.y, z: saved.zoom });
    setZoom(saved.zoom);
  }, [setCamera]);

  const handleMove = useCallback((_: unknown, viewport: Viewport) => {
    setZoom(viewport.zoom);
    lastViewportRef.current = { x: viewport.x, y: viewport.y, zoom: viewport.zoom };
    updateVisibilityModel(viewport.zoom);
  }, [updateVisibilityModel]);

  const handleMoveEnd = useCallback(
    (_: unknown, viewport: Viewport) => {
      setZoom(viewport.zoom);
      setCamera({ x: viewport.x, y: viewport.y, z: viewport.zoom });
      lastViewportRef.current = { x: viewport.x, y: viewport.y, zoom: viewport.zoom };
      updateVisibilityModel(viewport.zoom);
      try {
        window.localStorage.setItem("workspace:viewport", JSON.stringify(viewport));
      } catch {
        // Ignore
      }
    },
    [setCamera, updateVisibilityModel],
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
      }
      instance.setCenter(0, 0, { zoom: 0.9, duration: 500 });
    };
    window.addEventListener("workspace:center-home", handler);
    return () => window.removeEventListener("workspace:center-home", handler);
  }, [handleExitWorkstream, primaryWorkstreamId]);

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

      {/* Breadcrumb — only when committed */}
      <AnimatePresence>
        {committedWorkstream && (
          <WorkspaceBreadcrumb
            workstream={committedWorkstream}
            onBack={handleExitWorkstream}
          />
        )}
        {!committedWorkstream && primaryWorkstreamId === "__hub__" && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
            className="absolute top-3 left-4 z-30 flex items-center gap-1.5"
          >
            <button
              type="button"
              onClick={handleExitWorkstream}
              className="inline-flex items-center gap-1 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
              <span>Workspace</span>
            </button>
            <span className="text-[var(--text-tertiary)]">/</span>
            <span className="text-sm font-medium text-[var(--text-primary)]">Hub</span>
          </motion.div>
        )}
      </AnimatePresence>

      <ReactFlow
        nodes={nodes}
        edges={edges}
        fitView={false}
        minZoom={0.24}
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
            onClick={() => reactFlowRef.current?.zoomTo(1.42, { duration: 350 })}
            title="Focus detail band"
          >
            <ZoomIn className="h-4 w-4" />
          </ControlButton>
          <ControlButton
            onClick={() => {
              if (primaryWorkstreamId) {
                handleExitWorkstream();
              }
              reactFlowRef.current?.setCenter(0, 0, { zoom: 0.9, duration: 500 });
            }}
            title="Return to hub"
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
            onClick={() => { setContextMenu(null); panelOpener("artifact", "new"); }}
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
