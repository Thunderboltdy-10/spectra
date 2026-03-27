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
import { Crosshair, ZoomIn } from "lucide-react";
import { useWorkspaceStore, type WorkspaceBackgroundMode } from "@/stores/workspace-store";
import type { Workstream } from "@/hooks/use-workspace-data";
import { cn } from "@/lib/utils";
import { getWorkstreamColor } from "@/lib/workspace/zoom-helpers";

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
          stroke: "color-mix(in oklab, var(--accent-mint) 38%, var(--border-default))",
          strokeWidth: 1.15,
          strokeDasharray: "6 8",
          opacity: 0.52,
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: "color-mix(in oklab, var(--accent-mint) 38%, var(--border-default))",
          width: 16,
          height: 16,
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
        ? 0.92
        : lastActivityAge < 7 * 24 * 60 * 60 * 1000
          ? 0.68
          : 0.38;

    return {
      id: `hub-${workstream._id}`,
      source: HUB_NODE_ID,
      target: `ws-${workstream._id}`,
      animated: false,
      selectable: false,
      deletable: false,
      style: {
        stroke: color,
        strokeWidth: workstream.status === "completed" ? 1.05 : 1.45,
        strokeDasharray: workstream.status === "completed" ? "5 6" : undefined,
        opacity: workstream.status === "archived" ? 0.16 : recentOpacity,
      },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color,
        width: 18,
        height: 18,
      },
    };
  });

  return [...hubEdges, ...buildPeerLinks(workstreams)];
}

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

const WorkstreamNode = memo(function WorkstreamNode({
  data,
}: NodeProps<Node<WorkstreamNodeData>>) {
  const { workstream, band, isFocused, isDimmed, onOpen } = data;
  const color = getWorkstreamColor(workstream.color);
  const dueLabel = workstream.lastActivityAt
    ? new Date(workstream.lastActivityAt).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
      })
    : "Fresh";

  return (
    <div className="relative">
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !border-0 !bg-transparent" />
      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !border-0 !bg-transparent" />

      <button
        type="button"
        onClick={(event) => onOpen(workstream._id, event.currentTarget)}
        className={cn(
          "group relative w-[320px] overflow-hidden rounded-[28px] text-left transition-all duration-300",
          band === "overview" && "h-[164px]",
          band === "summary" && "h-[212px]",
          band === "detail" && "h-[256px]",
          isFocused && "ring-2 ring-[color:var(--accent-cyan)]",
          isDimmed && "opacity-35 saturate-[0.8]",
        )}
        style={{
          background:
            "linear-gradient(160deg, color-mix(in oklab, var(--bg-elevated) 88%, #ffffff) 0%, color-mix(in oklab, var(--bg-primary) 92%, #000000) 100%)",
          border: `1px solid ${color.border}`,
          boxShadow: isFocused
            ? `0 30px 70px -24px ${color.value}55`
            : `0 24px 60px -30px ${color.value}40`,
        }}
      >
        <div
          className="pointer-events-none absolute inset-0 opacity-80"
          style={{
            background: `radial-gradient(circle at 14% 18%, ${color.value}18 0%, transparent 38%), linear-gradient(180deg, ${color.value}14 0%, transparent 28%)`,
          }}
        />
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-px"
          style={{ background: `linear-gradient(90deg, transparent, ${color.value}, transparent)` }}
        />

        <div className="relative flex h-full flex-col px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-3">
              <div
                className={cn(
                  "flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-2xl",
                  band === "overview" && "h-10 w-10 text-xl",
                )}
                style={{
                  background: `color-mix(in oklab, ${color.value} 14%, transparent)`,
                  border: `1px solid ${color.border}`,
                }}
              >
                {workstream.emoji || "📚"}
              </div>

              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span
                    className="rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em]"
                    style={{
                      background: color.bg,
                      color: color.value,
                      border: `1px solid ${color.border}`,
                    }}
                  >
                    {workstream.type}
                  </span>
                  <span className="text-[10px] uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
                    {workstream.status}
                  </span>
                </div>
                <h3
                  className={cn(
                    "mt-2 font-display text-[1.05rem] leading-tight text-[var(--text-primary)]",
                    band === "overview" && "mt-1 text-[0.95rem]",
                  )}
                >
                  {workstream.title}
                </h3>
                {band !== "overview" && (
                  <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-[var(--text-secondary)]">
                    {workstream.description || "A calm space for working threads, notes, and the next concrete step."}
                  </p>
                )}
              </div>
            </div>

            <div
              className="rounded-full border px-2 py-1 text-[10px] font-medium uppercase tracking-[0.12em] text-[var(--text-secondary)]"
              style={{ borderColor: color.border }}
            >
              {band === "detail" ? "Enter" : "Zoom"}
            </div>
          </div>

          {band !== "overview" && (
            <div className="mt-5 grid grid-cols-3 gap-2">
              <MetricChip label="Threads" value={workstream.threadCount ?? 0} color={color.value} />
              <MetricChip label="Artifacts" value={workstream.artifactCount ?? 0} color="var(--accent-mint)" />
              <MetricChip label="Active" value={dueLabel} color="var(--warning)" />
            </div>
          )}

          {band === "detail" && (
            <div className="mt-auto space-y-3 pt-5">
              <div className="grid grid-cols-[1.2fr_0.9fr] gap-3">
                <RevealCard
                  eyebrow="Main stage"
                  title={workstream.description || "Open the focused workspace to continue the current thread, note, or artifact."}
                />
                <RevealCard
                  eyebrow="Representation"
                  title="Structured, Columns, and Graph stay in the same visual system."
                />
              </div>
              <div className="flex items-center justify-between border-t border-[var(--border-default)]/70 pt-3">
                <span className="text-[11px] uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
                  Click to commit deeper
                </span>
                <span className="text-sm font-medium text-[var(--text-primary)]">
                  Focus workspace
                </span>
              </div>
            </div>
          )}
        </div>
      </button>
    </div>
  );
});

const HubNode = memo(function HubNode({
  data,
}: NodeProps<Node<HubNodeData>>) {
  const initials = (data.userName || "Y")
    .split(" ")
    .map((part: string) => part[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="relative">
      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !border-0 !bg-transparent" />
      <button
        type="button"
        onClick={(event) => data.onOpen(event.currentTarget)}
        className={cn(
          "group relative flex items-center justify-center overflow-hidden rounded-[32px] border border-[var(--border-default)] transition-all duration-300",
          data.band === "overview" && "h-[180px] w-[180px]",
          data.band === "summary" && "h-[220px] w-[220px]",
          data.band === "detail" && "h-[260px] w-[260px]",
        )}
        style={{
          background:
            "radial-gradient(circle at 32% 28%, color-mix(in oklab, var(--accent-cyan) 16%, transparent), transparent 42%), linear-gradient(160deg, color-mix(in oklab, var(--bg-elevated) 90%, white), color-mix(in oklab, var(--bg-primary) 92%, black))",
          boxShadow: "0 34px 80px -34px rgba(14, 142, 232, 0.45)",
        }}
      >
        <div className="pointer-events-none absolute inset-[18px] rounded-[28px] border border-[color:color-mix(in_oklab,var(--accent-cyan)_28%,var(--border-default))]" />
        <div className="relative flex flex-col items-center gap-3 px-6 text-center">
          {data.userAvatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={data.userAvatar}
              alt=""
              className={cn(
                "rounded-full border-2 border-[var(--accent-cyan)]/20 object-cover shadow-lg",
                data.band === "overview" && "h-14 w-14",
                data.band === "summary" && "h-16 w-16",
                data.band === "detail" && "h-20 w-20",
              )}
            />
          ) : (
            <div
              className={cn(
                "flex items-center justify-center rounded-full border-2 border-white/10 bg-[linear-gradient(135deg,var(--accent-cyan),var(--accent-mint))] font-semibold text-white shadow-lg",
                data.band === "overview" && "h-14 w-14 text-lg",
                data.band === "summary" && "h-16 w-16 text-xl",
                data.band === "detail" && "h-20 w-20 text-2xl",
              )}
            >
              {initials}
            </div>
          )}

          <div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
              Personal hub
            </div>
            <h3 className="mt-2 font-display text-xl text-[var(--text-primary)]">
              {data.userName}
            </h3>
            {data.band !== "overview" && (
              <p className="mt-2 text-sm leading-relaxed text-[var(--text-secondary)]">
                The calm origin for cross-workstream notes, deadlines, and returning context.
              </p>
            )}
          </div>

          {data.band === "detail" && (
            <div className="grid w-full grid-cols-3 gap-2 pt-2">
              <MetricChip label="Streams" value={data.totalWorkstreams} color="var(--accent-cyan)" />
              <MetricChip label="Notes" value="Inbox" color="var(--accent-mint)" />
              <MetricChip label="Scope" value="Global" color="var(--warning)" />
            </div>
          )}
        </div>
      </button>
    </div>
  );
});

function MetricChip({
  label,
  value,
  color,
}: {
  label: string;
  value: number | string;
  color: string;
}) {
  return (
    <div className="rounded-2xl border border-[var(--border-default)]/80 bg-[var(--bg-primary)]/70 px-3 py-2">
      <div className="text-[10px] uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
        {label}
      </div>
      <div className="mt-1 text-sm font-semibold" style={{ color }}>
        {value}
      </div>
    </div>
  );
}

function RevealCard({
  eyebrow,
  title,
}: {
  eyebrow: string;
  title: string;
}) {
  return (
    <div className="rounded-2xl border border-[var(--border-default)]/70 bg-[var(--bg-primary)]/72 px-3 py-3">
      <div className="text-[10px] uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
        {eyebrow}
      </div>
      <div className="mt-2 text-sm leading-relaxed text-[var(--text-primary)]">
        {title}
      </div>
    </div>
  );
}

function FlowBackground({ mode }: { mode: WorkspaceBackgroundMode }) {
  if (mode === "blank") {
    return null;
  }

  return (
    <Background
      gap={mode === "dots" ? 24 : 48}
      size={mode === "dots" ? 1.15 : 1}
      variant={mode === "dots" ? BackgroundVariant.Dots : BackgroundVariant.Lines}
      color="color-mix(in oklab, var(--border-default) 86%, transparent)"
    />
  );
}

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
      position: { x: -120, y: -120 },
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
      const radius = 460 + (index % 3) * 64;
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

  useEffect(() => {
    const instance = reactFlowRef.current;
    if (!instance) return;

    const targetId = focusWorkstreamId ? `ws-${focusWorkstreamId}` : HUB_NODE_ID;
    const target = instance.getNode(targetId);
    if (!target) return;

    const zoomLevel = focusWorkstreamId ? 1.12 : 0.82;
    const centerX = target.position.x + 160;
    const centerY = target.position.y + (focusWorkstreamId ? 112 : 130);
    instance.setCenter(centerX, centerY, { zoom: zoomLevel, duration: 520 });
  }, [focusWorkstreamId]);

  useEffect(() => {
    const handler = () => {
      const instance = reactFlowRef.current;
      if (!instance) return;
      instance.setCenter(0, 0, { zoom: 0.82, duration: 520 });
    };

    window.addEventListener("workspace:center-hub", handler);
    return () => window.removeEventListener("workspace:center-hub", handler);
  }, []);

  return (
    <div
      className="relative h-full w-full overflow-hidden bg-[var(--bg-primary)]"
      data-workspace-flow-root
    >
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(circle at 18% 14%, rgba(14, 142, 232, 0.09), transparent 26%), radial-gradient(circle at 82% 16%, rgba(32, 184, 178, 0.08), transparent 28%), linear-gradient(180deg, rgba(255,255,255,0.02), transparent 24%)",
        }}
      />

      <ReactFlow
        nodes={nodes}
        edges={edges}
        fitView={false}
        minZoom={0.36}
        maxZoom={1.8}
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
        panOnScroll
        zoomOnScroll
        zoomOnDoubleClick={false}
        proOptions={{ hideAttribution: true }}
        className="workspace-react-flow"
      >
        <FlowBackground mode={backgroundMode} />
        <Controls position="bottom-left" showInteractive={false}>
          <ControlButton onClick={() => reactFlowRef.current?.zoomTo(1.12, { duration: 280 })} title="Focus detail band">
            <ZoomIn className="h-4 w-4" />
          </ControlButton>
          <ControlButton onClick={() => reactFlowRef.current?.setCenter(0, 0, { zoom: 0.82, duration: 420 })} title="Return to hub">
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
