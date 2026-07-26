"use client";

import type {
  CollaborationInteraction,
  CollaborationPresence,
} from "./types";

/**
 * Shared presence publish helpers so every studio (document, deck, quiz,
 * sheets, whiteboard, …) can broadcast the same interaction vocabulary.
 * Hover pointer, focus/typing caret, selection, menu, drag, and resize should
 * all flow through this shape so AI simulation and human collaboration match.
 */
export function presenceInteractionFromFocus(input: {
  regionId: string;
  mode?: "focus" | "typing" | "selecting" | "menu" | "toggle";
  targetKind?: CollaborationInteraction["targetKind"];
  label?: string;
}): Pick<
  CollaborationPresence,
  "activeRegionId" | "interaction" | "cursor"
> {
  const mode = input.mode ?? "focus";
  const interactionKind =
    mode === "typing"
      ? "typing"
      : mode === "selecting"
        ? "selecting"
        : mode === "menu"
          ? "menu"
          : mode === "toggle"
            ? "toggle"
            : "focus";
  return {
    activeRegionId: input.regionId,
    interaction: {
      kind: interactionKind,
      targetId: input.regionId,
      ...(input.targetKind ? { targetKind: input.targetKind } : {}),
      ...(input.label ? { label: input.label } : {}),
    },
    cursor: {
      x: 0.5,
      y: 0.42,
      updatedAt: Date.now(),
      mode:
        interactionKind === "selecting"
          ? "selecting"
          : interactionKind === "typing" || interactionKind === "focus"
            ? "typing"
            : "pointer",
      anchor: {
        kind: input.targetKind ?? "region",
        id: input.regionId,
        offsetX: 0.1,
        offsetY: 0.35,
        offset: 0.1,
      },
    },
  };
}

export function presenceInteractionFromDrag(input: {
  regionId: string;
  offsetX: number;
  offsetY: number;
  kind?: "dragging" | "resizing";
}): Pick<CollaborationPresence, "activeRegionId" | "interaction" | "cursor"> {
  const kind = input.kind ?? "dragging";
  return {
    activeRegionId: input.regionId,
    interaction: {
      kind,
      targetId: input.regionId,
      targetKind: "region",
    },
    cursor: {
      x: Math.max(0, Math.min(1, input.offsetX)),
      y: Math.max(0, Math.min(1, input.offsetY)),
      updatedAt: Date.now(),
      mode: "pointer",
      anchor: {
        kind: "region",
        id: input.regionId,
        offsetX: Math.max(0, Math.min(1, input.offsetX)),
        offsetY: Math.max(0, Math.min(1, input.offsetY)),
        offset: Math.max(0, Math.min(1, input.offsetX)),
      },
    },
  };
}
