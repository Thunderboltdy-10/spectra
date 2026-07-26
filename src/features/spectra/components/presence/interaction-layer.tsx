"use client";

/**
 * The interaction layer: one overlay that paints every collaborator's presence
 * natively, human and AI alike.
 *
 * Design intent, drawn from Spectra's reference interfaces: a precise filled
 * arrow with a compact name flag, hairline chrome, a single accent per actor,
 * and no decorative glow. An AI actor reuses its owner's colour and adds one
 * small sparkle, so "Nadia M." and "Nadia M.'s AI" read as the same person's
 * presence rather than two unrelated participants.
 *
 * The layer is a sticky zero-height node pinned to the top of the editor's
 * scroll viewport. Every position is recomputed locally from semantics each
 * frame, so nothing here depends on a peer's pane size, scroll offset or zoom.
 */

import { useEffect, useMemo, useRef, useState } from "react";
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

/** Presence for an actor whose last frame is older than this is dropped. */
const STALE_AFTER_MS = 20_000;

type ActorVisual = {
  state: InteractionState;
  label: string;
  color: string;
  mode: CursorMode;
  placement: InteractionPlacement | null;
  description: string;
};

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

export function InteractionLayer({
  states,
  localClientId,
  /** Set while the local user has scrolled; suppresses transitions to avoid smearing. */
  quiet = false,
}: {
  states: readonly InteractionState[];
  localClientId?: string;
  quiet?: boolean;
}) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const [visuals, setVisuals] = useState<ActorVisual[]>([]);

  // Remote actors with a renderable state, freshness-checked so a disconnected
  // peer or a finished run can never leave a cursor behind.
  const actors = useMemo(
    () =>
      states.filter((state) => {
        if (state.actor.clientId === localClientId) return false;
        if (!stateIsVisible(state)) return false;
        if (
          TERMINAL_LIFECYCLES.has(state.lifecycle) &&
          state.lifecycle !== "completed"
        )
          return false;
        return true;
      }),
    [states, localClientId],
  );

  /**
   * Structural signature of the actor set. Positions are recomputed every frame
   * regardless; this only decides when the React tree itself must change.
   */
  const signature = useMemo(
    () =>
      actors
        .map((state) =>
          [
            state.actor.clientId,
            state.act.kind,
            state.lifecycle,
            state.target?.path ?? "",
            state.target?.part ?? "",
            state.menu?.highlighted ?? "",
            state.menu?.options.length ?? 0,
            state.note ?? "",
          ].join("~"),
        )
        .join("|"),
    [actors],
  );

  useEffect(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    if (!actors.length) {
      setVisuals((previous) => (previous.length ? [] : previous));
      return;
    }
    const surface =
      anchor.closest<HTMLElement>(`[${SURFACE_ATTRIBUTE}]`) ??
      anchor.parentElement;
    if (!surface) return;

    let frame = 0;
    let disposed = false;

    const measure = () => {
      if (disposed) return;
      const surfaceFrame = resolveSurfaceFrame(surface, anchor);
      // Freshness is judged here, inside the frame loop, so a peer that drops
      // off the network fades out on its own instead of leaving a cursor parked
      // until the next awareness update that may never come.
      const now = Date.now();
      const next: ActorVisual[] = actors
        .filter((state) => now - state.at <= STALE_AFTER_MS)
        .map((state) => {
          const placement = state.target
            ? resolvePlacement(surfaceFrame, {
                target: state.target,
                ...placementRequest(state),
              })
            : null;
          return {
            state,
            label: actorLabel(state.actor),
            color: presenceColor(state.actor),
            mode: cursorModeForAct(state.act),
            placement,
            description: describeState(state),
          };
        });
      setVisuals((previous) => (visualsEqual(previous, next) ? previous : next));
      frame = requestAnimationFrame(measure);
    };

    frame = requestAnimationFrame(measure);
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
    };
  }, [actors, signature]);

  if (!visuals.length) return null;

  return (
    <div
      ref={anchorRef}
      className="spectra-presence-layer"
      data-quiet={quiet ? "true" : undefined}
      aria-hidden="true"
    >
      {visuals.map((visual) => (
        <ActorPresence key={visual.state.actor.clientId} visual={visual} />
      ))}
    </div>
  );
}

/** A cheap frame-to-frame comparison; sub-pixel jitter must not re-render. */
function visualsEqual(left: ActorVisual[], right: ActorVisual[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((entry, index) => {
    const other = right[index]!;
    if (entry.state.actor.clientId !== other.state.actor.clientId) return false;
    if (entry.state.act.kind !== other.state.act.kind) return false;
    if (entry.description !== other.description) return false;
    if (entry.mode !== other.mode) return false;
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
  if (!near(left.point.left, right.point.left) || !near(left.point.top, right.point.top))
    return false;
  if (!boxesEqual(left.box, right.box)) return false;
  if (!boxesEqual(left.caret, right.caret)) return false;
  if (!boxesEqual(left.part, right.part)) return false;
  const leftSelection = left.selection ?? [];
  const rightSelection = right.selection ?? [];
  if (leftSelection.length !== rightSelection.length) return false;
  return leftSelection.every((box, index) => boxesEqual(box, rightSelection[index]));
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
  const { placement, color, state, mode, label, description } = visual;
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
      />
    );
  }

  const style = { "--presence-color": color } as React.CSSProperties;
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

  return (
    <div className="spectra-presence-actor" style={style}>
      {/* Selection line boxes, drawn under all other chrome. */}
      {placement.selection?.map((box, index) => (
        <div
          key={`selection-${index}`}
          className="spectra-presence-selection"
          style={boxStyle(box)}
        />
      ))}

      {/* Container affordance: a hairline frame on the control being operated.
          Only drawn for acts that concern the control as a whole, so a caret in a
          field never lights up the surrounding card. */}
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

      {/* Resize handles mirror the editor's own affordance. */}
      {resizing && (
        <div className="spectra-presence-handles" style={boxStyle(placement.box)}>
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

      {/* Caret, positioned on the exact glyph. */}
      {placement.caret && (mode === "caret" || mode === "selection") && (
        <span
          className="spectra-presence-caret"
          data-typing={state.act.kind === "type" ? "true" : undefined}
          style={{
            left: placement.caret.left,
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

      {/* Cursor and flag. */}
      <div
        className="spectra-presence-cursor"
        data-mode={mode}
        data-ai={isAi ? "true" : undefined}
        style={{ left: placement.point.left, top: placement.point.top }}
      >
        {mode !== "caret" && mode !== "selection" && mode !== "hidden" && (
          <CursorGlyph mode={mode} />
        )}
        <span className="spectra-presence-flag" data-ai={isAi ? "true" : undefined}>
          {isAi && <SparkGlyph />}
          <span className="spectra-presence-flag-name">{label}</span>
          {description && description !== "Present" && (
            <>
              <span className="spectra-presence-flag-rule" />
              <span className="spectra-presence-flag-action">{description}</span>
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
      const placement = resolvePlacement(
        resolveSurfaceFrame(surface, anchor),
        { target: dropTarget },
      );
      setBox((previous) =>
        boxesEqual(previous ?? undefined, placement?.box)
          ? previous
          : (placement?.box ?? null),
      );
      frame = requestAnimationFrame(measure);
    };
    frame = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(frame);
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
}: {
  edge: OffSurfaceEdge;
  box: SurfaceBox;
  color: string;
  label: string;
  isAi: boolean;
}) {
  const vertical = edge === "top" || edge === "bottom";
  return (
    <div
      className="spectra-presence-edge"
      data-edge={edge}
      style={
        {
          "--presence-color": color,
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
function CursorGlyph({ mode }: { mode: CursorMode }) {
  if (mode === "grab")
    return (
      <svg className="spectra-presence-glyph" viewBox="0 0 16 16" width="16" height="16">
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
      <svg className="spectra-presence-glyph" viewBox="0 0 16 16" width="16" height="16">
        <path
          d="M2.5 6V2.5H6M10 13.5h3.5V10M2.8 2.8l4 4M13.2 13.2l-4-4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </svg>
    );
  if (mode === "press")
    return (
      <svg className="spectra-presence-glyph" viewBox="0 0 16 16" width="16" height="16">
        <path
          d="M4.2 1.6 11.6 8H7.9l2 4.7-1.9.8-2-4.7-2.5 2.4z"
          fill="currentColor"
          stroke="var(--bg-elevated)"
          strokeWidth="0.9"
          strokeLinejoin="round"
        />
        <circle cx="12.6" cy="12.4" r="2.4" fill="currentColor" opacity="0.35" />
      </svg>
    );
  if (mode === "menu")
    return (
      <svg className="spectra-presence-glyph" viewBox="0 0 16 16" width="16" height="16">
        <path
          d="M4.2 1.6 11.6 8H7.9l2 4.7-1.9.8-2-4.7-2.5 2.4z"
          fill="currentColor"
          stroke="var(--bg-elevated)"
          strokeWidth="0.9"
          strokeLinejoin="round"
        />
      </svg>
    );
  // Default pointer: a compact solid arrow, the reference interfaces' glyph.
  return (
    <svg className="spectra-presence-glyph" viewBox="0 0 16 16" width="16" height="16">
      <path
        d="M4.2 1.6 11.6 8H7.9l2 4.7-1.9.8-2-4.7-2.5 2.4z"
        fill="currentColor"
        stroke="var(--bg-elevated)"
        strokeWidth="0.9"
        strokeLinejoin="round"
      />
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
