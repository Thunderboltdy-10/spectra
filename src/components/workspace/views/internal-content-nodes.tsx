"use client";

/**
 * Canvas-native internal view nodes for committed workstreams.
 * These are React Flow custom node types that render workstream content
 * directly on the canvas (not as overlays).
 */

import { memo, useState } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { motion, AnimatePresence } from "framer-motion";
import {
  MessageSquare,
  StickyNote,
  CalendarClock,
  FileText,
  Plus,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { PanelType } from "@/stores/workspace-store";

/* ─── Data types ────────────────────────────────────────────── */

export type ThreadSummary = {
  id: string;
  title: string;
  messageCount: number;
  lastActivityAt: number;
};

export type NoteSummary = {
  id: string;
  title: string;
  updatedAt: number;
  editorMode: string;
};

export type PlannerItemSummary = {
  id: string;
  title: string;
  dueAt?: number;
  status: "pending" | "in_progress" | "done";
};

export type ArtifactSummary = {
  id: string;
  title: string;
  type: string;
  createdAt: number;
};

export type InternalContentData = {
  threads: ThreadSummary[];
  notes: NoteSummary[];
  plannerItems: PlannerItemSummary[];
  artifacts: ArtifactSummary[];
  loading: boolean;
  workstreamEmoji?: string;
  workstreamTitle?: string;
  onOpenPanel: (type: PanelType, id: string) => void;
};

/* ─── Helper ────────────────────────────────────────────────── */

function formatTimeAgo(timestamp: number) {
  const delta = Date.now() - timestamp;
  if (delta < 60_000) return "now";
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h`;
  const days = Math.floor(delta / 86_400_000);
  return `${days}d`;
}

/* ─── Group Node (for structured view) ──────────────────────── */

export type GroupNodeData = {
  label: string;
  icon: string; // "thread" | "note" | "planner" | "artifact"
  items: Array<{ id: string; title: string; meta?: string; statusColor?: string }>;
  panelType?: PanelType;
  onOpenPanel: (type: PanelType, id: string) => void;
  onNew?: () => void;
};

export const GroupNode = memo(function GroupNode({
  data,
}: NodeProps<Node<GroupNodeData>>) {
  const [expanded, setExpanded] = useState(false);
  const maxVisible = 5;
  const hasOverflow = data.items.length > maxVisible;
  const visibleItems = expanded ? data.items : data.items.slice(0, maxVisible);

  const Icon = {
    thread: MessageSquare,
    note: StickyNote,
    planner: CalendarClock,
    artifact: FileText,
  }[data.icon] ?? FileText;

  return (
    <div className="internal-group-node" style={{ minWidth: 420, maxWidth: 460 }}>
      <div className="mb-5 flex items-center gap-3 pb-2">
        <Icon className="h-3.5 w-3.5 text-[var(--text-tertiary)]" strokeWidth={1.7} />
        <span className="text-[11px] font-semibold text-[var(--text-secondary)] uppercase tracking-wider">
          {data.label}
        </span>
        <span className="ml-auto text-[11px] text-[var(--text-tertiary)]">{data.items.length}</span>
      </div>
      <div className="mb-5 h-px w-full bg-[var(--border-default)]/45" />

      <div className="space-y-2">
        <AnimatePresence initial={false}>
          {visibleItems.map((item, i) => (
            <motion.button
              key={item.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.18, delay: i * 0.03 }}
              type="button"
              onClick={() => data.panelType && data.onOpenPanel(data.panelType, item.id)}
              className={cn(
                "flex w-full items-start justify-between gap-5 rounded-xl px-3 py-2 text-left transition-all duration-150",
                data.panelType
                  ? "cursor-pointer hover:bg-[var(--bg-elevated)]/36"
                  : "cursor-default",
              )}
            >
              <div className="flex min-w-0 items-start gap-2.5">
                {item.statusColor && (
                  <span
                    className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ background: item.statusColor }}
                  />
                )}
                <span className="truncate text-[15px] leading-7 text-[var(--text-primary)]">
                  {item.title}
                </span>
              </div>
              {item.meta && (
                <span className="shrink-0 whitespace-nowrap pt-1 text-[11px] text-[var(--text-tertiary)]">
                  {item.meta}
                </span>
              )}
            </motion.button>
          ))}
        </AnimatePresence>

        {data.onNew && (
          <button
            type="button"
            onClick={data.onNew}
            className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-[13px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-elevated)]/36 hover:text-[var(--text-primary)]"
          >
            <Plus className="h-3.5 w-3.5" />
            Add new…
          </button>
        )}
      </div>

      {hasOverflow && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-3 flex items-center gap-1 px-3 text-[11px] text-[var(--text-tertiary)] transition-colors hover:text-[var(--accent-cyan)]"
        >
          {expanded ? (
            <>
              <ChevronDown className="w-3 h-3" />
              Show less
            </>
          ) : (
            <>
              <ChevronRight className="w-3 h-3" />
              +{data.items.length - maxVisible} more
            </>
          )}
        </button>
      )}
    </div>
  );
});

/* ─── Column Node (for column view) ─────────────────────────── */

export type ColumnNodeData = {
  label: string;
  icon: string;
  items: Array<{ id: string; title: string }>;
  panelType?: PanelType;
  onOpenPanel: (type: PanelType, id: string) => void;
};

export const ColumnNode = memo(function ColumnNode({
  data,
}: NodeProps<Node<ColumnNodeData>>) {
  const Icon = {
    thread: MessageSquare,
    note: StickyNote,
    planner: CalendarClock,
    artifact: FileText,
  }[data.icon] ?? FileText;

  return (
    <div
      className="internal-column-node rounded-[28px] px-4 py-4"
      style={{
        width: 236,
        background: "color-mix(in oklab, var(--bg-elevated) 54%, transparent)",
      }}
    >
      <div className="mb-4 flex items-center gap-2 border-b border-[var(--border-default)]/35 pb-3">
        <Icon className="h-3.5 w-3.5 text-[var(--text-tertiary)]" strokeWidth={1.7} />
        <span className="text-[11px] font-semibold text-[var(--text-secondary)] uppercase tracking-wider">
          {data.label}
        </span>
        <span className="text-[10px] text-[var(--text-tertiary)] ml-auto">{data.items.length}</span>
      </div>
      <div className="space-y-1.5">
        {data.items.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => data.panelType && data.onOpenPanel(data.panelType, item.id)}
            className="w-full truncate rounded-xl px-3 py-2 text-left text-[14px] text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-elevated)]/44"
          >
            {item.title || "Untitled"}
          </button>
        ))}
      </div>
    </div>
  );
});

/* ─── Graph Item Node (for graph view) ──────────────────────── */

export type GraphItemNodeData = {
  title: string;
  itemType: "thread" | "note" | "planner" | "artifact";
  interactionCount: number;
  panelType?: PanelType;
  itemId: string;
  onOpenPanel: (type: PanelType, id: string) => void;
};

const GRAPH_COLORS = {
  thread: "var(--accent-cyan)",
  note: "var(--accent-mint)",
  planner: "var(--accent-coral)",
  artifact: "#a78bfa",
};

export const GraphItemNode = memo(function GraphItemNode({
  data,
}: NodeProps<Node<GraphItemNodeData>>) {
  const color = GRAPH_COLORS[data.itemType];
  const emphasis = Math.min(data.interactionCount, 9);

  return (
    <div className="relative">
      <Handle
        id="graph-target-left"
        type="target"
        position={Position.Left}
        className="!h-2 !w-2 !border-0 !bg-transparent !opacity-0"
      />
      <Handle
        id="graph-target-top"
        type="target"
        position={Position.Top}
        className="!h-2 !w-2 !border-0 !bg-transparent !opacity-0"
      />
      <Handle
        id="graph-source-right"
        type="source"
        position={Position.Right}
        className="!h-2 !w-2 !border-0 !bg-transparent !opacity-0"
      />
      <Handle
        id="graph-source-bottom"
        type="source"
        position={Position.Bottom}
        className="!h-2 !w-2 !border-0 !bg-transparent !opacity-0"
      />
      <button
        type="button"
        onClick={() => data.panelType && data.onOpenPanel(data.panelType, data.itemId)}
        className="graph-item-node group"
        style={{
          minWidth: 136,
          maxWidth: 196,
          borderRadius: 18,
          background: "color-mix(in oklab, var(--bg-elevated) 88%, transparent)",
          border: `1px solid color-mix(in oklab, ${color} 32%, var(--border-default))`,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          cursor: "pointer",
          transition: "all 200ms ease",
          boxShadow: "0 10px 24px -20px rgba(15, 23, 42, 0.3)",
          padding: "10px 12px",
        }}
      >
        <div className="flex min-w-0 items-center gap-2">
          <span
            className="h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ background: color, boxShadow: `0 0 0 ${2 + emphasis * 0.2}px ${color}18` }}
          />
          <span className="truncate text-[12px] font-medium text-[var(--text-primary)]">
            {data.title}
          </span>
        </div>
        <div className="ml-3 shrink-0 text-[10px] text-[var(--text-tertiary)]">
          {data.interactionCount > 0 ? data.interactionCount : "new"}
        </div>
      </button>
    </div>
  );
});

/* ─── Graph Overflow Node ───────────────────────────────────── */

export type GraphOverflowNodeData = {
  count: number;
  itemType: string;
  onExpand: () => void;
};

export const GraphOverflowNode = memo(function GraphOverflowNode({
  data,
}: NodeProps<Node<GraphOverflowNodeData>>) {
  return (
    <button
      type="button"
      onClick={data.onExpand}
      className="rounded-full px-3 py-1.5 bg-[var(--bg-secondary)] border border-[var(--border-default)] text-[10px] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:border-[var(--accent-cyan)]/40 transition-all cursor-pointer"
    >
      +{data.count} older {data.itemType}
    </button>
  );
});

/* ─── Empty State Node ──────────────────────────────────────── */

export type EmptyStateNodeData = {
  emoji: string;
  title: string;
  description: string;
  onNew?: () => void;
};

export const EmptyStateNode = memo(function EmptyStateNode({
  data,
}: NodeProps<Node<EmptyStateNodeData>>) {
  return (
    <div className="text-center py-8 px-6">
      <span className="text-4xl block mb-3">{data.emoji}</span>
      <h3 className="font-display text-lg text-[var(--text-primary)] mb-1.5">{data.title}</h3>
      <p className="text-sm text-[var(--text-secondary)] max-w-xs mx-auto mb-4">{data.description}</p>
      {data.onNew && (
        <button
          type="button"
          onClick={data.onNew}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold bg-[var(--accent-cyan)] text-white hover:brightness-110 transition-all"
        >
          <Plus className="w-4 h-4" />
          Get started
        </button>
      )}
    </div>
  );
});

/* ─── Node builders ─────────────────────────────────────────── */

/**
 * Build structured view nodes — vertical groups with content rows.
 * Returns React Flow nodes positioned in a vertical layout.
 */
export function buildStructuredNodes(
  data: InternalContentData,
  basePosition: { x: number; y: number },
): Node[] {
  if (data.loading) return [];

  const hasContent =
    data.threads.length > 0 ||
    data.notes.length > 0 ||
    data.plannerItems.length > 0 ||
    data.artifacts.length > 0;

  if (!hasContent) {
    return [{
      id: "internal-empty",
      type: "emptyState",
      position: { x: basePosition.x, y: basePosition.y },
      draggable: true,
      selectable: false,
      data: {
        emoji: data.workstreamEmoji || "📚",
        title: data.workstreamTitle || "Workstream",
        description: "Start a conversation or create a note to get going.",
        onNew: () => data.onOpenPanel("chat", "new"),
      },
    }];
  }

  const groups: Array<Omit<GroupNodeData, "onOpenPanel"> & { id: string; estimatedHeight: number }> = [];

  if (data.threads.length > 0) {
    groups.push({
      id: "internal-threads",
      label: "Threads",
      icon: "thread",
      panelType: "chat",
      onNew: () => data.onOpenPanel("chat", "new"),
      items: data.threads.map((t) => ({
        id: t.id,
        title: t.title,
        meta: `${t.messageCount} msgs · ${formatTimeAgo(t.lastActivityAt)}`,
      })),
      estimatedHeight: 118 + Math.min(data.threads.length, 5) * 46,
    });
  }

  if (data.notes.length > 0) {
    groups.push({
      id: "internal-notes",
      label: "Documents",
      icon: "note",
      panelType: "artifact",
      onNew: () => data.onOpenPanel("artifact", "new"),
      items: data.notes.map((n) => ({
        id: n.id,
        title: n.title,
        meta: formatTimeAgo(n.updatedAt),
      })),
      estimatedHeight: 118 + Math.min(data.notes.length, 5) * 46,
    });
  }

  if (data.plannerItems.length > 0) {
    groups.push({
      id: "internal-planner",
      label: "Planner",
      icon: "planner",
      panelType: "planner",
      onNew: () => data.onOpenPanel("planner", "new"),
      items: data.plannerItems.map((p) => ({
        id: p.id,
        title: p.title,
        meta: p.dueAt ? formatTimeAgo(p.dueAt) : undefined,
        statusColor:
          p.status === "done" ? "var(--accent-mint)"
            : p.status === "in_progress" ? "var(--accent-cyan)"
              : "var(--text-tertiary)",
      })),
      estimatedHeight: 118 + Math.min(data.plannerItems.length, 5) * 46,
    });
  }

  if (data.artifacts.length > 0) {
    groups.push({
      id: "internal-artifacts",
      label: "Artifacts",
      icon: "artifact",
      panelType: "artifact",
      onNew: () => data.onOpenPanel("artifact", "new"),
      items: data.artifacts.map((a) => ({
        id: a.id,
        title: a.title,
        meta: a.type,
      })),
      estimatedHeight: 118 + Math.min(data.artifacts.length, 5) * 46,
    });
  }

  const colHeights = [0, 0];
  const laneWidth = 500;
  const colGap = 54;
  const rowGap = 64;

  return groups.map((group) => {
    const colIndex = colHeights[0] <= colHeights[1] ? 0 : 1;
    const node = {
      id: group.id,
      type: "contentGroup",
      position: {
        x: basePosition.x + colIndex * (laneWidth + colGap),
        y: basePosition.y + colHeights[colIndex]!,
      },
      draggable: true,
      selectable: false,
      data: {
        ...group,
        onOpenPanel: data.onOpenPanel,
      } satisfies GroupNodeData,
    } satisfies Node;
    colHeights[colIndex] += group.estimatedHeight + rowGap;
    return node;
  });
}

/**
 * Build column view nodes — horizontal columns for each category.
 */
export function buildColumnNodes(
  data: InternalContentData,
  basePosition: { x: number; y: number },
): Node[] {
  if (data.loading) return [];

  const columns = [
    { label: "Threads", icon: "thread", items: data.threads.map((t) => ({ id: t.id, title: t.title })), panelType: "chat" as PanelType },
    { label: "Documents", icon: "note", items: data.notes.map((n) => ({ id: n.id, title: n.title })), panelType: "artifact" as PanelType },
    { label: "Tasks", icon: "planner", items: data.plannerItems.map((p) => ({ id: p.id, title: p.title })), panelType: "planner" as PanelType },
    { label: "Artifacts", icon: "artifact", items: data.artifacts.map((a) => ({ id: a.id, title: a.title })), panelType: "artifact" as PanelType },
  ].filter((col) => col.items.length > 0);

  if (columns.length === 0) {
    return [{
      id: "internal-empty",
      type: "emptyState",
      position: basePosition,
      draggable: true,
      selectable: false,
      data: {
        emoji: data.workstreamEmoji || "📚",
        title: data.workstreamTitle || "Workstream",
        description: "No content yet.",
        onNew: () => data.onOpenPanel("chat", "new"),
      },
    }];
  }

  return columns.map((col, i) => ({
    id: `internal-col-${col.label.toLowerCase()}`,
    type: "contentColumn",
    position: { x: basePosition.x + i * 268, y: basePosition.y + ((i % 2) * 20) },
    draggable: true,
    selectable: false,
    data: {
      label: col.label,
      icon: col.icon,
      items: col.items,
      panelType: col.panelType,
      onOpenPanel: data.onOpenPanel,
    } satisfies ColumnNodeData,
  }));
}

/**
 * Build graph view nodes — draggable pills with edges.
 */
export function buildGraphNodes(
  data: InternalContentData,
  basePosition: { x: number; y: number },
): { nodes: Node[]; edges: import("@xyflow/react").Edge[] } {
  if (data.loading) return { nodes: [], edges: [] };

  const nodes: Node[] = [];
  const edges: import("@xyflow/react").Edge[] = [];

  const MAX_GRAPH_ITEMS = 14;

  const allItems = [
    ...data.threads.map((t) => ({
      id: t.id,
      title: t.title,
      itemType: "thread" as const,
      interactionCount: t.messageCount,
      panelType: "chat" as PanelType,
      createdAt: t.lastActivityAt,
    })),
    ...data.notes.map((n) => ({
      id: n.id,
      title: n.title,
      itemType: "note" as const,
      interactionCount: 1,
      panelType: "artifact" as PanelType,
      createdAt: n.updatedAt,
    })),
    ...data.plannerItems.map((p) => ({
      id: p.id,
      title: p.title,
      itemType: "planner" as const,
      interactionCount: 1,
      panelType: "planner" as PanelType,
      createdAt: p.dueAt ?? Date.now(),
    })),
    ...data.artifacts.map((a) => ({
      id: a.id,
      title: a.title,
      itemType: "artifact" as const,
      interactionCount: 1,
      panelType: "artifact" as PanelType,
      createdAt: a.createdAt,
    })),
  ].sort((left, right) => right.createdAt - left.createdAt);

  if (allItems.length === 0) {
    return {
      nodes: [{
        id: "internal-empty",
        type: "emptyState",
        position: basePosition,
        draggable: true,
        selectable: false,
        data: {
          emoji: data.workstreamEmoji || "📚",
          title: data.workstreamTitle || "Workstream",
          description: "No content to graph yet.",
        },
      }],
      edges: [],
    };
  }

  const visibleItems = allItems.slice(0, MAX_GRAPH_ITEMS);
  const clusterCenters = {
    thread: { x: basePosition.x - 240, y: basePosition.y + 40 },
    note: { x: basePosition.x + 80, y: basePosition.y - 40 },
    planner: { x: basePosition.x - 60, y: basePosition.y + 250 },
    artifact: { x: basePosition.x + 320, y: basePosition.y + 110 },
  } as const;

  const groups = visibleItems.reduce<Record<GraphItemNodeData["itemType"], typeof visibleItems>>((acc, item) => {
    acc[item.itemType].push(item);
    return acc;
  }, { thread: [], note: [], planner: [], artifact: [] });

  for (const [itemType, items] of Object.entries(groups) as Array<[GraphItemNodeData["itemType"], typeof visibleItems]>) {
    const center = clusterCenters[itemType];
    items.forEach((item, index) => {
      const row = Math.floor(index / 2);
      const col = index % 2;
      const x = center.x + col * 174 + (row % 2) * 16;
      const y = center.y + row * 84;

      nodes.push({
        id: `graph-${item.id}`,
        type: "graphItem",
        position: { x, y },
        draggable: true,
        selectable: false,
        data: {
          title: item.title,
          itemType: item.itemType,
          interactionCount: item.interactionCount,
          panelType: item.panelType,
          itemId: item.id,
          onOpenPanel: data.onOpenPanel,
        } satisfies GraphItemNodeData,
      });

      if (index > 0) {
        const previous = items[index - 1]!;
        edges.push({
          id: `graph-edge-${previous.id}-${item.id}`,
          source: `graph-${previous.id}`,
          target: `graph-${item.id}`,
          sourceHandle: "graph-source-right",
          targetHandle: "graph-target-left",
          type: "smoothstep",
          animated: true,
          style: {
            stroke: "color-mix(in oklab, var(--accent-cyan) 40%, var(--border-default))",
            strokeWidth: 1.5,
            opacity: 0.78,
          },
        });
      }
    });
  }

  const anchor = visibleItems[0];
  if (anchor) {
    for (const itemType of ["thread", "note", "planner", "artifact"] as const) {
      const first = groups[itemType][0];
      if (!first || first.id === anchor.id) continue;
      edges.push({
        id: `graph-link-${anchor.id}-${first.id}`,
        source: `graph-${anchor.id}`,
        target: `graph-${first.id}`,
        sourceHandle: "graph-source-bottom",
        targetHandle: "graph-target-top",
        type: "smoothstep",
        animated: true,
        style: {
          stroke: "color-mix(in oklab, var(--accent-mint) 34%, var(--border-default))",
          strokeWidth: 1.35,
          opacity: 0.68,
        },
      });
    }
  }

  const overflowByType = {
    thread: Math.max(data.threads.length - groups.thread.length, 0),
    note: Math.max(data.notes.length - groups.note.length, 0),
    planner: Math.max(data.plannerItems.length - groups.planner.length, 0),
    artifact: Math.max(data.artifacts.length - groups.artifact.length, 0),
  };

  const overflowOrder: Array<[GraphOverflowNodeData["itemType"], number, { x: number; y: number }]> = [
    ["threads", overflowByType.thread, { x: clusterCenters.thread.x + 30, y: clusterCenters.thread.y + 210 }],
    ["documents", overflowByType.note, { x: clusterCenters.note.x + 40, y: clusterCenters.note.y + 210 }],
    ["tasks", overflowByType.planner, { x: clusterCenters.planner.x + 10, y: clusterCenters.planner.y + 170 }],
    ["artifacts", overflowByType.artifact, { x: clusterCenters.artifact.x + 10, y: clusterCenters.artifact.y + 170 }],
  ];

  for (const [itemType, count, position] of overflowOrder) {
    if (count <= 0) continue;
    nodes.push({
      id: `graph-overflow-${itemType}`,
      type: "graphOverflow",
      position,
      draggable: false,
      selectable: false,
      data: {
        count,
        itemType,
        onExpand: () => {},
      } satisfies GraphOverflowNodeData,
    });
  }

  return { nodes, edges };
}
