import { MessageSquare, Maximize2, ZoomIn, ZoomOut } from "lucide-react";
import type { CommandBinding } from "../types";

/**
 * Zoom, written once. A percentage readout belongs in `trailing`; the two steps
 * and the reset belong in the registry so they can be pinned and driven by AI.
 */
export type ZoomAdapter = {
  zoom: number;
  setZoom: (zoom: number) => void;
  min?: number;
  max?: number;
  step?: number;
  /** Fit-to-width or fit-to-slide, when the type has one. */
  fit?: { label: string; run: () => void; hint?: string };
};

export function zoomBindings(adapter: ZoomAdapter): CommandBinding[] {
  const min = adapter.min ?? 0.5;
  const max = adapter.max ?? 3;
  const step = adapter.step ?? 0.1;
  const round = (value: number) => Math.round(value * 100) / 100;
  const bindings: CommandBinding[] = [
    {
      id: "view.zoom.in",
      label: "Zoom in",
      icon: ZoomIn,
      priority: "secondary",
      tab: "General",
      group: "View",
      disabled: adapter.zoom >= max || undefined,
      hint: `${Math.round(adapter.zoom * 100)}%`,
      undo: "none(explain)",
      onSelect: () => adapter.setZoom(round(Math.min(max, adapter.zoom + step))),
    },
    {
      id: "view.zoom.out",
      label: "Zoom out",
      icon: ZoomOut,
      priority: "secondary",
      tab: "General",
      group: "View",
      disabled: adapter.zoom <= min || undefined,
      hint: `${Math.round(adapter.zoom * 100)}%`,
      undo: "none(explain)",
      onSelect: () => adapter.setZoom(round(Math.max(min, adapter.zoom - step))),
    },
    {
      id: "view.zoom.reset",
      label: "Reset zoom",
      icon: Maximize2,
      priority: "advanced",
      tab: "General",
      group: "View",
      disabled: Math.abs(adapter.zoom - 1) < 0.001 || undefined,
      // The hint is also the disabled reason, so it has to read correctly in
      // both states. Reset lives in the overflow menu, where a bare label has
      // no icon and no neighbours to explain it.
      hint: Math.abs(adapter.zoom - 1) < 0.001
        ? "Already at 100%."
        : `Back to 100% from ${Math.round(adapter.zoom * 100)}%.`,
      undo: "none(explain)",
      onSelect: () => adapter.setZoom(1),
    },
  ];
  if (adapter.fit) {
    const fit = adapter.fit;
    bindings.push({
      id: "view.zoom.fit",
      label: fit.label,
      icon: Maximize2,
      priority: "advanced",
      tab: "General",
      group: "View",
      hint: fit.hint ?? "Scales the view to the window. Nothing in the file changes.",
      undo: "none(explain)",
      onSelect: () => fit.run(),
    });
  }
  return bindings;
}

/**
 * The comments entry point. Threads themselves live in the shared artifact
 * shell; what was missing was a *command*, so a reviewer could pin it, reach it
 * by keyboard, and have the AI open the same panel a person opens.
 */
export type CommentsAdapter = {
  toggle: () => void;
  open?: boolean;
  openCount?: number;
  /** Set when native comment parts are preserved rather than editable. */
  preservedNote?: string;
};

export function commentsBinding(adapter: CommentsAdapter): CommandBinding {
  return {
    id: "review.comments",
    label: "Comments",
    icon: MessageSquare,
    priority: "secondary",
    general: true,
    group: "Review",
    active: adapter.open,
    hint: adapter.preservedNote
      ? adapter.preservedNote
      : adapter.openCount
        ? `${adapter.openCount} open`
        : "Comment threads on this work",
    touches: ["comments"],
    onSelect: () => adapter.toggle(),
  };
}
