"use client";

import { useEffect, useRef, type RefObject } from "react";
import { heroState } from "../scene/heroState";
import { onStoryFrame } from "../story/story-clock";

/**
 * Where the one true prism is, right now.
 *
 * There is a single 3D prism on the page. It is never re-instantiated per
 * section and never faded out and back in somewhere else — it is *carried*.
 * Any element can claim it by publishing a slot: a box, measured live, that
 * says "the object belongs here, this wide, at this angle".
 *
 * Slots are measured every frame from the DOM, so the object survives
 * scrolling, resizing, font loading and layout changes without a single
 * cached coordinate. Claims are priority-ordered: a scene's hero slot outranks
 * the ambient one, and the final dock outranks everything.
 */

export type PrismSlotSpec = {
  /** Fraction of the element's width the prism should read as. Default 1. */
  fill?: number;
  /** Absolute prism width in CSS px. Wins over `fill`. */
  width?: number;
  /** Travel rate toward this slot. Lower is slower and more deliberate. */
  lambda?: number;
  /** Centre offset, in fractions of the element box. */
  ox?: number;
  oy?: number;
  /** Authored orientation (YXZ euler, radians) while this slot holds it. */
  pose?: readonly [number, number, number];
  /** How much authority the authored pose has over the idle drift, 0..1. */
  poseWeight?: number;
  /** Claim it: while held, the visitor cannot counter-drag the object. */
  owned?: boolean;
  /**
   * Put the object in front of the page rather than behind it. Ambient scenes
   * let real work sit over the glass; the final dock is in the hand.
   */
  front?: boolean;
};

type Claim = {
  element: HTMLElement;
  priority: number;
  /** Read live every frame, so retuning a slot never re-registers it. */
  spec: { current: PrismSlotSpec };
};

const claims = new Map<number, Claim>();
let stop: (() => void) | null = null;
let nextId = 1;

/**
 * Whether the object is anywhere near the viewport.
 *
 * The prism layer is a fixed full-screen canvas, so it always "intersects" and
 * an IntersectionObserver on it can never say anything useful. The honest test
 * is the slot itself: the object is somewhere specific in viewport pixels every
 * frame, and when that somewhere is off-screen the GPU has nothing to draw.
 */
export const prismVisibility = { onScreen: true };

export type PrismClaimCandidate<T> = {
  id: number;
  priority: number;
  rect: Pick<DOMRect, "left" | "right" | "top" | "bottom" | "width" | "height">;
  value: T;
};

/** Pick among claims the visitor can actually see; priority is local to view. */
export function choosePrismClaim<T>(
  candidates: readonly PrismClaimCandidate<T>[],
  viewport: { width: number; height: number },
): T | null {
  const margin = 160;
  let best: PrismClaimCandidate<T> | null = null;
  for (const candidate of candidates) {
    const { rect } = candidate;
    if (rect.width <= 0.5 || rect.height <= 0.5) continue;
    const near =
      rect.right >= -margin &&
      rect.bottom >= -margin &&
      rect.left <= viewport.width + margin &&
      rect.top <= viewport.height + margin;
    if (!near) continue;
    if (
      !best ||
      candidate.priority > best.priority ||
      (candidate.priority === best.priority && candidate.id > best.id)
    )
      best = candidate;
  }
  return best?.value ?? null;
}

function leadClaim(): Claim | null {
  const candidates: PrismClaimCandidate<Claim>[] = [];
  for (const [id, claim] of claims) {
    if (!claim.element.isConnected || claim.element.offsetWidth === 0) continue;
    candidates.push({
      id,
      priority: claim.priority,
      rect: claim.element.getBoundingClientRect(),
      value: claim,
    });
  }
  return choosePrismClaim(candidates, {
    width: window.innerWidth,
    height: window.innerHeight,
  });
}

function measure() {
  const claim = leadClaim();
  if (claim) {
    const rect = claim.element.getBoundingClientRect();
    if (rect.width > 0.5 && rect.height > 0.5) {
      const spec = claim.spec.current;
      const slot = heroState.slot;
      slot.x = rect.left + rect.width * (0.5 + (spec.ox ?? 0));
      slot.y = rect.top + rect.height * (0.5 + (spec.oy ?? 0));
      slot.w = spec.width ?? rect.width * (spec.fill ?? 1);
      slot.lambda = spec.lambda ?? 3.4;
      heroState.owned = spec.owned ?? false;
      heroState.front = spec.front ?? false;
      if (spec.pose) {
        heroState.pose.euler.set(
          spec.pose[0],
          spec.pose[1],
          spec.pose[2],
          "YXZ",
        );
        heroState.pose.weight = spec.poseWeight ?? 1;
      } else {
        heroState.pose.weight = spec.poseWeight ?? 0;
      }
    }
  } else {
    /* Nobody is claiming it. The object holds its last pose rather than
       collapsing to the origin — an unclaimed prism is still a real object. */
    heroState.slot.w = 0;
    heroState.owned = false;
  }

  /* Rendering is gated on the object being somewhere the visitor could see.
     The margin is generous — the glass is still travelling toward this slot,
     and a prism that popped into existence at the viewport edge would undo the
     one thing this whole system exists to sell: that it is the same object. */
  const slot = heroState.slot;
  const reach = Math.max(slot.w, 240) * 1.5;
  prismVisibility.onScreen =
    slot.w > 0 &&
    slot.x > -reach &&
    slot.y > -reach &&
    slot.x < window.innerWidth + reach &&
    slot.y < window.innerHeight + reach;
}

/**
 * Claim the prism for an element.
 *
 * `spec` is read live every frame, so a scene can retune width, angle or
 * ownership mid-beat without re-registering — the object responds by moving,
 * which is the whole point.
 */
export function usePrismSlot(
  ref: RefObject<HTMLElement | null>,
  spec: PrismSlotSpec & { active?: boolean; priority?: number },
) {
  const live = useRef(spec);
  live.current = spec;

  const active = spec.active ?? true;
  const priority = spec.priority ?? 0;

  useEffect(() => {
    const element = ref.current;
    if (!element || !active) return;
    const id = nextId++;
    claims.set(id, { element, priority, spec: live });
    /* Measured in the clock's measure phase, so the slot the prism reads this
       frame is the slot the layout actually has this frame — not last frame's,
       and not one resolved by a loop racing the camera. */
    stop ??= onStoryFrame(measure, "measure");
    return () => {
      claims.delete(id);
      if (claims.size === 0 && stop) {
        stop();
        stop = null;
      }
    };
  }, [ref, active, priority, live]);
}

/**
 * The optical channel: how far through its own story the glass is, 0..1.
 *
 * The scroll director writes this once per frame. It is deliberately separate
 * from the slot — where the object *is* and what it is *doing* are different
 * questions, and scenes routinely change one without the other.
 */
export const prismOptics = { progress: 0.02 };

export function setPrismProgress(progress: number) {
  prismOptics.progress = Math.min(1, Math.max(0, progress));
}

/**
 * Author the prism's ingestion directly: what the glass is currently holding.
 *
 * Six weights, one per wavelength. While `weight > 0` these override the
 * scroll-derived schedule, which is what lets a real fragment card be carried
 * into the glass at the exact moment an actor releases it.
 */
export function setPrismIngestion(weight: number, entries?: readonly number[]) {
  heroState.authored = Math.min(1, Math.max(0, weight));
  if (!entries) return;
  for (let i = 0; i < 6; i++) {
    heroState.authoredEntry[i] = Math.min(1, Math.max(0, entries[i] ?? 0));
  }
}
