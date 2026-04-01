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
import type { WorkspaceShellMode } from "@/lib/workspace/shell-mode";
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
  ConstellationClusterNode,
  MagneticPanelNode,
  LensesLensNode,
  EmptyStateNode,
  FocusTimerNode,
  buildConstellationNodes,
  buildMagneticNodes,
  buildLensesNodes,
  type ThreadSummary,
  type NoteSummary,
  type PlannerItemSummary,
  type ArtifactSummary,
} from "@/components/workspace/views/internal-content-nodes";
import { buildHubNodes } from "@/components/workspace/hub-internal-view";

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
  shellMode?: WorkspaceShellMode;
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
  shellMode: WorkspaceShellMode;
};

type HubAnchorNodeData = {
  shellMode: WorkspaceShellMode;
  workstreamCount: number;
  pendingCount: number;
  timerActive: boolean;
  onOpen: () => void;
  onNew?: () => void;
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

function getRepresentationBand(zoom: number): ZoomBand {
  if (zoom < 0.25) return "overview";
  if (zoom < 0.5) return "summary";
  if (zoom < 0.9) return "detail";
  return "internal";
}

function getNeighborOpacity(zoom: number): number {
  if (zoom <= 0.7) return 1;
  if (zoom >= 1.0) return 0;
  return Math.max(0, 1 - (zoom - 0.7) / 0.3);
}

function restoreViewport(): Viewport {
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
  const { workstream, band, isFocused, isDimmed, isCommitted, neighborOpacity, lifecycle, onOpen, shellMode } = data;
  const color = getWorkstreamColor(workstream.color);

  // Node width by band (scaled up for 2.5x layout)
  const baseWidth = band === "overview" ? 520 : band === "summary" ? 620 : band === "detail" ? 720 : 780;
  const width = shellMode === "constellations"
    ? baseWidth - 24
    : shellMode === "lenses"
      ? baseWidth - 10
      : baseWidth;

  const dissolving = isCommitted;

  const shellNodeStyle = {
    constellations: {
      radius: dissolving ? "20px" : "30px",
      background: dissolving
        ? `linear-gradient(180deg, color-mix(in oklab, ${color.value} 8%, var(--bg-elevated)) 0%, color-mix(in oklab, var(--bg-elevated) 88%, transparent) 100%)`
        : "transparent",
      borderColor: dissolving ? `${color.value}40` : "transparent",
      boxShadow: dissolving
        ? `0 0 22px -10px ${color.value}45`
        : isFocused
          ? `0 0 0 1px ${color.value}18, 0 30px 80px -48px ${color.value}38`
          : `0 20px 64px -48px ${color.value}24`,
    },
    magnetic: {
      radius: dissolving ? "16px" : "22px",
      background: "var(--bg-elevated)",
      borderColor: dissolving ? `${color.value}40` : "var(--border-default)",
      boxShadow: dissolving
        ? `0 0 18px -10px ${color.value}30`
        : isFocused
          ? `0 0 0 1px color-mix(in oklab, ${color.value} 26%, transparent), 0 18px 36px -28px rgba(15,23,42,0.45)`
          : "0 14px 28px -24px rgba(15,23,42,0.42)",
    },
    lenses: {
      radius: dissolving ? "18px" : "28px",
      background: "color-mix(in oklab, var(--bg-elevated) 78%, transparent)",
      borderColor: dissolving ? `${color.value}34` : "color-mix(in oklab, rgba(255,255,255,0.14) 70%, var(--border-default))",
      boxShadow: dissolving
        ? `0 0 18px -10px ${color.value}32`
        : isFocused
          ? "0 0 0 1px rgba(255,255,255,0.08), 0 24px 58px -36px rgba(15,23,42,0.8)"
          : "0 20px 44px -34px rgba(15,23,42,0.72)",
    },
  }[shellMode];
  const enterLabel = shellMode === "constellations"
    ? "Enter cluster"
    : shellMode === "lenses"
      ? "Focus view"
      : "Open field";
  const metricsClassName = shellMode === "constellations"
    ? "mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-[var(--text-tertiary)]"
    : shellMode === "lenses"
      ? "mt-3 flex flex-wrap items-center gap-2 text-[10px] text-[var(--text-tertiary)]"
      : "mt-3 flex items-center gap-3 text-[10px] text-[var(--text-tertiary)]";
  const metricSeparator = shellMode === "magnetic";
  const showConstellationFrame = shellMode !== "constellations" || dissolving;

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
          background: shellNodeStyle.background,
          borderWidth: showConstellationFrame ? 1 : 0,
          borderStyle: lifecycle.dashed ? "dashed" : "solid",
          borderColor: shellNodeStyle.borderColor,
          boxShadow: shellNodeStyle.boxShadow,
          borderRadius: shellNodeStyle.radius,
          backdropFilter: shellMode === "lenses" ? "blur(18px)" : undefined,
        }}
      >
        {/* Ambient shell-specific accents */}
        {shellMode === "constellations" ? (
          <>
            <div
              className="pointer-events-none absolute -left-6 top-8 h-16 w-16 rounded-full opacity-40 blur-2xl transition-opacity duration-300 group-hover:opacity-65"
              style={{ background: `${color.value}55` }}
            />
            <div
              className="pointer-events-none absolute -right-4 bottom-4 h-10 w-10 rounded-full opacity-25 blur-xl transition-opacity duration-300 group-hover:opacity-45"
              style={{ background: `${color.value}45` }}
            />
          </>
        ) : (
          <>
            <div
              className={cn(
                "absolute inset-x-0 top-0 h-[3px] opacity-0 group-hover:opacity-60 transition-opacity duration-300",
                shellMode === "magnetic" ? "rounded-t-[22px]" : "rounded-t-[30px]",
              )}
              style={{ background: color.value }}
            />
            <div
              className={cn(
                "absolute inset-x-0 bottom-0 h-[3px] opacity-0 group-hover:opacity-30 transition-opacity duration-300",
                shellMode === "magnetic" ? "rounded-b-[22px]" : "rounded-b-[30px]",
              )}
              style={{ background: color.value }}
            />
          </>
        )}

        <div className={cn("relative flex flex-col", dissolving ? "px-3 py-2" : "px-4 py-3.5")}>
          {/* Top row: emoji + title + type */}
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <span className={cn(dissolving ? "text-sm" : "text-lg", band === "overview" && !dissolving && "text-base")}>
                {workstream.emoji || "📚"}
              </span>
              <div className="min-w-0">
                {shellMode === "constellations" && !dissolving && band !== "overview" && (
                  <div className="mb-1 text-[9px] font-semibold uppercase tracking-[0.22em] text-[var(--text-tertiary)]">
                    constellation
                  </div>
                )}
                <h3
                  className={cn(
                    "font-display leading-snug text-[var(--text-primary)]",
                    dissolving && "text-xs",
                    !dissolving && band === "overview" && "text-sm",
                    !dissolving && band === "summary" && "text-[0.95rem]",
                    !dissolving && (band === "detail" || band === "internal") && "text-base",
                    shellMode === "lenses" && !dissolving && "tracking-[-0.01em]",
                  )}
                >
                  {workstream.title}
                </h3>
              </div>
            </div>
            {!dissolving && shellMode !== "constellations" && (
              <span
                className="mt-0.5 shrink-0 rounded-md px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider"
                style={{ background: color.bg, color: color.value }}
              >
                {workstream.type}
              </span>
            )}
          </div>

          {/* Description */}
          <AnimatePresence>
            {band !== "overview" && !dissolving && (
              <motion.p
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2 }}
                className={cn(
                  "mt-2 line-clamp-2 text-xs leading-relaxed text-[var(--text-secondary)]",
                  shellMode === "constellations" && "max-w-[28ch]",
                )}
              >
                {workstream.description || "A space for threads, artifacts, and tasks."}
              </motion.p>
            )}
          </AnimatePresence>

          {/* Metrics */}
          <AnimatePresence>
            {band !== "overview" && !dissolving && shellMode !== "constellations" && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2, delay: 0.05 }}
                className={metricsClassName}
              >
                <span className={shellMode === "lenses" ? "rounded-full bg-[rgba(255,255,255,0.05)] px-2 py-0.5" : undefined}>
                  {workstream.threadCount ?? 0} threads
                </span>
                {metricSeparator && <span className="h-3 w-px bg-[var(--border-default)]" />}
                <span className={shellMode === "lenses" ? "rounded-full bg-[rgba(255,255,255,0.05)] px-2 py-0.5" : undefined}>
                  {workstream.artifactCount ?? 0} artifacts
                </span>
                {metricSeparator && <span className="h-3 w-px bg-[var(--border-default)]" />}
                <span className={shellMode === "lenses" ? "rounded-full bg-[rgba(255,255,255,0.05)] px-2 py-0.5" : undefined}>
                  {formatActivity(workstream.lastActivityAt)}
                </span>
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
                className={cn(
                  "mt-3 flex items-center justify-between pt-3",
                  shellMode === "constellations"
                    ? "pt-4"
                    : "border-t border-[var(--border-default)]",
                )}
              >
                <span className="text-[10px] text-[var(--text-tertiary)]">
                  {shellMode === "constellations"
                    ? "Drift into focus"
                    : shellMode === "lenses"
                      ? "Bring into focus"
                      : "Click to enter"}
                </span>
                <span className="text-xs font-medium text-[var(--accent-cyan)] transition-transform duration-150 group-hover:translate-x-1">
                  {enterLabel} →
                </span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.button>
    </div>
  );
});

const HubAnchorNode = memo(function HubAnchorNode({
  data,
}: NodeProps<Node<HubAnchorNodeData>>) {
  const shellStyles = {
    constellations: {
      shell: "rounded-[44px] border border-[rgba(255,255,255,0.55)] bg-[rgba(255,255,255,0.82)] shadow-[0_30px_80px_-34px_rgba(14,142,232,0.25)] backdrop-blur-xl",
      halo: "absolute -inset-10 rounded-[56px] bg-[radial-gradient(circle,rgba(14,142,232,0.14),transparent_68%)] blur-3xl",
      align: "items-center text-center",
    },
    magnetic: {
      shell: "rounded-[32px] border border-[var(--border-default)] bg-[var(--bg-elevated)] shadow-[0_26px_70px_-40px_rgba(15,23,42,0.35)]",
      halo: "absolute inset-0 rounded-[32px] border border-white/5",
      align: "items-start text-left",
    },
    lenses: {
      shell: "rounded-[999px] border border-[rgba(255,255,255,0.16)] bg-[rgba(19,17,26,0.38)] shadow-[0_30px_90px_-40px_rgba(15,23,42,0.62)] backdrop-blur-2xl",
      halo: "absolute -inset-6 rounded-[999px] bg-[radial-gradient(circle,rgba(255,255,255,0.10),transparent_72%)] blur-3xl",
      align: "items-center text-center",
    },
  }[data.shellMode];

  return (
    <motion.button
      type="button"
      onClick={data.onOpen}
      whileHover={{ scale: 1.02, y: -2 }}
      transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
      className={cn(
        "group relative flex h-[220px] w-[320px] flex-col justify-between overflow-hidden px-7 py-6",
        shellStyles.shell,
        shellStyles.align,
      )}
    >
      <div className={cn("pointer-events-none -z-10", shellStyles.halo)} />
      <div className="flex items-center gap-3">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--accent-cyan)]/12 text-[var(--accent-cyan)]">
          <Home className="h-6 w-6" />
        </div>
        <div className={cn("min-w-0", data.shellMode !== "magnetic" && "mx-auto")}>
          <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--text-tertiary)]">
            Hub
          </div>
          <div className="font-display text-[1.55rem] leading-tight text-[var(--text-primary)]">
            Workspace Home
          </div>
        </div>
      </div>

      <p className={cn("max-w-[26ch] text-sm leading-6 text-[var(--text-secondary)]", data.shellMode !== "magnetic" && "mx-auto")}>
        Timers, quick notes, deadlines, and the cross-workstream view live here.
      </p>

      <div className={cn("flex flex-wrap gap-2", data.shellMode !== "magnetic" && "justify-center")}>
        <span className="rounded-full border border-[var(--border-default)]/70 bg-[var(--bg-primary)]/55 px-3 py-1 text-[11px] font-medium text-[var(--text-secondary)]">
          {data.workstreamCount} workstreams
        </span>
        <span className="rounded-full border border-[var(--border-default)]/70 bg-[var(--bg-primary)]/55 px-3 py-1 text-[11px] font-medium text-[var(--text-secondary)]">
          {data.pendingCount} visible items
        </span>
        {data.timerActive && (
          <span className="rounded-full border border-[var(--accent-cyan)]/30 bg-[var(--accent-cyan)]/12 px-3 py-1 text-[11px] font-medium text-[var(--accent-cyan)]">
            timer active
          </span>
        )}
      </div>

      <div className={cn("flex items-center justify-between gap-3 text-sm", data.shellMode !== "magnetic" && "justify-center")}>
        {data.onNew && (
          <span className="inline-flex items-center gap-1.5 text-[var(--text-tertiary)]">
            <Plus className="h-4 w-4" />
            New
          </span>
        )}
        <span className="font-medium text-[var(--accent-cyan)] transition-transform duration-150 group-hover:translate-x-1">
          Open hub →
        </span>
      </div>
    </motion.button>
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
  zoom,
  shellMode,
}: {
  mode: WorkspaceBackgroundMode;
  zoom: number;
  shellMode: WorkspaceShellMode;
}) {
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
      color={shellMode === "constellations"
        ? "color-mix(in oklab, var(--accent-cyan) 18%, var(--border-default))"
        : shellMode === "lenses"
          ? "color-mix(in oklab, rgba(255,255,255,0.22) 40%, var(--border-default))"
          : isDots
            ? "color-mix(in oklab, var(--border-default) 74%, transparent)"
            : "color-mix(in oklab, var(--border-default) 60%, transparent)"}
    />
  );
}

/* ─── Breadcrumb ─────────────────────────────────────────── */

function WorkspaceBreadcrumb({
  workstream,
  onBack,
  shellMode,
}: {
  workstream: Workstream;
  onBack: () => void;
  shellMode: WorkspaceShellMode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.2 }}
      className={cn(
        "absolute top-3 left-4 z-30 flex items-center gap-1.5 rounded-full px-2.5 py-1.5",
        shellMode === "constellations"
          ? "bg-[color:rgba(19,17,26,0.52)] backdrop-blur-md"
          : shellMode === "lenses"
            ? "bg-[color:rgba(19,17,26,0.6)] backdrop-blur-xl"
            : "bg-[var(--bg-elevated)]/72",
      )}
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
  hubAnchor: HubAnchorNode,
  constellationCluster: ConstellationClusterNode,
  magneticPanel: MagneticPanelNode,
  lensesLens: LensesLensNode,
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
  onCreateArtifact,
  shellMode = "magnetic",
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
      const instance = reactFlowRef.current;
      if (instance) {
        animatedCommitRef.current = workstreamId;
        setPreviousViewport({ ...lastViewportRef.current });
        const node = instance.getNode(`ws-${workstreamId}`);
        if (node) {
          instance.setCenter(
            node.position.x + 260,
            node.position.y + 120,
            { zoom: 1.0, duration: 450 },
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

  const { nodes, edges } = useMemo<{ nodes: Node[]; edges: Edge[] }>(() => {
    const generatedNodes: Node[] = [];
    const generatedEdges: Edge[] = [];

    const overviewHubNode: Node<HubAnchorNodeData> = {
      id: "hub-anchor",
      type: "hubAnchor",
      position: { x: -160, y: -120 },
      draggable: false,
      selectable: false,
      hidden: !!primaryWorkstreamId && primaryWorkstreamId !== "__hub__",
      data: {
        shellMode,
        workstreamCount: visibleWorkstreams.length,
        pendingCount: visibleWorkstreams.reduce((count, ws) => count + (ws.threadCount ?? 0) + (ws.artifactCount ?? 0), 0),
        timerActive: timerState.active,
        onOpen: handleOpenHub,
        onNew: onNewWorkstream,
      },
    };

    generatedNodes.push(overviewHubNode);

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
          shellMode,
        },
      };
    });

    generatedNodes.push(...workstreamNodes);
    generatedEdges.push(...buildEdges(visibleWorkstreams, positions, showConnections, primaryWorkstreamId));

    if (visibleWorkstreamIds.length > 0) {
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
          generatedNodes.push(...namespacedHubNodes.map((node) => ({
            ...node,
            position: internalNodeOverrides.get(node.id) ?? node.position,
            style: { ...node.style, opacity: isPrimary ? 1 : 0.6 },
          })));
          continue;
        }

        // Build actual UI-specific internal nodes for the workstream!
        if (primaryWorkstreamId === workstreamId) {
          const workstreamPos = positions.get(workstreamId) ?? { x: 0, y: 0 };
          const basePos = { x: workstreamPos.x, y: workstreamPos.y + 120 };
          const focusWorkstream = workstreams.find((ws) => ws._id === workstreamId);

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

          let builderResult: { nodes: Node[], edges: Edge[] } = { nodes: [], edges: [] };

          if (shellMode === "constellations") {
            builderResult = buildConstellationNodes(contentData, basePos);
          } else if (shellMode === "magnetic") {
            builderResult = buildMagneticNodes(contentData, basePos);
          } else if (shellMode === "lenses") {
            builderResult = buildLensesNodes(contentData, basePos);
          }

          generatedNodes.push(...namespaceFlowNodes(`internal:${workstreamId}`, builderResult.nodes).map(node => ({
            ...node,
            position: internalNodeOverrides.get(node.id) ?? node.position,
          })));
          generatedEdges.push(...namespaceFlowEdges(`internal:${workstreamId}`, builderResult.edges));
        }
      }
    }

    return { nodes: generatedNodes, edges: generatedEdges };
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
    visibleWorkstreamIds,
    visibleWorkstreams,
    timerState,
    startTimer,
    pauseTimer,
    resetTimer,
    shellMode,
    showConnections,
    workstreams,
  ]);

  const handleInit = useCallback((instance: ReactFlowInstance) => {
    reactFlowRef.current = instance;
    if (initializedRef.current) return;
    initializedRef.current = true;
    if (primaryWorkstreamId) {
      const saved = restoreViewport();
      instance.setViewport(saved, { duration: 0 });
      setCamera({ x: saved.x, y: saved.y, z: saved.zoom });
      setZoom(saved.zoom);
    } else {
      setTimeout(() => {
        instance.fitView({ padding: 0.08, duration: 400 });
        const vp = instance.getViewport();
        setCamera({ x: vp.x, y: vp.y, z: vp.zoom });
        setZoom(vp.zoom);
      }, 50);
    }
  }, [primaryWorkstreamId, setCamera]);

  const handleMove = useCallback((_: unknown, viewport: Viewport) => {
    setZoom(viewport.zoom);
    lastViewportRef.current = { x: viewport.x, y: viewport.y, zoom: viewport.zoom };
  }, []);

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

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && primaryWorkstreamId) {
        handleExitWorkstream();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleExitWorkstream, primaryWorkstreamId]);

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
      <AnimatePresence>
        {committedWorkstream && (
          <WorkspaceBreadcrumb
            workstream={committedWorkstream}
            onBack={handleExitWorkstream}
            shellMode={shellMode}
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
      <div
        className="pointer-events-none absolute inset-0 z-0"
        style={{
          background: shellMode === "constellations"
            ? "transparent" // Removed filters for constellations
            : shellMode === "lenses"
              ? "transparent" // Removed filters for lenses
              : "transparent",
        }}
      />
      <FlowBackground mode={backgroundMode} zoom={zoom} shellMode={shellMode} />
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
                reactFlowRef.current?.fitView({ padding: 0.08, duration: 500 });
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
            onClick={() => {
              setContextMenu(null);
              if (onCreateArtifact) {
                onCreateArtifact();
              } else {
                panelOpener("artifact", "new");
              }
            }}
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
