"use client";

/**
 * Smallest-scope control ownership, at presentation time.
 *
 * Durable contention already exists below this layer: semantic region claims
 * decide who is allowed to *write*. But a claim is acquired at commit time, so
 * on its own it lets two actors spend several seconds typing into the same
 * field before one of them loses. This module closes that window at the only
 * place it is visible — the control itself.
 *
 * The rule is the one humans already use with each other: while an actor is
 * actively operating an exact control, that control is theirs. Everything else
 * in the artifact stays fully usable. A held control is never disabled for the
 * whole card, question, slide or table; only the input, cell, toggle or object
 * that is genuinely busy.
 *
 * Ownership is derived from the frames the fabric already publishes, so humans
 * and AI are governed by identical rules and neither needs special handling.
 */

import { useEffect, useMemo } from "react";
import {
  actIsDrag,
  actIsMenu,
  actIsMutation,
  actIsResize,
  actorLabel,
  canonicalPath,
  TERMINAL_LIFECYCLES,
  type InteractionState,
} from "./interaction-model";
import { TARGET_ATTRIBUTE } from "./interaction-geometry";

/** Marks a control another actor is currently operating. */
export const HELD_ATTRIBUTE = "data-spectra-held";
/** Carries the holder's name so the affordance can explain itself. */
export const HELD_BY_ATTRIBUTE = "data-spectra-held-by";

export type HeldControl = {
  /** Canonical content path of the exact control being held. */
  path: string;
  /** Display name of the holder, e.g. "Pablo's AI". */
  label: string;
  kind: "human" | "ai";
};

/**
 * Acts that constitute *acquisition*. Hovering over a field or resting a cursor
 * near it claims nothing; a caret, a selection, an open menu, a live drag or an
 * actual mutation does. Getting this line right is what keeps the guard from
 * feeling like the artifact locks up whenever a peer's pointer drifts past.
 */
function actHolds(state: InteractionState): boolean {
  const act = state.act;
  if (act.kind === "hover" || act.kind === "idle") return false;
  return (
    act.kind === "caret" ||
    act.kind === "select" ||
    act.kind === "focus" ||
    act.kind === "press" ||
    actIsMenu(act) ||
    actIsDrag(act) ||
    actIsResize(act) ||
    actIsMutation(act)
  );
}

/**
 * The controls remote actors are holding right now.
 *
 * A frame stops holding as soon as it settles: committed work is ordinary
 * content, and a control that stayed locked after the change landed would be
 * the residue this system exists to avoid.
 */
export function heldControlsFrom(
  states: readonly InteractionState[],
  localClientId?: string,
): Map<string, HeldControl> {
  const held = new Map<string, HeldControl>();
  for (const state of states) {
    if (state.actor.clientId === localClientId) continue;
    if (!state.target) continue;
    if (TERMINAL_LIFECYCLES.has(state.lifecycle)) continue;
    // A blocked or queued peer is waiting for a control, not holding one.
    if (state.lifecycle === "blocked" || state.lifecycle === "queued") continue;
    if (!actHolds(state)) continue;
    const path = canonicalPath(state.target.path);
    // First frame wins, so two actors racing the same control cannot flicker
    // the affordance between their two names.
    if (held.has(path)) continue;
    held.set(path, {
      path,
      label: actorLabel(state.actor),
      kind: state.actor.kind,
    });
  }
  return held;
}

/** Copy for the restrained explanation shown when an edit is declined. */
export function heldExplanation(held: HeldControl): string {
  return `${held.label} is editing this — your other changes are unaffected`;
}

/** Fired when the local user's edit to a held control was declined. */
export const HELD_DECLINED_EVENT = "spectra:held-control";

export type HeldDeclinedDetail = {
  path: string;
  label: string;
  message: string;
};

/**
 * Apply the guard to a live editor surface.
 *
 * Annotating the DOM rather than threading a prop through ten editors is
 * deliberate: every control already declares its own path, so ownership can be
 * enforced exactly where it is true without each artifact reimplementing it.
 *
 * The guard never takes focus away from the local user. If they are already
 * inside a control when a peer starts operating it, they keep it and the peer's
 * durable write is the one that has to queue — losing your caret mid-sentence
 * because a run reached your paragraph would be far worse than a late conflict.
 */
export function useHeldControlGuard(input: {
  states: readonly InteractionState[];
  localClientId?: string;
  surfaceRef: React.RefObject<HTMLElement | null>;
  enabled?: boolean;
}): Map<string, HeldControl> {
  const { states, localClientId, surfaceRef, enabled = true } = input;

  const held = useMemo(
    () => (enabled ? heldControlsFrom(states, localClientId) : new Map()),
    [states, localClientId, enabled],
  );

  const heldKey = useMemo(
    () =>
      [...held.values()]
        .map((entry) => `${entry.path}~${entry.label}`)
        .sort()
        .join("|"),
    [held],
  );

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;

    const marked: HTMLElement[] = [];
    for (const entry of held.values()) {
      let element: HTMLElement | null = null;
      try {
        element = surface.querySelector<HTMLElement>(
          `[${TARGET_ATTRIBUTE}="${cssEscape(entry.path)}"]`,
        );
      } catch {
        element = null;
      }
      if (!element) continue;
      // Never contest a control the user is already inside.
      if (element.contains(document.activeElement)) continue;
      element.setAttribute(HELD_ATTRIBUTE, entry.kind);
      element.setAttribute(HELD_BY_ATTRIBUTE, entry.label);
      marked.push(element);
    }

    /**
     * Decline the keystroke, not the session. `beforeinput` is the last moment
     * before the value changes and the narrowest thing we can refuse: the user
     * keeps focus, keeps their selection, and can carry on anywhere else.
     */
    const declineInput = (event: Event) => {
      const node = event.target;
      if (!(node instanceof HTMLElement)) return;
      const control = node.closest<HTMLElement>(`[${HELD_ATTRIBUTE}]`);
      if (!control) return;
      const path = control.getAttribute(TARGET_ATTRIBUTE) ?? "";
      const entry = held.get(canonicalPath(path));
      if (!entry) return;
      event.preventDefault();
      window.dispatchEvent(
        new CustomEvent<HeldDeclinedDetail>(HELD_DECLINED_EVENT, {
          detail: {
            path: entry.path,
            label: entry.label,
            message: heldExplanation(entry),
          },
        }),
      );
    };

    /**
     * Toggles, radios and selects never fire `beforeinput` — they flip on the
     * click itself, and a flip is atomic, so there is no later moment to
     * refuse. Text controls are deliberately excluded: clicking one only
     * places a caret, and taking that away would stop the user reading along.
     */
    const declineAtomicPress = (event: Event) => {
      const node = event.target;
      if (!(node instanceof HTMLElement)) return;
      const control = node.closest<HTMLElement>(`[${HELD_ATTRIBUTE}]`);
      if (!control || !isAtomicControl(control)) return;
      const path = control.getAttribute(TARGET_ATTRIBUTE) ?? "";
      const entry = held.get(canonicalPath(path));
      if (!entry) return;
      event.preventDefault();
      event.stopPropagation();
      window.dispatchEvent(
        new CustomEvent<HeldDeclinedDetail>(HELD_DECLINED_EVENT, {
          detail: {
            path: entry.path,
            label: entry.label,
            message: heldExplanation(entry),
          },
        }),
      );
    };

    surface.addEventListener("beforeinput", declineInput, true);
    surface.addEventListener("click", declineAtomicPress, true);

    return () => {
      surface.removeEventListener("beforeinput", declineInput, true);
      surface.removeEventListener("click", declineAtomicPress, true);
      for (const element of marked) {
        element.removeAttribute(HELD_ATTRIBUTE);
        element.removeAttribute(HELD_BY_ATTRIBUTE);
      }
    };
  }, [heldKey, held, surfaceRef]);

  return held;
}

/** Controls whose whole value changes in one press, with no editing window. */
const ATOMIC_ROLES = new Set([
  "checkbox",
  "radio",
  "switch",
  "combobox",
  "listbox",
  "menuitemcheckbox",
  "menuitemradio",
]);

function isAtomicControl(element: HTMLElement): boolean {
  const role = element.getAttribute("role");
  if (role && ATOMIC_ROLES.has(role)) return true;
  if (element instanceof HTMLSelectElement) return true;
  if (element instanceof HTMLInputElement) {
    return element.type === "checkbox" || element.type === "radio";
  }
  return false;
}

function cssEscape(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function")
    return CSS.escape(value);
  return value.replace(/["\\]/g, "\\$&");
}
