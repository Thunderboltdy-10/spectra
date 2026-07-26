"use client";

import { MousePointer2, Sparkles, Users, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  clientRectsForSelectionRange,
  positionForPresenceAnchor,
  selectionIsActive,
} from "../collaboration/presence-anchor";
import type { CollaborationPresence } from "../collaboration/types";
import {
  actorLabel,
  describeState,
  stateIsVisible,
} from "../collaboration/interaction-model";
import type { ArtifactCommentRegion } from "./artifact-comments-panel";

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

function presenceColor(person: CollaborationPresence) {
  return person.actorKind === "ai"
    ? "var(--accent-cyan)"
    : person.color || "#6f7b72";
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
      if (block) return block;
    }
    if (kind === "address") {
      const cell = studio.querySelector<HTMLElement>(
        `[data-address="${cssEscape(id)}"]`,
      );
      if (cell) return cell;
    }
    if (kind === "region") {
      const region =
        studio.querySelector<HTMLElement>(
          `[data-region-id="${cssEscape(id)}"]`,
        ) ||
        studio.querySelector<HTMLElement>(
          `[data-spectra-region="${cssEscape(id)}"]`,
        );
      if (region) return region;
    }
    if (kind === "path") {
      const byPath = studio.querySelector<HTMLElement>(
        `[data-ai-path="${cssEscape(id)}"]`,
      );
      if (byPath) return byPath;
      const blockMatch = id.match(/\/(?:content\/)?blocks\/(?:id:)?([^/]+)/i);
      if (blockMatch) {
        const block = studio.querySelector<HTMLElement>(
          `[data-block-id="${cssEscape(decodeURIComponent(blockMatch[1]!))}"]`,
        );
        if (block) return block;
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
    if (region) return region;
  }
  // Last resort: one active AI region only — never pick among many and thrash.
  const regions = Array.from(
    studio.querySelectorAll<HTMLElement>('[data-ai-region="true"]'),
  ).filter((element) => {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  });
  if (regions.length === 1) return regions[0]!;
  return (
    regions.find((element) =>
      element.matches('input, textarea, select, [contenteditable="true"]'),
    ) ??
    regions[0] ??
    null
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
        .map(
          (person) =>
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
          }
          if (validCursor(person.cursor)) {
            next[person.clientId] = {
              left: person.cursor.x * layerRect.width,
              top: person.cursor.y * layerRect.height,
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
      className="pointer-events-none absolute inset-0 z-[66] overflow-hidden"
      aria-hidden="true"
    >
      {collaborators.map((person) => {
        const color = presenceColor(person);
        const rects = selectionRects[person.clientId] ?? [];
        return rects.map((rect, index) => (
          <div
            key={`${person.clientId}:sel:${index}`}
            className="absolute rounded-[2px]"
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
            className="absolute z-[2] min-w-[148px] overflow-hidden rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-elevated)] py-1 shadow-[0_12px_32px_rgba(20,18,15,.18)] transition-[left,top] duration-300 ease-out"
            style={{
              left: Math.max(8, position.left),
              top: position.top + 22,
              outline: `1px solid color-mix(in oklab, ${color} 35%, transparent)`,
            }}
          >
            <div
              className="px-2.5 pb-1 pt-1 text-[9px] font-semibold uppercase tracking-[0.08em]"
              style={{ color }}
            >
              {person.menu.label}
            </div>
            {person.menu.options.map((option) => {
              const active = option.value === person.menu?.highlighted;
              return (
                <div
                  key={option.value}
                  className={`px-2.5 py-1.5 text-[12px] ${active ? "font-semibold text-white" : "text-[var(--text-primary)]"}`}
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
            className={`absolute transition-[left,top] ease-out motion-reduce:transition-none ${
              person.actorKind === "ai" && mode === "pointer"
                ? "duration-300"
                : "duration-75"
            }`}
            style={{ left: position.left, top: position.top }}
          >
            {showCaret ? (
              <span
                className="ml-0 inline-block h-[1.15em] w-[2px] animate-pulse motion-reduce:animate-none"
                style={{
                  backgroundColor: color,
                  boxShadow: `0 0 8px color-mix(in oklab, ${color} 55%, transparent)`,
                }}
              />
            ) : showPointer ? (
              <MousePointer2
                className={`h-5 w-5 -translate-x-1 -translate-y-1 fill-current ${person.actorKind === "ai" ? "drop-shadow-[0_0_8px_color-mix(in_oklab,var(--accent-cyan)_70%,transparent)]" : "drop-shadow-[0_2px_3px_rgba(20,18,15,.18)]"}`}
                style={{ color }}
              />
            ) : null}
            {person.actorKind === "ai" &&
            (mode === "typing" || mode === "selecting") ? null : (
              <span
                className="ml-2 -mt-0.5 inline-flex max-w-48 items-center gap-1.5 whitespace-nowrap rounded-[6px] px-2 py-1 text-[10px] font-semibold text-white shadow-[0_5px_18px_rgba(20,18,15,.18)]"
                style={{ backgroundColor: color }}
              >
                {person.actorKind === "ai" ? (
                  <Sparkles className="h-3 w-3 animate-pulse motion-reduce:animate-none" />
                ) : null}
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
  const collaborators = useMemo(
    () =>
      presence.filter((person) => {
        if (person.clientId === currentClientId) return false;
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
    [currentClientId, presence],
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
        ? `${activeAiRegion} · line ${activeAiLine}`
        : `Line ${activeAiLine}`
      : activeAiRegion;
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label={`${collaborators.length} collaborator${collaborators.length === 1 ? "" : "s"} present`}
        className={`group flex h-9 items-center gap-2 rounded-[8px] border px-2 shadow-[0_2px_8px_rgba(27,20,12,.04)] transition ${activeAi ? "border-[color-mix(in_oklab,var(--accent-cyan)_42%,var(--border-default))] bg-[color-mix(in_oklab,var(--accent-cyan)_8%,var(--bg-primary))] hover:bg-[color-mix(in_oklab,var(--accent-cyan)_12%,var(--bg-primary))]" : "border-[var(--border-subtle)] bg-[color-mix(in_oklab,var(--bg-primary)_84%,transparent)] hover:border-[var(--border-default)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"}`}
      >
        <span className="flex -space-x-1.5">
          {collaborators.slice(0, 3).map((person) => (
            <span
              key={person.clientId}
              className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-[var(--bg-primary)] text-[7px] font-bold text-white shadow-sm"
              style={{ backgroundColor: presenceColor(person) }}
              title={presenceName(
                person,
                presence,
                currentAccountId,
                currentDisplayName,
              )}
            >
              {person.actorKind === "ai" ? (
                <Sparkles className="h-3 w-3" />
              ) : (
                initials(person.name)
              )}
            </span>
          ))}
        </span>
        <Users className="h-3.5 w-3.5 text-[var(--text-tertiary)] group-hover:text-[var(--text-secondary)]" />
        <span className="pr-1 text-[11px] font-medium text-[var(--text-secondary)]">
          {activeAiName
            ? `${activeAiName}${activeAiPlace ? ` · ${activeAiPlace}` : ""}`
            : `${activeCount || collaborators.length} here`}
        </span>
      </button>
      {open ? (
        <div className="absolute right-0 top-[calc(100%+8px)] z-[70] w-64 overflow-hidden rounded-[12px] border border-[var(--border-default)] bg-[var(--bg-elevated)] shadow-[0_18px_48px_rgba(20,18,15,.16)]">
          <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-3 py-2">
            <span className="text-[11px] font-semibold text-[var(--text-primary)]">
              In this artifact
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-[6px] p-1 text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
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
                    ? `${region} · line ${lineIndex + 1}`
                    : `Line ${lineIndex + 1}`
                  : region;
              return (
                <li key={person.clientId}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] hover:bg-[var(--bg-hover)]"
                    onClick={() => {
                      onFocusPresence?.(person);
                      setOpen(false);
                    }}
                  >
                    <span
                      className="flex h-7 w-7 items-center justify-center rounded-full text-[9px] font-bold text-white"
                      style={{ backgroundColor: presenceColor(person) }}
                    >
                      {person.actorKind === "ai" ? (
                        <Sparkles className="h-3.5 w-3.5" />
                      ) : (
                        initials(person.name)
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-[var(--text-primary)]">
                        {label}
                      </span>
                      <span className="block truncate text-[10px] text-[var(--text-tertiary)]">
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
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
