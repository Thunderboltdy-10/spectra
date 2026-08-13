"use client";

/**
 * The interaction layer: one overlay that paints every collaborator's presence
 * natively, human and AI alike.
 *
 * Design intent. One actor has one visible body, and that body *travels*:
 * nearby controls are a quick hop, distant controls a short sweep that
 * decelerates onto the exact glyph, and a move across a scope boundary is a
 * calm fade rather than a false flight. Every control primitive answers with
 * its own native chrome — a true caret between characters, line-box
 * selections, an observed menu that never steals focus, a press that lands
 * once, a drag with a visible drop target — and when the work settles, every
 * trace of chrome fades away. Nothing here is decorative: each signal says
 * who is acting, where, and on what.
 *
 * The layer is a sticky zero-height node pinned to the top of the editor's
 * scroll viewport. Every position is recomputed locally from semantics each
 * frame, so nothing depends on a peer's pane size, scroll offset or zoom.
 */

import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  actIsDrag,
  actIsResize,
  actorLabel,
  cursorModeForAct,
  describeState,
  presenceColor,
  stateIsVisible,
  TERMINAL_LIFECYCLES,
  type CursorMode,
  type InteractionState,
} from "../../collaboration/interaction-model";
import {
  resolvePlacement,
  resolveSurfaceFrame,
  SURFACE_ATTRIBUTE,
  type InteractionPlacement,
  type OffSurfaceEdge,
  type SurfaceBox,
} from "../../collaboration/interaction-geometry";
import {
  CometTrail,
  CursorTravel,
  type TravelSample,
} from "../../collaboration/cursor-motion";
import {
  PresentationLane,
  type FrameTravel,
} from "../../collaboration/presentation-lane";

/** Presence for an actor whose last frame is older than this is dropped. */
const STALE_AFTER_MS = 20_000;
/** Settled chrome lingers this long, then fades out completely. */
const SETTLE_FADE_MS = 480;
/** Activity bucket that restarts the presence-label lifecycle while moving. */
const PRESENCE_LABEL_BUCKET_MS = 800;
/** Window in which the completion ring plays after an act completes. */
const COMPLETION_RING_MS = 900;
/** Above this pointer speed (px/ms) a journey leaves a short comet trail. */
const TRAIL_SPEED_PX_PER_MS = 1.15;

type ActorVisual = {
  key: string;
  state: InteractionState;
  label: string;
  color: string;
  mode: CursorMode;
  placement: InteractionPlacement | null;
  description: string;
  travel: TravelKind;
  point: { left: number; top: number };
  opacity: number;
  /** Tilt in degrees while travelling, so the body leans into its journey. */
  tilt: number;
  trail: Array<{ x: number; y: number; strength: number }>;
  /** True while the actor is leaving: chrome fades rather than vanishing. */
  departing: boolean;
  /** Fires one completion ring on the finished target (completion grammar). */
  justCompleted: boolean;
};

type TravelKind = FrameTravel["kind"];

type ActorRuntime = {
  lane: PresentationLane;
  travel: CursorTravel;
  trail: CometTrail;
  lastSignature: string;
  departingAt: number | null;
  /** When the current act transitioned into a completed/settled lifecycle. */
  completedAt: number | null;
  /** Act signature for which `completedAt` was recorded. */
  completedForSignature: string | null;
};

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);
  return reduced;
}

/**
 * Coarse pointers and small viewports get the truthful bits of presence
 * (identity, caret, selection) without velocity ornaments like trails/tilt.
 */
function useSimplifiedPresence(): boolean {
  const [simplified, setSimplified] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const coarse = window.matchMedia("(pointer: coarse)");
    const narrow = window.matchMedia("(max-width: 719px)");
    const sync = () => setSimplified(coarse.matches || narrow.matches);
    sync();
    coarse.addEventListener("change", sync);
    narrow.addEventListener("change", sync);
    return () => {
      coarse.removeEventListener("change", sync);
      narrow.removeEventListener("change", sync);
    };
  }, []);
  return simplified;
}

function placementRequest(state: InteractionState) {
  const act = state.act;
  switch (act.kind) {
    case "caret":
    case "type":
    case "insert":
      return { point: act.point };
    case "select":
    case "delete":
    case "replace":
      return { span: act.span };
    case "hover":
      return { fraction: act.at };
    case "dragMove":
      return { fraction: act.at };
    default:
      return {};
  }
}

/** Semantic identity of a frame: position changes without a signature change
 * mean the surface moved (scroll/reflow), not that the actor travelled. */
function frameSignature(state: InteractionState): string {
  return [
    state.actor.clientId,
    state.act.kind,
    state.lifecycle,
    state.target?.artifactId ?? "",
    state.target?.path ?? "",
    state.target?.part ?? "",
    state.target?.scope
      ? `${state.target.scope.kind}:${state.target.scope.id}`
      : "",
    state.menu?.highlighted ?? "",
    "point" in state.act ? JSON.stringify(state.act.point) : "",
    "span" in state.act ? JSON.stringify(state.act.span) : "",
  ].join("~");
}

export const InteractionLayer = memo(function InteractionLayer({
  states,
  localClientId,
  /** Set while the local user has scrolled; suppresses travel to avoid smearing. */
  quiet = false,
  anchor = "sticky",
}: {
  states: readonly InteractionState[];
  localClientId?: string;
  quiet?: boolean;
  /**
   * How the layer anchors to its surface.
   *
   * `sticky` (the default) pins it to the top of the scrollport, which is what
   * an editor scrolling inside a pane needs. `static` leaves it at its natural
   * position in the surface, for surfaces that do not scroll under the layer:
   * a transformed canvas, a fixed panel, a pinned stage.
   */
  anchor?: "sticky" | "static";
}) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const runtimesRef = useRef(new Map<string, ActorRuntime>());
  const [visuals, setVisuals] = useState<ActorVisual[]>([]);
  const reducedMotion = usePrefersReducedMotion();
  const simplified = useSimplifiedPresence();
  const reducedRef = useRef(reducedMotion);
  const quietRef = useRef(quiet);
  const effectsMutedRef = useRef(false);
  useEffect(() => {
    reducedRef.current = reducedMotion;
    quietRef.current = quiet;
  }, [reducedMotion, quiet]);

  // Remote actors with a renderable state, freshness-checked so a disconnected
  // peer or a finished run can never leave a cursor behind.
  const actors = useMemo(
    () =>
      states.filter((state) => {
        if (state.actor.clientId === localClientId) return false;
        return stateIsVisible(state);
      }),
    [states, localClientId],
  );

  /** Above this many visible actors, rooms shed velocity ornaments so a busy
   *  workspace stays calm; identity, carets and selections stay exact. */
  const PRESENCE_DENSITY_SOFT_LIMIT = 6;
  const dense = actors.length > PRESENCE_DENSITY_SOFT_LIMIT;
  useEffect(() => {
    effectsMutedRef.current = simplified || dense;
  }, [simplified, dense]);

  const signature = useMemo(
    () => actors.map(frameSignature).join("|"),
    [actors],
  );

  useEffect(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const surface =
      anchor.closest<HTMLElement>(`[${SURFACE_ATTRIBUTE}]`) ??
      anchor.parentElement;
    if (!surface) return;

    const runtimes = runtimesRef.current;
    let frame = 0;
    let staleTimer: number | null = null;
    let disposed = false;

    const measure = () => {
      if (disposed) return;
      frame = 0;
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      const surfaceFrame = resolveSurfaceFrame(surface, anchor);
      const seen = new Set<string>();
      let keepAnimating = false;
      let nextStaleDelay = Number.POSITIVE_INFINITY;

      for (const state of actors) {
        const key = state.actor.clientId;
        seen.add(key);
        let runtime = runtimes.get(key);
        if (!runtime) {
          runtime = {
            lane: new PresentationLane(key),
            travel: new CursorTravel(() => reducedRef.current),
            trail: new CometTrail(),
            lastSignature: "",
            departingAt: null,
            completedAt: null,
            completedForSignature: null,
          };
          runtimes.set(key, runtime);
        }
        const stale = now - state.at > STALE_AFTER_MS;
        if (!stale)
          nextStaleDelay = Math.min(
            nextStaleDelay,
            Math.max(0, state.at + STALE_AFTER_MS - now + 16),
          );
        const terminal =
          TERMINAL_LIFECYCLES.has(state.lifecycle) &&
          state.lifecycle !== "completed" &&
          state.lifecycle !== "settled";
        if (stale || terminal) {
          if (runtime.departingAt === null) runtime.departingAt = now;
          continue;
        }
        const signature = frameSignature(state);
        if (signature !== runtime.lastSignature) {
          runtime.lane.push(state);
          runtime.lastSignature = signature;
          runtime.departingAt = null;
          /* Completion signal: recorded once per act so the ring fires for the
             transition into "completed", not repeatedly while settled. */
          if (state.lifecycle === "completed") {
            runtime.completedAt = now;
            runtime.completedForSignature = signature;
          } else if (runtime.completedForSignature === signature) {
            runtime.completedAt = null;
            runtime.completedForSignature = null;
          }
        }
      }

      // Actors that vanished from awareness depart gracefully.
      for (const [key, runtime] of runtimes) {
        if (!seen.has(key) && runtime.departingAt === null) {
          runtime.departingAt = now;
        }
      }

      const next: ActorVisual[] = [];
      for (const [key, runtime] of runtimes) {
        const laneFrame = runtime.lane.current();
        if (!laneFrame) {
          if (runtime.departingAt === null) runtimes.delete(key);
          continue;
        }
        const { state, travel } = laneFrame;
        const placement = state.target
          ? resolvePlacement(surfaceFrame, {
              target: state.target,
              ...placementRequest(state),
            })
          : null;

        const departing =
          runtime.departingAt !== null
            ? Math.min(1, (now - runtime.departingAt) / SETTLE_FADE_MS)
            : 0;
        if (departing > 0) keepAnimating = true;
        if (departing >= 1) {
          runtime.lane.clear();
          runtimes.delete(key);
          continue;
        }

        let point = {
          left: placement?.point.left ?? 0,
          top: placement?.point.top ?? 0,
        };
        let opacity = 1 - departing;
        let tilt = 0;
        let trailPoints: Array<{ x: number; y: number; strength: number }> = [];

        if (placement && !placement.offSurface) {
          const settled =
            state.lifecycle === "settled" || state.lifecycle === "completed";
          const isCaretAct =
            cursorModeForAct(state.act) === "caret" ||
            cursorModeForAct(state.act) === "selection";
          if (quietRef.current || reducedRef.current) {
            runtime.travel.snapTo(point.left, point.top);
          } else if (travel.kind === "stay" || isCaretAct || settled) {
            // Caret advances and settle landings track the glyph directly;
            // a visible journey between characters would read as lag.
            runtime.travel.snapTo(point.left, point.top);
          } else {
            runtime.travel.moveTo(
              point.left,
              point.top,
              now,
              travel.crossesScope,
            );
          }
          const sample: TravelSample = runtime.travel.sample(now);
          if (sample.travelling) keepAnimating = true;
          point = { left: sample.x, top: sample.y };
          opacity *= runtime.travel.fadeOpacity(sample);
          if (effectsMutedRef.current) {
            // Dense rooms and simplified environments keep travel honest but
            // shed the trail/tilt ornaments — presence stays exact, never busy.
            runtime.trail.push(point.left, point.top, now, false);
            trailPoints = [];
          } else if (sample.travelling && sample.kind === "journey") {
            // Lean into the direction of travel, capped and decayed.
            const position = runtime.travel.position;
            if (position) {
              const dx = point.left - (trailPoints[0]?.x ?? position.x);
              tilt = Math.max(-7, Math.min(7, dx * 0.06 * sample.speed));
            }
            runtime.trail.push(
              point.left,
              point.top,
              now,
              sample.speed > TRAIL_SPEED_PX_PER_MS,
            );
            trailPoints = runtime.trail.sample(now);
          } else {
            runtime.trail.push(point.left, point.top, now, false);
            trailPoints = runtime.trail.sample(now);
          }
        } else {
          runtime.trail.push(0, 0, now, false);
        }
        if (trailPoints.length > 0) keepAnimating = true;
        const justCompleted =
          runtime.completedAt !== null &&
          now - runtime.completedAt < COMPLETION_RING_MS;
        if (justCompleted) keepAnimating = true;

        next.push({
          key,
          state,
          label: actorLabel(state.actor),
          color: presenceColor(state.actor),
          mode: cursorModeForAct(state.act),
          placement,
          description: describeState(state),
          travel: travel.kind,
          point,
          opacity,
          tilt,
          trail: trailPoints,
          departing: runtime.departingAt !== null,
          justCompleted,
        });
      }

      setVisuals((previous) =>
        visualsEqual(previous, next) ? previous : next,
      );
      if (keepAnimating) frame = requestAnimationFrame(measure);
      else if (Number.isFinite(nextStaleDelay)) {
        staleTimer = window.setTimeout(scheduleMeasure, nextStaleDelay);
      }
    };

    const scheduleMeasure = () => {
      if (disposed || frame) return;
      if (staleTimer !== null) {
        window.clearTimeout(staleTimer);
        staleTimer = null;
      }
      frame = requestAnimationFrame(measure);
    };

    const resize = new ResizeObserver(scheduleMeasure);
    resize.observe(surface);
    surface.addEventListener("scroll", scheduleMeasure, { passive: true });
    window.addEventListener("resize", scheduleMeasure, { passive: true });
    document.addEventListener("visibilitychange", scheduleMeasure);
    scheduleMeasure();
    return () => {
      disposed = true;
      if (frame) cancelAnimationFrame(frame);
      if (staleTimer !== null) window.clearTimeout(staleTimer);
      resize.disconnect();
      surface.removeEventListener("scroll", scheduleMeasure);
      window.removeEventListener("resize", scheduleMeasure);
      document.removeEventListener("visibilitychange", scheduleMeasure);
    };
  }, [actors, signature]);

  if (!visuals.length) {
    return (
      <div
        ref={anchorRef}
        className="spectra-presence-layer"
        data-anchor={anchor}
        data-quiet={quiet ? "true" : undefined}
        aria-hidden="true"
      />
    );
  }

  return (
    <div
      ref={anchorRef}
      className="spectra-presence-layer"
      data-anchor={anchor}
      data-quiet={quiet ? "true" : undefined}
      aria-hidden="true"
    >
      {visuals.map((visual) => (
        <ActorPresence key={visual.key} visual={visual} />
      ))}
    </div>
  );
});

/** A cheap frame-to-frame comparison; sub-pixel jitter must not re-render. */
function visualsEqual(left: ActorVisual[], right: ActorVisual[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((entry, index) => {
    const other = right[index]!;
    if (entry.key !== other.key) return false;
    if (entry.state.act.kind !== other.state.act.kind) return false;
    if (entry.description !== other.description) return false;
    if (entry.mode !== other.mode) return false;
    if (entry.departing !== other.departing) return false;
    if (entry.justCompleted !== other.justCompleted) return false;
    if (!near(entry.opacity, other.opacity)) return false;
    if (
      !near(entry.point.left, other.point.left) ||
      !near(entry.point.top, other.point.top)
    )
      return false;
    if (entry.trail.length !== other.trail.length) return false;
    if (
      entry.trail.some(
        (point, pointIndex) =>
          !near(point.x, other.trail[pointIndex]?.x ?? 0) ||
          !near(point.y, other.trail[pointIndex]?.y ?? 0) ||
          !near(point.strength, other.trail[pointIndex]?.strength ?? 0),
      )
    )
      return false;
    return placementsEqual(entry.placement, other.placement);
  });
}

function placementsEqual(
  left: InteractionPlacement | null,
  right: InteractionPlacement | null,
): boolean {
  if (!left || !right) return left === right;
  if (left.offSurface !== right.offSurface) return false;
  if (left.precision !== right.precision) return false;
  if (!boxesEqual(left.box, right.box)) return false;
  if (!boxesEqual(left.caret, right.caret)) return false;
  if (!boxesEqual(left.part, right.part)) return false;
  const leftSelection = left.selection ?? [];
  const rightSelection = right.selection ?? [];
  if (leftSelection.length !== rightSelection.length) return false;
  return leftSelection.every((box, index) =>
    boxesEqual(box, rightSelection[index]),
  );
}

function near(left: number, right: number): boolean {
  return Math.abs(left - right) < 0.5;
}

function boxesEqual(
  left: SurfaceBox | undefined,
  right: SurfaceBox | undefined,
): boolean {
  if (!left || !right) return left === right;
  return (
    near(left.left, right.left) &&
    near(left.top, right.top) &&
    near(left.width, right.width) &&
    near(left.height, right.height)
  );
}

/* ------------------------------------------------------------------ *
 * Per-actor chrome
 * ------------------------------------------------------------------ */

function ActorPresence({ visual }: { visual: ActorVisual }) {
  const {
    placement,
    color,
    state,
    mode,
    label,
    description,
    point,
    opacity,
    tilt,
    trail,
    travel,
    departing,
    justCompleted,
  } = visual;
  const isAi = state.actor.kind === "ai";

  if (!placement) {
    // The control is not in the DOM at all — another slide, a collapsed section,
    // a virtualized row. Presence is reported in the collaborator stack instead
    // of guessed at on the canvas.
    return null;
  }

  if (placement.offSurface) {
    return (
      <EdgeMarker
        edge={placement.offSurface}
        box={placement.box}
        color={color}
        label={label}
        isAi={isAi}
        opacity={opacity}
      />
    );
  }

  const style = {
    "--presence-color": color,
    opacity,
    transition: departing ? "opacity 420ms var(--ease-standard)" : undefined,
  } as React.CSSProperties;
  const dragging = actIsDrag(state.act);
  const resizing = actIsResize(state.act);
  const pressing = state.act.kind === "press" || state.act.kind === "toggle";
  const structural =
    state.act.kind === "create" ||
    state.act.kind === "remove" ||
    state.act.kind === "reorder" ||
    state.act.kind === "group";
  const blocked =
    state.lifecycle === "blocked" ||
    state.lifecycle === "queued" ||
    state.lifecycle === "paused";
  const typing = state.act.kind === "type" || state.act.kind === "insert";
  const settled =
    state.lifecycle === "settled" || state.lifecycle === "completed";
  const provisional = Boolean(state.speculation) && !settled;
  return (
    <div
      className="spectra-presence-actor"
      data-departing={departing ? "true" : undefined}
      style={style}
    >
      {/* Comet trail: only while a journey is genuinely fast. */}
      {travel === "journey" &&
        trail.map((trailPoint, index) => (
          <span
            key={`trail-${index}`}
            className="spectra-presence-trail"
            style={{
              left: trailPoint.x,
              top: trailPoint.y,
              opacity: trailPoint.strength * 0.34,
            }}
          />
        ))}

      {/* Completion ring (completion grammar): one restrained settle pulse on
          the finished target, fired once per act — never repeated while the
          actor remains settled. */}
      {justCompleted && (
        <div
          className="spectra-completion-ring"
          style={{
            left: placement.box.left - 4,
            top: placement.box.top - 4,
            width: placement.box.width + 8,
            height: placement.box.height + 8,
          }}
        />
      )}

      {/* Selection line boxes, drawn under all other chrome. */}
      {placement.selection?.map((box, index) => (
        <div
          key={`selection-${index}`}
          className="spectra-presence-selection"
          style={boxStyle(box)}
        />
      ))}

      {/* Control frame: drawn only for acts that concern the control as a
          whole. A caret inside a field never lights up the card around it. */}
      {(dragging || resizing || pressing || structural || blocked) && (
        <div
          className="spectra-presence-frame"
          data-variant={
            blocked
              ? "blocked"
              : resizing
                ? "resize"
                : dragging
                  ? "drag"
                  : structural
                    ? "structural"
                    : "press"
          }
          style={boxStyle(placement.box)}
        />
      )}

      {/* Provisional ink: the control is showing a value that is not durable
          yet. Emerges with the change and fades as it commits. */}
      {provisional && placement.box.width > 0 && (
        <div
          className="spectra-presence-provisional"
          style={boxStyle(placement.box)}
        />
      )}
      {/* Resize handles mirror the editor's own affordance. */}
      {resizing && (
        <div
          className="spectra-presence-handles"
          style={boxStyle(placement.box)}
        >
          {["nw", "ne", "se", "sw"].map((corner) => (
            <span
              key={corner}
              className="spectra-presence-handle"
              data-corner={corner}
              data-active={
                state.target?.part === `handle:${corner}` ? "true" : undefined
              }
            />
          ))}
        </div>
      )}

      {/* Press ripple, once — never a permanent pulse. */}
      {pressing && (
        <span
          className="spectra-presence-press"
          style={{
            left: placement.box.left + placement.box.width / 2,
            top: placement.box.top + placement.box.height / 2,
          }}
        />
      )}

      {/* Where a drag would land. */}
      {dragging && state.dropTarget && (
        <DropTargetOutline dropTarget={state.dropTarget} />
      )}

      {/* Typed ink: a soft sweep along the line being written, emerging with
          the characters instead of covering the field. */}
      {typing && placement.caret && (
        <span
          className="spectra-presence-ink"
          style={{
            left: placement.box.left,
            top: placement.caret.top,
            width: Math.max(placement.box.width, 24),
            height: Math.max(placement.caret.height, 12),
          }}
        />
      )}

      {/* Caret, positioned on the exact glyph. */}
      {placement.caret && (mode === "caret" || mode === "selection") && (
        <span
          className="spectra-presence-caret"
          data-typing={typing ? "true" : undefined}
          style={{
            left: point.left,
            top: placement.caret.top,
            height: Math.max(placement.caret.height, 12),
          }}
        />
      )}

      {/* Observed menu. Rendered as a read-only mirror: it explains the peer's
          action and never takes focus or opens the local control. */}
      {state.menu && mode === "menu" && (
        <div
          className="spectra-presence-menu"
          style={{
            left: placement.box.left,
            top: placement.box.top + placement.box.height + 6,
          }}
        >
          <div className="spectra-presence-menu-head">{state.menu.label}</div>
          {state.menu.options.map((option) => (
            <div
              key={option.value}
              className="spectra-presence-menu-option"
              data-highlighted={
                option.value === state.menu?.highlighted ? "true" : undefined
              }
            >
              {option.label}
            </div>
          ))}
        </div>
      )}

      {/* Cursor and flag. The flag's key restarts its CSS lifecycle while the
          actor is actively moving (new 800 ms activity bucket ⇒ restart), so a
          working actor's label stays visible and a settled actor's label
          decays away ~3.6 s after the last movement — no JS timer needed. */}
      <div
        className="spectra-presence-cursor"
        data-mode={mode}
        data-ai={isAi ? "true" : undefined}
        data-travelling={travel === "journey" ? "true" : undefined}
        style={{
          left: point.left,
          top: point.top,
          transform: tilt ? `rotate(${tilt}deg)` : undefined,
        }}
      >
        {mode !== "caret" && mode !== "selection" && mode !== "hidden" && (
          <CursorGlyph mode={mode} pressed={pressing} />
        )}
        <span
          key={Math.floor(state.at / PRESENCE_LABEL_BUCKET_MS)}
          className="spectra-presence-flag"
          data-ai={isAi ? "true" : undefined}
        >
          {isAi && <SparkGlyph />}
          <span className="spectra-presence-flag-name">{label}</span>
          {description && description !== "Present" && (
            <>
              <span className="spectra-presence-flag-rule" />
              <span className="spectra-presence-flag-action">
                {description}
              </span>
            </>
          )}
        </span>
      </div>
    </div>
  );
}

function boxStyle(box: SurfaceBox): React.CSSProperties {
  return {
    left: box.left,
    top: box.top,
    width: box.width,
    height: box.height,
  };
}

function DropTargetOutline({
  dropTarget,
}: {
  dropTarget: NonNullable<InteractionState["dropTarget"]>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<SurfaceBox | null>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const surface = node.closest<HTMLElement>(`[${SURFACE_ATTRIBUTE}]`);
    const anchor = node.closest<HTMLElement>(".spectra-presence-layer");
    if (!surface || !anchor) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const placement = resolvePlacement(resolveSurfaceFrame(surface, anchor), {
        target: dropTarget,
      });
      setBox((previous) =>
        boxesEqual(previous ?? undefined, placement?.box)
          ? previous
          : (placement?.box ?? null),
      );
    };
    const scheduleMeasure = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    const resize = new ResizeObserver(scheduleMeasure);
    resize.observe(surface);
    surface.addEventListener("scroll", scheduleMeasure, { passive: true });
    window.addEventListener("resize", scheduleMeasure, { passive: true });
    scheduleMeasure();
    return () => {
      if (frame) cancelAnimationFrame(frame);
      resize.disconnect();
      surface.removeEventListener("scroll", scheduleMeasure);
      window.removeEventListener("resize", scheduleMeasure);
    };
  }, [dropTarget]);
  return (
    <div ref={ref} className="spectra-presence-drop-anchor">
      {box && <div className="spectra-presence-drop" style={boxStyle(box)} />}
    </div>
  );
}

/**
 * Edge marker for a collaborator working outside the visible viewport. Reads as
 * "someone is over there", which is honest, rather than a cursor pinned to the
 * border pretending to point at whatever is nearby.
 */
function EdgeMarker({
  edge,
  box,
  color,
  label,
  isAi,
  opacity,
}: {
  edge: OffSurfaceEdge;
  box: SurfaceBox;
  color: string;
  label: string;
  isAi: boolean;
  opacity: number;
}) {
  const vertical = edge === "top" || edge === "bottom";
  return (
    <div
      className="spectra-presence-edge"
      data-edge={edge}
      style={
        {
          "--presence-color": color,
          opacity,
          ...(vertical
            ? { left: Math.max(12, box.left + box.width / 2) }
            : { top: Math.max(12, box.top + box.height / 2) }),
        } as unknown as React.CSSProperties
      }
      title={label}
    >
      {isAi ? <SparkGlyph /> : null}
      <span className="spectra-presence-edge-name">{label}</span>
    </div>
  );
}

/**
 * Cursor glyphs. Drawn as filled paths with a paper-coloured rim so they stay
 * legible over text, coloured cells, canvas objects and dark code alike.
 */
function CursorGlyph({
  mode,
  pressed,
}: {
  mode: CursorMode;
  pressed: boolean;
}) {
  if (mode === "grab")
    return (
      <svg
        className="spectra-presence-glyph"
        viewBox="0 0 16 16"
        width="16"
        height="16"
      >
        <path
          d="M5 7V3.6a1.1 1.1 0 0 1 2.2 0V7m0-.4V2.9a1.1 1.1 0 0 1 2.2 0V7m0-.2V4.1a1.1 1.1 0 0 1 2.2 0V9.4c0 2.4-1.5 4.2-3.9 4.2S4 12.2 4 9.8V8.4c0-.9.4-1.4 1-1.4"
          fill="currentColor"
          stroke="var(--bg-elevated)"
          strokeWidth="0.9"
          strokeLinejoin="round"
        />
      </svg>
    );
  if (mode === "resize")
    return (
      <svg
        className="spectra-presence-glyph"
        viewBox="0 0 16 16"
        width="16"
        height="16"
      >
        <path
          d="M2.5 6V2.5H6M10 13.5h3.5V10M2.8 2.8l4 4M13.2 13.2l-4-4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </svg>
    );
  // Pointer / press / menu share the compact arrow; a press tips it down.
  return (
    <svg
      className="spectra-presence-glyph"
      data-pressed={pressed ? "true" : undefined}
      viewBox="0 0 16 16"
      width="16"
      height="16"
    >
      <path
        d="M4.2 1.6 11.6 8H7.9l2 4.7-1.9.8-2-4.7-2.5 2.4z"
        fill="currentColor"
        stroke="var(--bg-elevated)"
        strokeWidth="0.9"
        strokeLinejoin="round"
      />
      {pressed ? (
        <circle cx="11.8" cy="11.6" r="2.2" fill="currentColor" opacity="0.3" />
      ) : null}
    </svg>
  );
}

function SparkGlyph() {
  return (
    <svg
      className="spectra-presence-spark"
      viewBox="0 0 12 12"
      width="9"
      height="9"
      aria-hidden="true"
    >
      <path
        d="M6 0.6 7 4.3 10.6 5.4 7 6.5 6 10.2 5 6.5 1.4 5.4 5 4.3z"
        fill="currentColor"
      />
    </svg>
  );
}
