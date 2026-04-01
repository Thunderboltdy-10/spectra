"use client";

/**
 * Hub Internal View — Canvas-native content for the hub node.
 *
 * When the user commits to the hub (via Hub button or deep zoom),
 * this provides buildHubNodes() to render hub-level content as React Flow nodes.
 */

import type { Node } from "@xyflow/react";
import type { PanelType } from "@/stores/workspace-store";
import type { MagneticPanelData, EmptyStateNodeData, FocusTimerNodeData } from "./views/internal-content-nodes";

export type HubContentData = {
  quickNotes: Array<{ id: string; title: string; updatedAt: number }>;
  deadlines: Array<{ id: string; title: string; dueAt: number; workstreamTitle?: string }>;
  recentActivity: Array<{ id: string; title: string; type: string; timestamp: number }>;
  loading: boolean;
  onOpenPanel: (type: PanelType, id: string) => void;
  onNewWorkstream?: () => void;
  timerState?: {
    active: boolean;
    sessionMinutes: number;
    elapsed: number;
    sessionsCompleted: number;
    workstreamTitle?: string;
  };
  onTimerStart?: () => void;
  onTimerPause?: () => void;
  onTimerReset?: () => void;
};

function formatTimeAgo(timestamp: number) {
  const delta = Date.now() - timestamp;
  if (delta < 60_000) return "now";
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h`;
  return `${Math.floor(delta / 86_400_000)}d`;
}

function formatDueDate(timestamp: number) {
  const delta = timestamp - Date.now();
  if (delta < 0) return "overdue";
  if (delta < 86_400_000) return "today";
  if (delta < 2 * 86_400_000) return "tomorrow";
  return `${Math.floor(delta / 86_400_000)}d`;
}

export function buildHubNodes(
  data: HubContentData,
  basePosition: { x: number; y: number },
): Node[] {
  const nodes: Node[] = [];
  let yOffset = 0;
  const GAP = 24;

  if (data.loading) return [];

  const hasContent = data.quickNotes.length > 0 || data.deadlines.length > 0 || data.recentActivity.length > 0;

  if (!hasContent) {
    nodes.push({
      id: "hub-empty",
      type: "emptyState",
      position: basePosition,
      draggable: true,
      selectable: false,
      data: {
        emoji: "🏠",
        title: "Hub",
        description: "Your hub is empty. Create artifacts, set deadlines, or connect ManageBac.",
        onNew: data.onNewWorkstream,
      } satisfies EmptyStateNodeData,
    });
    return nodes;
  }

  // Quick artifacts
  if (data.quickNotes.length > 0) {
    nodes.push({
      id: "hub-notes",
      type: "magneticPanel",
      position: { x: basePosition.x, y: basePosition.y + yOffset },
      draggable: true,
      selectable: false,
      data: {
        label: "Quick Artifacts",
        iconType: "note",
        isMain: true,
        onOpenPanel: data.onOpenPanel,
        items: data.quickNotes.map((n) => ({
          id: n.id,
          title: n.title,
          meta: formatTimeAgo(n.updatedAt),
          panelType: "artifact",
        })),
      } satisfies MagneticPanelData,
    });
    yOffset += Math.min(data.quickNotes.length, 6) * 32 + 120 + GAP;
  }

  // Upcoming Deadlines
  if (data.deadlines.length > 0) {
    nodes.push({
      id: "hub-deadlines",
      type: "magneticPanel",
      position: { x: basePosition.x, y: basePosition.y + yOffset },
      draggable: true,
      selectable: false,
      data: {
        label: "Upcoming Deadlines",
        iconType: "planner",
        isMain: false,
        onOpenPanel: data.onOpenPanel,
        items: data.deadlines.map((d) => ({
          id: d.id,
          title: d.title,
          meta: `${formatDueDate(d.dueAt)}${d.workstreamTitle ? ` · ${d.workstreamTitle}` : ""}`,
          statusColor: d.dueAt < Date.now() ? "var(--accent-coral)" : d.dueAt - Date.now() < 86_400_000 ? "#f59e0b" : "var(--accent-mint)",
          panelType: "planner",
        })),
      } satisfies MagneticPanelData,
    });
    yOffset += Math.min(data.deadlines.length, 6) * 32 + 120 + GAP;
  }

  // Recent Activity
  if (data.recentActivity.length > 0) {
    nodes.push({
      id: "hub-activity",
      type: "magneticPanel",
      position: { x: basePosition.x + 520, y: basePosition.y },
      draggable: true,
      selectable: false,
      data: {
        label: "Recent Activity",
        iconType: "thread",
        isMain: false,
        onOpenPanel: data.onOpenPanel,
        items: data.recentActivity.map((a) => ({
          id: a.id,
          title: a.title,
          meta: `${a.type} · ${formatTimeAgo(a.timestamp)}`,
          panelType: "chat",
        })),
      } satisfies MagneticPanelData,
    });
  }

  // Focus Timer
  if (data.timerState && data.onTimerStart && data.onTimerPause && data.onTimerReset) {
    nodes.push({
      id: "hub-timer",
      type: "focusTimer",
      position: { x: basePosition.x + 520, y: basePosition.y + (data.recentActivity.length > 0 ? Math.min(data.recentActivity.length, 6) * 32 + 120 : 0) },
      draggable: true,
      selectable: false,
      data: {
        active: data.timerState.active,
        sessionMinutes: data.timerState.sessionMinutes,
        elapsed: data.timerState.elapsed,
        sessionsCompleted: data.timerState.sessionsCompleted,
        workstreamTitle: data.timerState.workstreamTitle,
        onStart: data.onTimerStart,
        onPause: data.onTimerPause,
        onReset: data.onTimerReset,
      } satisfies FocusTimerNodeData,
    });
  }

  return nodes;
}