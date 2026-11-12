"use client";

import { Eye, Users, X, CornerUpLeft, EyeOff, MousePointer2 } from "@/components/icons/glyph-icons";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  clientRectsForSelectionRange,
  positionForPresenceAnchor,
  selectionIsActive,
} from "../collaboration/presence-anchor";
import type { CollaborationPresence } from "../collaboration/types";
import { follow, resumeFollow, useFollow } from "../collaboration/follow";
import { followAiActor, useFollowAi } from "../collaboration/follow-ai";
import { stableAiActorId } from "../collaboration/ai-actor-id";
import {
  actorLabel,
  describeState,
  presenceColor as actorPresenceColor,
  stateIsVisible,
} from "../collaboration/interaction-model";
import type { ArtifactCommentRegion } from "./artifact-comments-panel";

function aiActorIdForPerson(person: CollaborationPresence): string | null {
  return stableAiActorId({
    clientId: person.clientId,
    runId: person.runId ?? person.interactionState?.actor?.runId,
  });
}

function collapseCollaborators(
  people: CollaborationPresence[],
): CollaborationPresence[] {
  const rows = new Map<string, CollaborationPresence>();
  for (const person of people) {
    const key =
      person.actorKind === "ai"
        ? `ai:${aiActorIdForPerson(person) ?? person.clientId}`
        : `human:${person.clientId}`;
    const previous = rows.get(key);
    if (!previous) {
      rows.set(key, person);
      continue;
    }
    const previousAt = previous.interactionState?.at ?? 0;
    const nextAt = person.interactionState?.at ?? 0;
    if (nextAt >= previousAt) rows.set(key, person);
  }
  return [...rows.values()];
}

function initials(name?: string) {
  return (name || "?")
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function presenceName(
  person: CollaborationPresence,
  presence: CollaborationPresence[],
  currentAccountId?: string,
  currentDisplayName?: string,
) {
  if (person.actorKind !== "ai") return person.name || "Collaborator";
  // Prefer the AI peer's published identity (owner's AI). Never rename it to
  // the viewing collaborator — each AI belongs to the account that ran it.
  const published = person.name?.trim();
  if (published) return published;
  if (person.accountId && person.accountId === currentAccountId)
    return currentDisplayName ? `${currentDisplayName}'s AI` : "Your AI";
  const owner = presence.find(
    (candidate) =>
      candidate.actorKind !== "ai" &&
      candidate.accountId &&
      candidate.accountId === person.accountId,
  );
  return owner?.name ? `${owner.name}'s AI` : "A collaborator's AI";
}

function validCursor(
  cursor: CollaborationPresence["cursor"],
): cursor is NonNullable<CollaborationPresence["cursor"]> {
  return Boolean(
    cursor &&
    Number.isFinite(cursor.x) &&
    Number.isFinite(cursor.y) &&
    cursor.x >= 0 &&
    cursor.x <= 1 &&
    cursor.y >= 0 &&
    cursor.y <= 1,
  );
}

export function presenceColor(person: CollaborationPresence) {
  // An AI wears its owner's colour everywhere: "Nadia" and "Nadia's AI" are
  // visibly the same participant, never a generic cyan guest.
  if (person.interactionState) {
    return actorPresenceColor(person.interactionState.actor);
  }
  if (person.actorKind === "ai") {
    return actorPresenceColor({
      clientId: person.clientId,
      kind: "ai",
      name: person.name ?? "AI",
      ...(person.accountId ? { ownerAccountId: person.accountId } : {}),
    });
  }
  // A person resolves through the same palette as their interaction frames,
  // so their avatar, cursor and region ring are one colour. (No client
  // publishes `color`; the old fallback painted every idle human grey while
  // the interaction layer painted them in their palette colour.)
  return actorPresenceColor({
    clientId: person.clientId,
    kind: "human",
    name: person.name ?? "",
    ...(person.accountId ? { accountId: person.accountId } : {}),
  });
}

function positionsEqual(
  left: Record<string, { left: number; top: number }>,
  right: Record<string, { left: number; top: number }>,
) {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every((key) => {
    const a = left[key];
    const b = right[key];
    return (
      a &&
      b &&
      Math.abs(a.left - b.left) < 0.75 &&
      Math.abs(a.top - b.top) < 0.75
    );
  });
}

function selectionRectsEqual(
  left: Record<
    string,
    Array<{ left: number; top: number; width: number; height: number }>
  >,
  right: Record<
    string,
    Array<{ left: number; top: number; width: number; height: number }>
  >,
) {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every((key) => {
    const a = left[key] ?? [];
    const b = right[key] ?? [];
    if (a.length !== b.length) return false;
    return a.every(
      (rect, index) =>
        Math.abs(rect.left - (b[index]?.left ?? 0)) < 0.75 &&
        Math.abs(rect.top - (b[index]?.top ?? 0)) < 0.75 &&
        Math.abs(rect.width - (b[index]?.width ?? 0)) < 0.75 &&
        Math.abs(rect.height - (b[index]?.height ?? 0)) < 0.75,
    );
  });
}

function cssEscape(value: string) {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function")
    return CSS.escape(value);
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function paintableTarget(element: HTMLElement | null): HTMLElement | null {
  if (!element) return null;
  const hiddenTarget = element.closest<HTMLElement>(
    '[data-spectra-hidden-target="true"]',
  );
  if (
    hiddenTarget &&
    (!document.activeElement || !hiddenTarget.contains(document.activeElement))
  )
    return null;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 || rect.height > 0 ? element : null;
}

function resolveAiTarget(
  studio: HTMLElement,
  person: CollaborationPresence,
): HTMLElement | null {
  if (person.cursor?.anchor) {
    const { kind, id } = person.cursor.anchor;
    if (kind === "block") {
      const block = studio.querySelector<HTMLElement>(
        `[data-block-id="${cssEscape(id)}"]`,
      );
      if (paintableTarget(block)) return block;
    }
    if (kind === "address") {
      const cell = studio.querySelector<HTMLElement>(
        `[data-address="${cssEscape(id)}"]`,
      );
      if (paintableTarget(cell)) return cell;
    }
    if (kind === "region") {
      const region =
        studio.querySelector<HTMLElement>(
          `[data-region-id="${cssEscape(id)}"]`,
        ) ||
        studio.querySelector<HTMLElement>(
          `[data-spectra-region="${cssEscape(id)}"]`,
        );
      if (paintableTarget(region)) return region;
    }
    if (kind === "path") {
      // Prefer the canonical annotation, so a migrated editor needs no legacy
      // duplicate; `data-ai-path` remains only for editors not yet converted.
      const byPath =
        studio.querySelector<HTMLElement>(
          `[data-spectra-target="${cssEscape(id)}"]`,
        ) ??
        studio.querySelector<HTMLElement>(`[data-ai-path="${cssEscape(id)}"]`);
      if (paintableTarget(byPath)) return byPath;
      const blockMatch = id.match(/\/(?:content\/)?blocks\/(?:id:)?([^/]+)/i);
      if (blockMatch) {
        const block = studio.querySelector<HTMLElement>(
          `[data-block-id="${cssEscape(decodeURIComponent(blockMatch[1]!))}"]`,
        );
        if (paintableTarget(block)) return block;
      }
    }
  }
  if (person.activeRegionId) {
    const region =
      studio.querySelector<HTMLElement>(
        `[data-region-id="${cssEscape(person.activeRegionId)}"]`,
      ) ||
      studio.querySelector<HTMLElement>(
        `[data-spectra-region="${cssEscape(person.activeRegionId)}"]`,
      ) ||
      studio.querySelector<HTMLElement>(
        `[data-block-id="${cssEscape(person.activeRegionId)}"]`,
      );
    if (paintableTarget(region)) return region;
  }
  // Last resort: one active AI region only — never pick among many and thrash.
  const regions = Array.from(
    studio.querySelectorAll<HTMLElement>('[data-ai-region="true"]'),
  ).filter((element) => {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  });
  if (regions.length === 1) return paintableTarget(regions[0]!);
  return (
    paintableTarget(
      regions.find((element) =>
        element.matches('input, textarea, select, [contenteditable="true"]'),
      ) ??
        regions[0] ??
        null,
    ) ?? null
  );
}

export function CollaborationCursorLayer({
  presence,
  currentClientId,
  currentAccountId,
  currentDisplayName,
}: {
  presence: CollaborationPresence[];
  currentClientId?: string;
  currentAccountId?: string;
  currentDisplayName?: string;
}) {
  const collaborators = useMemo(
    () =>
      presence.filter(
        (person) =>
          person.clientId !== currentClientId &&
          (person.actorKind === "ai"
            ? person.previewPhase === "streaming" ||
              (person.previewPatches?.length ?? 0) > 0
            : validCursor(person.cursor) ||
              selectionIsActive(person.selection) ||
              Boolean(person.menu?.open)),
      ),
    [presence, currentClientId],
  );
  const presenceKey = useMemo(
    () =>
      collaborators
        .map((person) =>
          [
            person.clientId,
            person.activeRegionId ?? "",
            person.previewSequence ?? "",
            person.previewGesture ?? "",
            person.cursor?.mode ?? "",
            person.cursor?.anchor?.kind ?? "",
            person.cursor?.anchor?.id ?? "",
            person.cursor?.anchor?.offsetX ??
              person.cursor?.anchor?.offset ??
              "",
            person.cursor?.anchor?.offsetY ?? "",
            person.cursor?.anchor?.charOffset ?? "",
            person.cursor?.anchor?.lineIndex ?? "",
            person.cursor?.updatedAt ?? "",
            person.cursor?.x ?? "",
            person.cursor?.y ?? "",
            JSON.stringify(person.selection?.ranges ?? []),
            person.menu?.open ? "1" : "0",
            person.menu?.highlighted ?? "",
            person.interaction?.kind ?? "",
          ].join(":"),
        )
        .join("|"),
    [collaborators],
  );
  const layerRef = useRef<HTMLDivElement>(null);
  const [positions, setPositions] = useState<
    Record<string, { left: number; top: number }>
  >({});
  const [selectionRects, setSelectionRects] = useState<
    Record<
      string,
      Array<{ left: number; top: number; width: number; height: number }>
    >
  >({});
  useEffect(() => {
    if (!collaborators.length) {
      setPositions((previous) =>
        Object.keys(previous).length === 0 ? previous : {},
      );
      setSelectionRects((previous) =>
        Object.keys(previous).length === 0 ? previous : {},
      );
      return;
    }
    const layer = layerRef.current;
    const studio = layer?.closest(".spectra-artifact-studio");
    if (!layer || !(studio instanceof HTMLElement)) return;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const next: Record<string, { left: number; top: number }> = {};
        const nextSelections: Record<
          string,
          Array<{ left: number; top: number; width: number; height: number }>
        > = {};
        const layerRect = layer.getBoundingClientRect();
        for (const person of collaborators) {
          if (selectionIsActive(person.selection)) {
            const rects = person.selection!.ranges.flatMap((range) =>
              clientRectsForSelectionRange(studio, range).map((rect) => ({
                left: rect.left - layerRect.left,
                top: rect.top - layerRect.top,
                width: Math.max(rect.width, 2),
                height: rect.height,
              })),
            );
            if (rects.length) nextSelections[person.clientId] = rects;
          } else if (
            person.selection?.kind === "text" &&
            person.selection.collapsed &&
            person.selection.ranges[0]
          ) {
            // Collapsed caret: still resolve exact glyph position for the bar.
            const range = person.selection.ranges[0]!;
            const rects = clientRectsForSelectionRange(studio, range);
            if (rects[0]) {
              next[person.clientId] = {
                left: Math.max(4, rects[0].left - layerRect.left),
                top: Math.max(4, rects[0].top - layerRect.top),
              };
            }
          }
          if (person.actorKind === "ai") {
            if (next[person.clientId]) continue;
            if (person.cursor?.anchor) {
              const anchored = positionForPresenceAnchor(
                layer,
                studio,
                person.cursor,
              );
              if (anchored) {
                next[person.clientId] = anchored;
                continue;
              }
            }
            const target = resolveAiTarget(studio, person);
            if (target) {
              const targetRect = target.getBoundingClientRect();
              const studioRect = studio.getBoundingClientRect();
              if (
                targetRect.right <= studioRect.left ||
                targetRect.left >= studioRect.right ||
                targetRect.bottom <= studioRect.top ||
                targetRect.top >= studioRect.bottom
              )
                continue;
              const charOffset =
                typeof person.cursor?.anchor?.charOffset === "number"
                  ? person.cursor.anchor.charOffset
                  : undefined;
              if (
                charOffset !== undefined &&
                person.cursor?.anchor?.kind === "block"
              ) {
                const anchored = positionForPresenceAnchor(
                  layer,
                  studio,
                  person.cursor,
                );
                if (anchored) {
                  next[person.clientId] = anchored;
                  continue;
                }
              }
              next[person.clientId] = {
                left: Math.max(
                  12,
                  Math.min(
                    layerRect.width - 24,
                    targetRect.left - layerRect.left + 4,
                  ),
                ),
                top: Math.max(
                  14,
                  Math.min(
                    layerRect.height - 42,
                    targetRect.top - layerRect.top + 4,
                  ),
                ),
              };
              continue;
            }
          }
          if (next[person.clientId]) continue;
          if (person.cursor?.anchor) {
            const anchored = positionForPresenceAnchor(
              layer,
              studio,
              person.cursor,
            );
            if (anchored) {
              next[person.clientId] = anchored;
              continue;
            }
            // A semantic anchor that is collapsed, on another slide/sheet, or
            // outside this peer's scroll viewport has no honest in-editor
            // position. Keep the actor in the collaboration surface only;
            // never fall back to normalized remote coordinates or edge-pin it.
            continue;
          }
          if (validCursor(person.cursor)) {
            next[person.clientId] = {
              // Different pane widths can legitimately put the collaborator at
              // the very edge of this viewport. Keep the body exact enough to
              // convey direction, but inset it so the cursor and name do not
              // disappear beneath the layer's clipping boundary.
              left: Math.max(
                12,
                Math.min(
                  layerRect.width - 24,
                  person.cursor.x * layerRect.width,
                ),
              ),
              top: Math.max(
                14,
                Math.min(
                  layerRect.height - 34,
                  person.cursor.y * layerRect.height,
                ),
              ),
            };
          }
        }
        setPositions((previous) =>
          positionsEqual(previous, next) ? previous : next,
        );
        setSelectionRects((previous) =>
          selectionRectsEqual(previous, nextSelections)
            ? previous
            : nextSelections,
        );
      });
    };
    update();
    const observer = new MutationObserver(update);
    observer.observe(studio, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: [
        "data-ai-region",
        "data-block-id",
        "data-address",
        "data-region-id",
      ],
    });
    studio.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      studio.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [collaborators, presenceKey]);
  if (!collaborators.length) return null;

  return (
    <div
      ref={layerRef}
      className="pointer-events-none absolute inset-0 z-dropdown overflow-hidden"
      aria-hidden="true"
    >
      {collaborators.map((person) => {
        const color = presenceColor(person);
        const rects = selectionRects[person.clientId] ?? [];
        return rects.map((rect, index) => (
          <div
            key={`${person.clientId}:sel:${index}`}
            className="absolute rounded-chip"
            style={{
              left: rect.left,
              top: rect.top,
              width: rect.width,
              height: rect.height,
              backgroundColor: `color-mix(in oklab, ${color} 28%, transparent)`,
              outline: `1px solid color-mix(in oklab, ${color} 45%, transparent)`,
            }}
          />
        ));
      })}
      {collaborators.map((person) => {
        if (!person.menu?.open) return null;
        const position = positions[person.clientId];
        if (!position) return null;
        const color = presenceColor(person);
        return (
          <div
            key={`${person.clientId}:menu`}
            className="absolute left-0 top-0 z-chrome min-w-[148px] overflow-hidden rounded-control border border-[var(--border-default)] bg-[var(--bg-elevated)] py-1 shadow-card transition-transform duration-[var(--motion-slow)] ease-standard motion-reduce:transition-none"
            style={{
              transform: `translate3d(${Math.max(8, position.left)}px, ${position.top + 22}px, 0)`,
              outline: `1px solid color-mix(in oklab, ${color} 35%, transparent)`,
            }}
          >
            <div
              className="px-2.5 pb-1 pt-1 text-micro font-semibold "
              style={{ color }}
            >
              {person.menu.label}
            </div>
            {person.menu.options.map((option) => {
              const active = option.value === person.menu?.highlighted;
              return (
                <div
                  key={option.value}
                  className={`px-2.5 py-1.5 text-caption ${active ? "font-semibold text-white" : "text-[var(--text-primary)]"}`}
                  style={
                    active
                      ? {
                          backgroundColor: color,
                        }
                      : undefined
                  }
                >
                  {option.label}
                </div>
              );
            })}
          </div>
        );
      })}
      {collaborators.map((person) => {
        const name = presenceName(
          person,
          presence,
          currentAccountId,
          currentDisplayName,
        );
        const color = presenceColor(person);
        const position = positions[person.clientId];
        if (!position) return null;
        const mode =
          person.cursor?.mode ??
          (person.interaction?.kind === "typing" ||
          person.interaction?.kind === "focus"
            ? "typing"
            : person.interaction?.kind === "selecting" ||
                person.previewGesture === "erasing" ||
                person.previewGesture === "selecting"
              ? "selecting"
              : person.actorKind === "ai" && person.previewPhase === "streaming"
                ? "typing"
                : "pointer");
        const showPointer = mode === "pointer";
        const showCaret =
          mode === "typing" ||
          mode === "selecting" ||
          person.interaction?.kind === "focus";
        return (
          <div
            key={person.clientId}
            // Moved by transform, not left/top: a glide is compositor-only and
            // never re-lays out the layer. A human cursor tracks nearly live;
            // an AI pointer glides so its jumps between targets read as travel.
            className={`absolute left-0 top-0 transition-transform ease-standard motion-reduce:transition-none ${
              person.actorKind === "ai" && mode === "pointer"
                ? "duration-[var(--motion-slow)]"
                : "duration-[var(--motion-instant)]"
            }`}
            style={{
              transform: `translate3d(${position.left}px, ${position.top}px, 0)`,
            }}
          >
            {showCaret ? (
              <span
                className="ml-0 inline-block h-[1.22em] w-[3px] rounded-full animate-pulse motion-reduce:animate-none"
                style={{
                  backgroundColor: color,
                  boxShadow: `0 0 8px color-mix(in oklab, ${color} 55%, transparent)`,
                }}
              />
            ) : showPointer ? (
              <MousePointer2
                strokeWidth={2.35}
                className="h-6 w-6 -translate-x-1.5 -translate-y-1.5 scale-x-[1.12] fill-current drop-shadow-[0_2px_4px_rgba(20,18,15,.22)]"
                style={{ color }}
              />
            ) : null}
            {person.actorKind === "ai" &&
            (mode === "typing" || mode === "selecting") ? null : (
              <span
                className="ml-2 -mt-0.5 inline-flex max-w-48 items-center gap-1.5 whitespace-nowrap rounded-chip px-2 py-1 text-micro font-semibold text-white shadow-card"
                style={{ backgroundColor: color }}
              >
                {name}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function CollaborationPresenceIndicator({
  presence,
  currentClientId,
  currentAccountId,
  currentDisplayName,
  regions,
  onFocusPresence,
}: {
  presence: CollaborationPresence[];
  currentClientId?: string;
  currentAccountId?: string;
  currentDisplayName?: string;
  regions: readonly ArtifactCommentRegion[];
  onFocusPresence?: (person: CollaborationPresence) => void;
}) {
  const [open, setOpen] = useState(false);
  const followState = useFollow();
  const followAi = useFollowAi();
  const collaborators = useMemo(
    () =>
      collapseCollaborators(
        presence.filter((person) => {
          if (person.clientId === currentClientId || (person.actorKind !== "ai" && currentAccountId && person.accountId === currentAccountId)) return false;
          // Idle AI peers after a run must not linger as permanent avatars —
          // only show them while they are actively streaming or pointing.
          if (person.actorKind === "ai") {
            if (person.interactionState)
              return stateIsVisible(person.interactionState);
            return (
              person.previewPhase === "streaming" ||
              (person.previewPatches?.length ?? 0) > 0
            );
          }
          return true;
        }),
      ),
    [currentAccountId, currentClientId, presence],
  );
  if (collaborators.length === 0) return null;
  const regionNames = new Map(
    regions.map((region) => [region.regionId, region.label]),
  );
  const activeCount = collaborators.filter(
    (person) =>
      person.activeRegionId ||
      validCursor(person.cursor) ||
      selectionIsActive(person.selection),
  ).length;
  const activeAi = collaborators.find(
    (person) =>
      person.actorKind === "ai" &&
      (person.interactionState
        ? stateIsVisible(person.interactionState)
        : person.previewPhase === "streaming" ||
          (person.previewPatches?.length ?? 0) > 0),
  );
  const activeAiName = activeAi
    ? presenceName(activeAi, presence, currentAccountId, currentDisplayName)
    : null;
  const activeAiLine =
    typeof activeAi?.cursor?.anchor?.lineIndex === "number"
      ? activeAi.cursor.anchor.lineIndex + 1
      : typeof activeAi?.selection?.ranges[0]?.lineIndex === "number"
        ? activeAi.selection.ranges[0]!.lineIndex + 1
        : null;
  const activeAiRegion = activeAi?.activeRegionId
    ? (regionNames.get(activeAi.activeRegionId) ?? null)
    : null;
  // A semantic frame names the control and the act; the line/region fallback is
  // only for peers still on the coarse protocol.
  const activeAiPlace = activeAi?.interactionState
    ? describeState(activeAi.interactionState)
    : activeAiLine != null
      ? activeAiRegion
        ? `${activeAiRegion}, line ${activeAiLine}`
        : `Line ${activeAiLine}`
      : activeAiRegion;
  const activeAiColor = activeAi ? presenceColor(activeAi) : null;
  const followedTarget =
    followState.target && followState.target.kind !== "ai"
      ? followState.target
      : null;
  const followedPerson = followedTarget
    ? (collaborators.find(
        (person) =>
          person.clientId === (followedTarget as { clientId: string }).clientId,
      ) ?? null)
    : null;
  const disengagedFrom = followState.disengagedFrom;
  return (
    <div className="relative flex items-center gap-1.5">
      {followedTarget ? (
        <button
          type="button"
          data-spectra-follow-control=""
          onClick={() => followState.disengage("explicit")}
          className="spectra-follow-chip flex h-9 items-center gap-1.5 rounded-full border pl-2 pr-2.5 text-micro font-semibold"
          style={{
            borderColor: followedPerson
              ? `color-mix(in oklab, ${presenceColor(followedPerson)} 45%, var(--border-default))`
              : "var(--border-default)",
            backgroundColor: followedPerson
              ? `color-mix(in oklab, ${presenceColor(followedPerson)} 7%, var(--bg-primary))`
              : "var(--bg-hover)",
            color: "var(--text-secondary)",
          }}
          title="Stop following"
        >
          <span
            className="spectra-follow-chip-dot h-1.5 w-1.5 rounded-full"
            style={{
              backgroundColor: followedPerson
                ? presenceColor(followedPerson)
                : "var(--text-tertiary)",
            }}
          />
          <span className="max-w-32 truncate">
            Following{" "}
            <span className="text-[var(--text-primary)]">
              {(followedTarget as { label: string }).label}
            </span>
          </span>
          <X className="h-3 w-3 text-[var(--text-tertiary)]" />
        </button>
      ) : null}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={`${collaborators.length} collaborator${collaborators.length === 1 ? "" : "s"} present`}
            className={`group flex h-9 items-center gap-2 rounded-control border px-2 shadow-[var(--shadow-sm)] transition ${activeAi ? "" : "border-[var(--border-subtle)] bg-[color-mix(in_oklab,var(--bg-primary)_84%,transparent)] hover:border-[var(--border-default)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"}`}
            style={
              activeAiColor
                ? {
                    borderColor: `color-mix(in oklab, ${activeAiColor} 38%, var(--border-default))`,
                    backgroundColor: `color-mix(in oklab, ${activeAiColor} 6%, var(--bg-primary))`,
                  }
                : undefined
            }
          >
            <span className="flex -space-x-1.5">
              {collaborators.slice(0, 3).map((person) => (
                <span
                  key={person.clientId}
                  className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-[var(--bg-primary)] text-micro font-bold text-white shadow-sm"
                  style={{ backgroundColor: presenceColor(person) }}
                  title={presenceName(
                    person,
                    presence,
                    currentAccountId,
                    currentDisplayName,
                  )}
                >
                  {person.actorKind === "ai" ? (
                    "AI"
                  ) : (
                    initials(person.name)
                  )}
                </span>
              ))}
            </span>
            {activeAiName ? null : (
              <Users className="h-3.5 w-3.5 text-[var(--text-tertiary)] group-hover:text-[var(--text-secondary)]" />
            )}
            {/* The work's title comes first: what the AI is doing gives way. */}
            <span className="flex min-w-0 max-w-[13rem] items-baseline pr-1 text-micro font-medium text-[var(--text-secondary)]">
              <span className="shrink-0">{activeAiName ?? `${activeCount || collaborators.length} here`}</span>
              {activeAiName && activeAiPlace ? <span className="spectra-presence-place ml-1.5 min-w-0 truncate font-normal text-[var(--text-tertiary)]">{activeAiPlace}</span> : null}
            </span>
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          sideOffset={8}
          layer="panel"
          aria-label="People here"
          className="w-64 overflow-hidden p-0"
        >
          <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-3 py-2">
            <span className="text-micro font-semibold text-[var(--text-primary)]">
              People here
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-chip p-1 text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
              aria-label="Close collaborators"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <ul className="max-h-64 overflow-auto py-1">
            {collaborators.map((person) => {
              const label = person.interactionState
                ? actorLabel(person.interactionState.actor)
                : presenceName(
                    person,
                    presence,
                    currentAccountId,
                    currentDisplayName,
                  );
              const lineIndex =
                person.cursor?.anchor?.lineIndex ??
                person.selection?.ranges[0]?.lineIndex;
              const region = person.activeRegionId
                ? (regionNames.get(person.activeRegionId) ?? null)
                : null;
              const place =
                typeof lineIndex === "number"
                  ? region
                    ? `${region}, line ${lineIndex + 1}`
                    : `Line ${lineIndex + 1}`
                  : region;
              const followable = person.interactionState != null;
              const aiActorId =
                person.actorKind === "ai" ? aiActorIdForPerson(person) : null;
              const isFollowed =
                person.actorKind === "ai"
                  ? Boolean(
                      followAi.following &&
                      aiActorId &&
                      followAi.followedActorId === aiActorId,
                    )
                  : followedTarget != null &&
                    (followedTarget as { clientId: string }).clientId ===
                      person.clientId;
              return (
                <li
                  key={person.clientId}
                  className="group/row flex items-center hover:bg-[var(--bg-hover)]"
                >
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left text-caption"
                    onClick={() => {
                      onFocusPresence?.(person);
                      setOpen(false);
                    }}
                    title="Show where they are"
                  >
                    <span
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-micro font-bold text-white"
                      style={{ backgroundColor: presenceColor(person) }}
                    >
                      {person.actorKind === "ai" ? (
                        "AI"
                      ) : (
                        initials(person.name)
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-[var(--text-primary)]">
                        {label}
                      </span>
                      <span className="block truncate text-micro text-[var(--text-tertiary)]">
                        {person.interactionState
                          ? describeState(person.interactionState)
                          : place
                            ? `At ${place}`
                            : selectionIsActive(person.selection)
                              ? "Selecting text"
                              : validCursor(person.cursor)
                                ? "Viewing"
                                : "Present"}
                      </span>
                    </span>
                  </button>
                  {followable ? (
                    <button
                      type="button"
                      data-spectra-follow-control=""
                      className={`spectra-follow-row-action mx-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-control border transition ${
                        isFollowed
                          ? "border-[color-mix(in_oklab,var(--brand-primary)_35%,var(--border-default))] bg-[color-mix(in_oklab,var(--brand-primary)_8%,var(--bg-primary))] text-[var(--brand-primary)]"
                          : "border-transparent text-[var(--text-tertiary)] hover:border-[var(--border-subtle)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] max-lg:opacity-100 lg:opacity-0 lg:group-hover/row:opacity-100 lg:group-focus-within/row:opacity-100"
                      }`}
                      aria-label={
                        isFollowed
                          ? `Stop following ${label}`
                          : `Follow ${label}`
                      }
                      aria-pressed={isFollowed}
                      title={
                        isFollowed
                          ? `Stop following ${label}`
                          : `Follow ${label}`
                      }
                      onClick={() => {
                        if (isFollowed) {
                          if (person.actorKind === "ai") followAiActor(null);
                          else followState.disengage("explicit");
                        } else if (person.actorKind === "ai" && aiActorId) {
                          followAiActor(aiActorId);
                        } else {
                          follow({
                            kind: "collaborator",
                            clientId: person.clientId,
                            label,
                          });
                        }
                        setOpen(false);
                      }}
                    >
                      {isFollowed ? (
                        <EyeOff className="h-3.5 w-3.5" />
                      ) : (
                        <Eye className="h-3.5 w-3.5" />
                      )}
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </PopoverContent>
      </Popover>
      {disengagedFrom && disengagedFrom.kind !== "ai" ? (
        <button
          type="button"
          data-spectra-follow-control=""
          onClick={() => {
            resumeFollow();
          }}
          className="spectra-return-pill spectra-composer-above fixed left-1/2 z-panel flex -translate-x-1/2 items-center gap-2 rounded-full border border-[color-mix(in_oklab,var(--brand-primary)_30%,var(--border-default))] bg-[color-mix(in_oklab,var(--bg-elevated)_92%,transparent)] py-1.5 pl-2.5 pr-3 text-caption font-medium text-[var(--text-secondary)] shadow-card backdrop-blur-md transition hover:border-[color-mix(in_oklab,var(--brand-primary)_45%,var(--border-default))] hover:text-[var(--text-primary)]"
        >
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[color-mix(in_oklab,var(--brand-primary)_12%,transparent)] text-[var(--brand-primary)]">
            <CornerUpLeft className="h-3 w-3" />
          </span>
          Return to{" "}
          <span className="font-semibold text-[var(--text-primary)]">
            {disengagedFrom.kind === "presenter"
              ? `${disengagedFrom.label}'s presentation`
              : disengagedFrom.label}
          </span>
        </button>
      ) : null}
    </div>
  );
}
