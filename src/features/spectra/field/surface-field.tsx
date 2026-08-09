"use client";

/**
 * The field: Spectra's ambient intelligence layer.
 *
 * Every bounded Spectra surface can carry one. At rest it is a quiet dot
 * lattice gathered toward the surface's lower-right — almost invisible, and
 * genuinely free: a masked periodic gradient drifting on the compositor, with
 * no per-component render loop.
 *
 * When someone acts, the surface wakes *locally*. The region around the actual
 * edit brightens, takes the acting identity's colour and relaxes afterwards.
 * A surface holds a list of influences, so one document can show an AI writing
 * in one paragraph while a person edits another, and both read as themselves.
 *
 * Influences change on state transitions, never per frame. The CSS transitions
 * do the smoothing, which is why a busy workspace stays cheap.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  presenceColor,
  stateIsVisible,
  type InteractionState,
} from "../collaboration/interaction-model";
import {
  resolvePlacement,
  resolveSurfaceFrame,
} from "../collaboration/interaction-geometry";

/** How long one lattice drift cycle takes; must match the CSS keyframes. */
const DRIFT_PERIOD_MS = 58_000;

export type FieldState =
  | "active"
  | "typing"
  | "waiting"
  | "drag"
  | "success"
  | "failure";

export type FieldInfluence = {
  /** Stable key — usually the acting client id, or a region id. */
  id: string;
  /** Centre, as a fraction of the surface box (0..1). */
  x: number;
  y: number;
  /** Radius as a fraction of the surface's larger side. Defaults to 0.42. */
  radius?: number;
  /** 0..1. Below ~0.03 the influence is dropped entirely. */
  strength?: number;
  /** The acting identity's colour. Defaults to the Spectra accent. */
  hue?: string;
  state?: FieldState;
};

export type FieldScale = "card" | "panel" | "stage";
export type FieldGrain = "wave" | "grid" | "line" | "segment";

export function SurfaceField({
  influences,
  scale = "card",
  grain = "wave",
  depth = false,
  behind = false,
  rest,
  className,
}: {
  influences?: readonly FieldInfluence[];
  scale?: FieldScale;
  /** Structural character: sheets read as a grid, code as a thin line phase. */
  grain?: FieldGrain;
  /** Two lattice layers. Reserve for large surfaces. */
  depth?: boolean;
  /**
   * Sit behind the host's own content. Only safe inside a surface that
   * establishes a stacking context (`isolation: isolate`, a transform, …);
   * otherwise the field would fall behind the surface's background.
   */
  behind?: boolean;
  /** Override the resting opacity (0.02–0.08 is the useful band). */
  rest?: number;
  className?: string;
}) {
  const rootRef = useRef<HTMLSpanElement>(null);

  /* Shared temporal phase. Every field in the document is offset by however
     long the document has been alive, so surfaces mounted at different times
     drift together instead of each starting its own cycle. One assignment at
     mount, never a loop. */
  useEffect(() => {
    const node = rootRef.current;
    if (!node) return;
    const phase = -(performance.now() % DRIFT_PERIOD_MS);
    node.style.setProperty("--field-phase", `${Math.round(phase)}ms`);
  }, []);

  const live = useMemo(
    () => (influences ?? []).filter((one) => (one.strength ?? 1) > 0.03),
    [influences],
  );

  return (
    <span
      ref={rootRef}
      className={className ? `spectra-field ${className}` : "spectra-field"}
      data-scale={scale}
      data-grain={grain}
      data-depth={depth ? "true" : undefined}
      data-behind={behind ? "true" : undefined}
      style={
        rest === undefined
          ? undefined
          : ({ "--field-rest": rest } as React.CSSProperties)
      }
      aria-hidden="true"
    >
      <span className="spectra-field-rest" />
      {live.map((influence) => (
        <span
          key={influence.id}
          className="spectra-field-wake"
          data-state={influence.state ?? "active"}
          style={
            {
              "--wake-x": `${influence.x * 100}%`,
              "--wake-y": `${influence.y * 100}%`,
              "--wake-r": `${(influence.radius ?? 0.42) * 200}%`,
              "--wake-strength": influence.strength ?? 1,
              "--wake-hue": influence.hue ?? "var(--brand-primary)",
            } as React.CSSProperties
          }
        />
      ))}
    </span>
  );
}

/* ------------------------------------------------------------------ *
 * Deriving influences from real activity
 * ------------------------------------------------------------------ */

/** How often activity is re-measured. Fields move slowly on purpose. */
const SAMPLE_INTERVAL_MS = 140;

const EMPTY: FieldInfluence[] = [];

export function fieldStateFor(state: InteractionState): FieldState {
  if (
    state.lifecycle === "blocked" ||
    state.lifecycle === "queued" ||
    state.lifecycle === "waiting" ||
    state.lifecycle === "paused"
  )
    return "waiting";
  if (state.lifecycle === "failed" || state.lifecycle === "cancelled")
    return "failure";
  if (state.lifecycle === "completed") return "success";
  switch (state.act.kind) {
    case "type":
    case "insert":
    case "replace":
      return "typing";
    case "dragStart":
    case "dragMove":
    case "dragRelease":
    case "resizeStart":
    case "resizeMove":
    case "resizeRelease":
      return "drag";
    default:
      return "active";
  }
}

/**
 * Resolve live collaborator activity into field influences on one surface.
 *
 * This is the bridge that makes the field mean something: the region that
 * wakes is the region an actor is genuinely working in, resolved from the same
 * semantic targets the cursors use, so the field can never drift out of sync
 * with the presence layer.
 */
export function useActivityField(
  surfaceRef: React.RefObject<HTMLElement | null>,
  states: readonly InteractionState[],
  options?: { localClientId?: string; enabled?: boolean },
): FieldInfluence[] {
  const [influences, setInfluences] = useState<FieldInfluence[]>(EMPTY);
  const statesRef = useRef(states);
  statesRef.current = states;
  const enabled = options?.enabled ?? true;
  const localClientId = options?.localClientId;

  const commit = useCallback((next: FieldInfluence[]) => {
    setInfluences((previous) =>
      influencesEqual(previous, next) ? previous : next,
    );
  }, []);

  useEffect(() => {
    if (!enabled) {
      commit(EMPTY);
      return;
    }
    const surface = surfaceRef.current;
    if (!surface) return;
    let frame = 0;
    let last = 0;
    let disposed = false;

    const measure = (now: number) => {
      if (disposed) return;
      frame = requestAnimationFrame(measure);
      if (now - last < SAMPLE_INTERVAL_MS) return;
      last = now;

      const current = statesRef.current;
      if (!current.length) {
        commit(EMPTY);
        return;
      }
      const surfaceFrame = resolveSurfaceFrame(surface);
      const scale = surfaceFrame.scale || 1;
      const width = surfaceFrame.rect.width / scale;
      const height = surfaceFrame.rect.height / scale;
      if (!width || !height) return;

      const next: FieldInfluence[] = [];
      for (const state of current) {
        if (state.actor.clientId === localClientId) continue;
        if (!stateIsVisible(state)) continue;
        if (!state.target) continue;
        const placement = resolvePlacement(surfaceFrame, {
          target: state.target,
        });
        if (!placement || placement.offSurface) continue;
        const box = placement.caret ?? placement.box;
        const cx = (box.left + box.width / 2) / width;
        const cy = (box.top + box.height / 2) / height;
        if (cx < -0.25 || cx > 1.25 || cy < -0.25 || cy > 1.25) continue;
        const span = Math.max(placement.box.width, placement.box.height);
        next.push({
          id: state.actor.clientId,
          x: cx,
          y: cy,
          radius: Math.min(
            0.6,
            Math.max(0.18, span / Math.max(width, height) + 0.14),
          ),
          strength: state.lifecycle === "settled" ? 0.45 : 1,
          hue: presenceColor(state.actor),
          state: fieldStateFor(state),
        });
      }
      commit(next);
    };

    frame = requestAnimationFrame(measure);
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
    };
  }, [commit, enabled, localClientId, surfaceRef]);

  return influences;
}

function influencesEqual(
  left: readonly FieldInfluence[],
  right: readonly FieldInfluence[],
): boolean {
  if (left.length !== right.length) return false;
  return left.every((entry, index) => {
    const other = right[index]!;
    return (
      entry.id === other.id &&
      entry.state === other.state &&
      Math.abs(entry.x - other.x) < 0.008 &&
      Math.abs(entry.y - other.y) < 0.008 &&
      Math.abs((entry.radius ?? 0) - (other.radius ?? 0)) < 0.02 &&
      Math.abs((entry.strength ?? 1) - (other.strength ?? 1)) < 0.05
    );
  });
}
