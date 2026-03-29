"use client";

/**
 * Canvas-native internal view nodes for committed workstreams.
 * These are React Flow custom node types that render workstream content
 * directly on the canvas (not as overlays).
 */

import { memo, useState } from "react";
import type { Node, NodeProps } from "@xyflow/react";
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

const MAX_VISIBLE = 6;

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
  const hasOverflow = data.items.length > MAX_VISIBLE;
  const visibleItems = expanded ? data.items : data.items.slice(0, MAX_VISIBLE);

  const Icon = {
    thread: MessageSquare,
    note: StickyNote,
    planner: CalendarClock,
    artifact: FileText,
  }[data.icon] ?? FileText;

  return (
    <div className="internal-group-node" style={{ minWidth: 280, maxWidth: 380 }}>
      {/* Group heading */}
      <div className="flex items-center gap-2 mb-2 pb-1.5">
        <Icon className="w-3.5 h-3.5 text-[var(--text-tertiary)]" />
        <span className="text-[11px] font-semibold text-[var(--text-secondary)] uppercase tracking-wider">
          {data.label}
        </span>
        <span className="text-[10px] text-[var(--text-tertiary)]">{data.items.length}</span>
        <div className="flex-1 h-px bg-[var(--border-default)]/50" />
        {data.onNew && (
          <button
            type="button"
            onClick={data.onNew}
            className="flex items-center gap-0.5 text-[10px] text-[var(--text-tertiary)] hover:text-[var(--accent-cyan)] transition-colors"
          >
            <Plus className="w-3 h-3" />
          </button>
        )}
      </div>

      {/* Items */}
      <div className="space-y-px">
        <AnimatePresence initial={false}>
          {visibleItems.map((item, i) => (
            <motion.button
              key={item.id}
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.15, delay: i * 0.02 }}
              type="button"
              onClick={() => data.panelType && data.onOpenPanel(data.panelType, item.id)}
              className={cn(
                "w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg text-left transition-all duration-150",
                data.panelType
                  ? "hover:bg-[var(--bg-elevated)]/60 cursor-pointer"
                  : "cursor-default",
              )}
            >
              <div className="flex items-center gap-2 min-w-0">
                {item.statusColor && (
                  <span
                    className="w-1.5 h-1.5 rounded-full shrink-0"
                    style={{ background: item.statusColor }}
                  />
                )}
                <span className="text-sm text-[var(--text-primary)] truncate">
                  {item.title}
                </span>
              </div>
              {item.meta && (
                <span className="text-[10px] text-[var(--text-tertiary)] shrink-0 whitespace-nowrap">
                  {item.meta}
                </span>
              )}
            </motion.button>
          ))}
        </AnimatePresence>
      </div>

      {/* Overflow toggle */}
      {hasOverflow && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-1 mt-1.5 px-2.5 text-[10px] text-[var(--text-tertiary)] hover:text-[var(--accent-cyan)] transition-colors"
        >
          {expanded ? (
            <>
              <ChevronDown className="w-3 h-3" />
              Show less
            </>
          ) : (
            <>
              <ChevronRight className="w-3 h-3" />
              +{data.items.length - MAX_VISIBLE} more
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
    <div className="internal-column-node" style={{ width: 220 }}>
      <div className="flex items-center gap-2 pb-2 mb-2 border-b border-[var(--border-default)]/50">
        <Icon className="w-3.5 h-3.5 text-[var(--text-tertiary)]" />
        <span className="text-[11px] font-semibold text-[var(--text-secondary)] uppercase tracking-wider">
          {data.label}
        </span>
        <span className="text-[10px] text-[var(--text-tertiary)] ml-auto">{data.items.length}</span>
      </div>
      <div className="space-y-px">
        {data.items.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => data.panelType && data.onOpenPanel(data.panelType, item.id)}
            className="w-full text-left px-2 py-1.5 rounded-lg text-sm text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]/50 transition-colors truncate"
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
  const baseSize = 28 + Math.min(data.interactionCount * 3, 24);

  return (
    <button
      type="button"
      onClick={() => data.panelType && data.onOpenPanel(data.panelType, data.itemId)}
      className="graph-item-node group"
      style={{
        width: baseSize,
        height: baseSize,
        borderRadius: "50%",
        background: `${color}20`,
        border: `2px solid ${color}60`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        transition: "all 200ms ease",
      }}
    >
      <div
        className="absolute -bottom-5 left-1/2 -translate-x-1/2 whitespace-nowrap text-[9px] text-[var(--text-tertiary)] opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
      >
        {data.title}
      </div>
    </button>
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
  const nodes: Node[] = [];
  let yOffset = 0;
  const GAP = 24;

  if (data.loading) return [];

  const hasContent =
    data.threads.length > 0 ||
    data.notes.length > 0 ||
    data.plannerItems.length > 0 ||
    data.artifacts.length > 0;

  if (!hasContent) {
    nodes.push({
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
    });
    return nodes;
  }

  // Threads group
  if (data.threads.length > 0) {
    nodes.push({
      id: "internal-threads",
      type: "group",
      position: { x: basePosition.x, y: basePosition.y + yOffset },
      draggable: true,
      selectable: false,
      data: {
        label: "Threads",
        icon: "thread",
        panelType: "chat",
        onOpenPanel: data.onOpenPanel,
        onNew: () => data.onOpenPanel("chat", "new"),
        items: data.threads.map((t) => ({
          id: t.id,
          title: t.title,
          meta: `${t.messageCount} msgs · ${formatTimeAgo(t.lastActivityAt)}`,
        })),
      } satisfies GroupNodeData,
    });
    yOffset += Math.min(data.threads.length, MAX_VISIBLE) * 32 + 60 + GAP;
  }

  // Notes group
  if (data.notes.length > 0) {
    nodes.push({
      id: "internal-notes",
      type: "group",
      position: { x: basePosition.x, y: basePosition.y + yOffset },
      draggable: true,
      selectable: false,
      data: {
        label: "Documents",
        icon: "note",
        panelType: "note",
        onOpenPanel: data.onOpenPanel,
        onNew: () => data.onOpenPanel("note", "new"),
        items: data.notes.map((n) => ({
          id: n.id,
          title: n.title,
          meta: formatTimeAgo(n.updatedAt),
        })),
      } satisfies GroupNodeData,
    });
    yOffset += Math.min(data.notes.length, MAX_VISIBLE) * 32 + 60 + GAP;
  }

  // Planner group
  if (data.plannerItems.length > 0) {
    nodes.push({
      id: "internal-planner",
      type: "group",
      position: { x: basePosition.x, y: basePosition.y + yOffset },
      draggable: true,
      selectable: false,
      data: {
        label: "Planner",
        icon: "planner",
        onOpenPanel: data.onOpenPanel,
        items: data.plannerItems.map((p) => ({
          id: p.id,
          title: p.title,
          meta: p.dueAt ? formatTimeAgo(p.dueAt) : undefined,
          statusColor:
            p.status === "done" ? "var(--accent-mint)" :
            p.status === "in_progress" ? "var(--accent-cyan)" :
            "var(--text-tertiary)",
        })),
      } satisfies GroupNodeData,
    });
    yOffset += Math.min(data.plannerItems.length, MAX_VISIBLE) * 32 + 60 + GAP;
  }

  // Artifacts group
  if (data.artifacts.length > 0) {
    nodes.push({
      id: "internal-artifacts",
      type: "group",
      position: { x: basePosition.x, y: basePosition.y + yOffset },
      draggable: true,
      selectable: false,
      data: {
        label: "Artifacts",
        icon: "artifact",
        panelType: "artifact",
        onOpenPanel: data.onOpenPanel,
        items: data.artifacts.map((a) => ({
          id: a.id,
          title: a.title,
          meta: a.type,
        })),
      } satisfies GroupNodeData,
    });
  }

  return nodes;
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
    { label: "Documents", icon: "note", items: data.notes.map((n) => ({ id: n.id, title: n.title })), panelType: "note" as PanelType },
    { label: "Tasks", icon: "planner", items: data.plannerItems.map((p) => ({ id: p.id, title: p.title })), panelType: undefined },
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
    type: "column",
    position: { x: basePosition.x + i * 240, y: basePosition.y },
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
  let nodeIndex = 0;

  const MAX_GRAPH_ITEMS = 12;

  const allItems = [
    ...data.threads.slice(0, MAX_GRAPH_ITEMS).map((t) => ({
      id: t.id,
      title: t.title,
      itemType: "thread" as const,
      interactionCount: t.messageCount,
      panelType: "chat" as PanelType,
      createdAt: t.lastActivityAt,
    })),
    ...data.notes.slice(0, MAX_GRAPH_ITEMS).map((n) => ({
      id: n.id,
      title: n.title,
      itemType: "note" as const,
      interactionCount: 1,
      panelType: "note" as PanelType,
      createdAt: n.updatedAt,
    })),
    ...data.artifacts.slice(0, MAX_GRAPH_ITEMS).map((a) => ({
      id: a.id,
      title: a.title,
      itemType: "artifact" as const,
      interactionCount: 1,
      panelType: "artifact" as PanelType,
      createdAt: a.createdAt,
    })),
  ];

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

  // Place items in a radial layout
  const radius = 140;
  for (const item of allItems) {
    const angle = (nodeIndex / allItems.length) * Math.PI * 2 - Math.PI / 2;
    const x = basePosition.x + Math.cos(angle) * radius;
    const y = basePosition.y + Math.sin(angle) * radius;

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
    nodeIndex++;
  }

  // Build temporal proximity edges (items created within 1 hour of each other)
  for (let i = 0; i < allItems.length; i++) {
    for (let j = i + 1; j < allItems.length; j++) {
      const delta = Math.abs(allItems[i]!.createdAt - allItems[j]!.createdAt);
      if (delta < 3_600_000) {
        edges.push({
          id: `graph-edge-${allItems[i]!.id}-${allItems[j]!.id}`,
          source: `graph-${allItems[i]!.id}`,
          target: `graph-${allItems[j]!.id}`,
          style: {
            stroke: "var(--border-default)",
            strokeWidth: 1,
            strokeDasharray: "4 4",
            opacity: 0.4,
          },
        });
      }
    }
  }

  // Overflow nodes for truncated categories
  const overflowY = basePosition.y + radius + 60;
  if (data.threads.length > MAX_GRAPH_ITEMS) {
    nodes.push({
      id: "graph-overflow-threads",
      type: "graphOverflow",
      position: { x: basePosition.x - 100, y: overflowY },
      draggable: false,
      selectable: false,
      data: {
        count: data.threads.length - MAX_GRAPH_ITEMS,
        itemType: "threads",
        onExpand: () => {},
      } satisfies GraphOverflowNodeData,
    });
  }

  return { nodes, edges };
}
