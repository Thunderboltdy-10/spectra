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
import {
  createGrainRenderer,
  type GrainInfluence,
  type GrainMood,
  type GrainRenderer,
} from "./grain-renderer";

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

/** Environment-scale input for the same field system. */
export type EnvironmentFieldSource = {
  mood: { current: GrainMood };
  influences: { current: readonly GrainInfluence[] };
};

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
        >
          {/* the rim of a wake refracts: two hue-shifted lattices offset
              against each other, so activity reads as light through glass */}
          <span className="spectra-field-wake-fringe" />
        </span>
      ))}
    </span>
  );
}

/**
 * The shared field at viewport scale.
 *
 * Card and panel fields use the CSS lattice above. A viewport needs enough
 * grain that WebGL is cheaper, but it does not get a second lifecycle or
 * clock: the host supplies its existing event heartbeat. This component owns
 * only rendering resources and paints one static frame in reduced motion.
 */
export function EnvironmentField({
  source,
  subscribe,
  className,
  maxDpr,
  children,
}: {
  source: EnvironmentFieldSource;
  subscribe: (listener: () => void) => () => void;
  className?: string;
  maxDpr?: number;
  children?: React.ReactNode;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const reduced =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let renderer: GrainRenderer | null = null;
    try {
      renderer = createGrainRenderer(canvas, { maxDpr: reduced ? 1 : maxDpr });
    } catch {
      renderer = null;
    }
    if (!renderer) return;
    const engine = renderer;
    const host = canvas.parentElement ?? canvas;
    let onScreen = true;
    let painted = false;
    let reducedPainted = false;
    const started = performance.now();

    const draw = () => {
      if (!onScreen || document.hidden || (reduced && reducedPainted)) return;
      engine.frame(
        source.mood.current,
        source.influences.current,
        reduced ? 0 : (performance.now() - started) / 1000,
      );
      if (reduced) reducedPainted = true;
      if (!painted) {
        painted = true;
        canvas.dataset.live = "true";
        host.dataset.gpu = "true";
      }
    };

    const size = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (!box) return;
      engine.resize(box.width, box.height);
      reducedPainted = false;
      draw();
    });
    size.observe(host);
    engine.resize(host.clientWidth, host.clientHeight);

    const view = new IntersectionObserver(
      (entries) => {
        onScreen = entries[0]?.isIntersecting ?? true;
        if (onScreen) {
          reducedPainted = false;
          draw();
        }
      },
      { rootMargin: "120px" },
    );
    view.observe(host);

    const onVisibility = () => {
      if (!document.hidden) {
        reducedPainted = false;
        draw();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    const stop = subscribe(draw);
    draw();

    return () => {
      stop();
      size.disconnect();
      view.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      engine.dispose();
      delete host.dataset.gpu;
    };
  }, [maxDpr, source, subscribe]);

  return (
    <>
      {children}
      <canvas
        ref={canvasRef}
        className={
          className
            ? `spectra-field-canvas ${className}`
            : "spectra-field-canvas"
        }
        aria-hidden="true"
      />
    </>
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
    let delayTimer: number | null = null;
    let lastMeasurement = 0;

    const measure = () => {
      frame = 0;
      lastMeasurement = performance.now();
      /* A hidden tab keeps its last influences frozen; visibilitychange
         re-measures on return. rAF also stops firing while hidden, so this
         guard is what keeps a stale wake from outliving a hidden session. */
      if (document.hidden) return;
      if (!states.length) {
        commit(EMPTY);
        return;
      }
      const surfaceFrame = resolveSurfaceFrame(surface);
      const scale = surfaceFrame.scale || 1;
      const width = surfaceFrame.rect.width / scale;
      const height = surfaceFrame.rect.height / scale;
      if (!width || !height) return;

      const next: FieldInfluence[] = [];
      for (const state of states) {
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

    const scheduleMeasure = () => {
      if (frame) return;
      const elapsed = performance.now() - lastMeasurement;
      if (elapsed >= SAMPLE_INTERVAL_MS) frame = requestAnimationFrame(measure);
      else if (delayTimer === null) {
        delayTimer = window.setTimeout(() => {
          delayTimer = null;
          if (!frame) frame = requestAnimationFrame(measure);
        }, SAMPLE_INTERVAL_MS - elapsed);
      }
    };

    const resize = new ResizeObserver(scheduleMeasure);
    resize.observe(surface);
    /* Capture phase: the surface itself rarely scrolls — the editors inside
       it do, and a non-capturing listener would never hear them. */
    surface.addEventListener("scroll", scheduleMeasure, {
      passive: true,
      capture: true,
    });
    window.addEventListener("resize", scheduleMeasure, { passive: true });
    const onVisibility = () => {
      if (!document.hidden) scheduleMeasure();
    };
    document.addEventListener("visibilitychange", onVisibility);
    scheduleMeasure();
    return () => {
      if (frame) cancelAnimationFrame(frame);
      if (delayTimer !== null) window.clearTimeout(delayTimer);
      resize.disconnect();
      surface.removeEventListener("scroll", scheduleMeasure, {
        capture: true,
      } as EventListenerOptions);
      window.removeEventListener("resize", scheduleMeasure);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [commit, enabled, localClientId, states, surfaceRef]);

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
