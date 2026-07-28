/**
 * The per-actor presentation lane.
 *
 * Execution truth and presentation time are different clocks. The server
 * commits operations as fast as the model validates them; this lane is where
 * those facts become a *performance* with one visible body: frames arrive,
 * the lane decides how the body gets to each next control (a hop, a sweep, or
 * a calm fade across a scope boundary), and nothing ever renders the same
 * actor in two places at once.
 *
 * The lane is deliberately thin in the live path — awareness frames already
 * arrive serialized, and re-buffering them would detach the cursor from the
 * speculative values travelling in the same frame. Its real work is
 * *continuity*: comparing consecutive frames to classify the journey,
 * remembering the last scope, and compressing a joined-late stream into an
 * accelerated but coherent arrival.
 */

import { useEffect, useMemo, useState } from "react";
import {
  canonicalPath,
  pathSegments,
  sameTarget,
  type InteractionState,
  type SemanticTarget,
  type TargetScope,
} from "./interaction-model";
import type { TravelKind } from "./cursor-motion";
import {
  getRunLedger,
  hasSeenOperation,
  markOperationSeen,
  markRunTerminal,
  runIsLiveFor,
} from "./run-ledger";

export type FrameTravel = {
  kind: TravelKind;
  /** True when the target moved to another slide/sheet/file/page/tab. */
  crossesScope: boolean;
  /**
   * Abstract distance between the two targets, in "semantic units" — index
   * steps for ordered collections, A1 distance for sheets, segment hops
   * otherwise. The renderer refines this with real pixels.
   */
  semanticDistance: number;
};

export type LaneFrame = {
  state: InteractionState;
  travel: FrameTravel;
  /** Sequence number within this lane, monotonic per actor. */
  sequence: number;
};

const STAY: FrameTravel = {
  kind: "stay",
  crossesScope: false,
  semanticDistance: 0,
};

function sameScope(
  left: TargetScope | undefined,
  right: TargetScope | undefined,
): boolean {
  if (!left && !right) return true;
  if (!left || !right) return false;
  return left.kind === right.kind && left.id === right.id;
}

/** A1-style cell reference → column/row numbers, for sheet route distances. */
export function cellCoordinates(
  reference: string,
): { column: number; row: number } | null {
  const match = reference.match(/^([A-Za-z]+)(\d+)$/);
  if (!match) return null;
  let column = 0;
  for (const character of match[1]!.toUpperCase()) {
    column = column * 26 + (character.charCodeAt(0) - 64);
  }
  return { column, row: Number(match[2]) };
}

function numericSegment(segment: string | undefined): number | null {
  if (segment === undefined) return null;
  if (!/^\d+$/.test(segment)) return null;
  return Number(segment);
}

/**
 * Distance between two content paths, in route units. Ordered collections
 * measure in index steps (so "question 2 → question 5" reads as three steps of
 * travel); sheet cells measure in grid steps; anything else measures in
 * differing path segments. This is what lets the renderer scale travel time
 * before any pixels are known.
 */
export function semanticPathDistance(from: string, to: string): number {
  const a = pathSegments(from);
  const b = pathSegments(to);
  // Sheet cells: real grid distance.
  const aCell =
    a[0] === "sheets" && a[2] === "cells" ? cellCoordinates(a[3] ?? "") : null;
  const bCell =
    b[0] === "sheets" && b[2] === "cells" ? cellCoordinates(b[3] ?? "") : null;
  if (aCell && bCell && a[1] === b[1]) {
    return (
      Math.abs(aCell.column - bCell.column) + Math.abs(aCell.row - bCell.row)
    );
  }
  let shared = 0;
  while (shared < a.length && shared < b.length && a[shared] === b[shared]) {
    shared += 1;
  }
  let distance = 0;
  for (let index = shared; index < Math.max(a.length, b.length); index += 1) {
    const left = a[index];
    const right = b[index];
    const leftNumber = numericSegment(left);
    const rightNumber = numericSegment(right);
    if (leftNumber !== null && rightNumber !== null) {
      distance += Math.min(12, Math.abs(leftNumber - rightNumber));
      continue;
    }
    if (left === right) continue;
    distance += left === undefined || right === undefined ? 1 : 2;
  }
  return distance;
}

/**
 * Classify the journey between two frames. Cross-scope moves always fade: a
 * line drawn from slide 2 to slide 5 would pretend the body passed through
 * slides it never touched.
 */
export function classifyTravel(
  from: SemanticTarget | null,
  to: SemanticTarget | null,
): FrameTravel {
  if (!to) return STAY;
  if (!from) {
    // Arrival: appear at the control rather than flying in from the edge.
    return { kind: "stay", crossesScope: false, semanticDistance: 0 };
  }
  if (!sameScope(from.scope, to.scope)) {
    return {
      kind: "fade",
      crossesScope: true,
      semanticDistance: semanticPathDistance(from.path, to.path),
    };
  }
  if (sameTarget(from, to)) return STAY;
  const distance = semanticPathDistance(from.path, to.path);
  if (distance === 0) return STAY;
  return {
    kind: distance <= 1 ? "hop" : "journey",
    crossesScope: false,
    semanticDistance: distance,
  };
}

/**
 * One visible body per actor. Consumes the actor's semantic frames and yields
 * exactly one renderable frame at a time, annotated with the journey that
 * brought it there.
 */
export class PresentationLane {
  private latest: LaneFrame | null = null;
  private previousTarget: SemanticTarget | null = null;
  private sequence = 0;
  private listeners = new Set<() => void>();

  constructor(readonly actorKey: string) {}

  /** Ingest a live frame. Out-of-order arrivals are dropped. */
  push(state: InteractionState): LaneFrame {
    const travel = classifyTravel(this.previousTarget, state.target);
    this.previousTarget = state.target ?? this.previousTarget;
    this.sequence += 1;
    this.latest = { state, travel, sequence: this.sequence };
    this.emit();
    return this.latest;
  }

  /** The frame the renderer should currently paint, if any. */
  current(): LaneFrame | null {
    return this.latest;
  }

  clear(): void {
    this.latest = null;
    this.previousTarget = null;
    this.emit();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

/* ------------------------------------------------------------------ *
 * Route planning
 * ------------------------------------------------------------------ */

/**
 * A coherent working route through a set of changed paths: top-to-bottom for
 * ordered artifacts, grid order for sheets, nearest-next for canvases when
 * positions are known. Catch-up and materialisation use this so a joined-late
 * performance reads as a methodical pass rather than model arrival order.
 */
export function orderPathsByRoute(
  paths: readonly string[],
  positionOf?: (path: string) => { x: number; y: number } | null,
): string[] {
  const unique = [...new Set(paths.map(canonicalPath))];

  const positioned = positionOf
    ? unique.filter((path) => positionOf(path) !== null)
    : [];
  if (positionOf && positioned.length === unique.length && unique.length > 1) {
    // Nearest-next sweep from the top-left-most item.
    const remaining = new Map(
      unique.map((path) => [path, positionOf(path)!] as const),
    );
    const ordered: string[] = [];
    let current = [...remaining.entries()].sort(
      (a, b) => a[1].y - b[1].y || a[1].x - b[1].x,
    )[0]!;
    remaining.delete(current[0]);
    ordered.push(current[0]);
    while (remaining.size) {
      let best: [string, { x: number; y: number }] | null = null;
      let bestDistance = Number.POSITIVE_INFINITY;
      for (const entry of remaining) {
        const distance = Math.hypot(
          entry[1].x - current[1].x,
          entry[1].y - current[1].y,
        );
        if (distance < bestDistance) {
          bestDistance = distance;
          best = entry;
        }
      }
      current = best!;
      remaining.delete(current[0]);
      ordered.push(current[0]);
    }
    return ordered;
  }

  return unique.sort((left, right) => {
    const a = pathSegments(left);
    const b = pathSegments(right);
    // Sheet cells order by row, then column.
    const aCell =
      a[0] === "sheets" && a[2] === "cells"
        ? cellCoordinates(a[3] ?? "")
        : null;
    const bCell =
      b[0] === "sheets" && b[2] === "cells"
        ? cellCoordinates(b[3] ?? "")
        : null;
    if (aCell && bCell) {
      if (a[1] !== b[1]) return String(a[1]).localeCompare(String(b[1]));
      return aCell.row - bCell.row || aCell.column - bCell.column;
    }
    const length = Math.max(a.length, b.length);
    for (let index = 0; index < length; index += 1) {
      const leftSegment = a[index];
      const rightSegment = b[index];
      if (leftSegment === rightSegment) continue;
      if (leftSegment === undefined) return -1;
      if (rightSegment === undefined) return 1;
      const leftNumber = numericSegment(leftSegment);
      const rightNumber = numericSegment(rightSegment);
      if (leftNumber !== null && rightNumber !== null) {
        return leftNumber - rightNumber;
      }
      return leftSegment.localeCompare(rightSegment);
    }
    return 0;
  });
}

/* ------------------------------------------------------------------ *
 * Join-late arrival
 * ------------------------------------------------------------------ */

/** Steps of unseen work an arrival will walk before simply settling. */
const MAX_ARRIVAL_STEPS = 6;
/** Accelerated cadence: legible, but plainly faster than live performance. */
const ARRIVAL_STEP_MS = 190;

/** A path counts as witnessed per run, so a reopen never replays it. */
function arrivalOperationId(path: string): string {
  return `join:${canonicalPath(path)}`;
}

/**
 * The route an artifact should walk when it is opened *during* a run that
 * already changed some of its controls off-screen. Empty means "show the clean
 * durable state and play nothing".
 *
 * Three rules keep an arrival honest, and all three live here:
 *
 *  - A **terminal** run never replays. The artifact shows its final state, with
 *    no catch-up chrome, however much the AI changed it earlier.
 *  - Work this client already watched is never shown twice, across closes,
 *    reopens and reloads within the session.
 *  - The walk is bounded, so joining a long run reads as "catching up" rather
 *    than as a slow highlight reel of everything that happened.
 */
export function planJoinLateArrival(
  runId: string | null | undefined,
  changedPaths: readonly string[],
  positionOf?: (path: string) => { x: number; y: number } | null,
): string[] {
  if (!runId || !changedPaths.length) return [];
  if (!runIsLiveFor(runId)) return [];
  const unseen = changedPaths.filter(
    (path) => !hasSeenOperation(runId, arrivalOperationId(path)),
  );
  if (!unseen.length) return [];
  return orderPathsByRoute(unseen, positionOf).slice(0, MAX_ARRIVAL_STEPS);
}

/**
 * Play a join-late arrival.
 *
 * This is not a second pacing system: the live performance is still driven
 * entirely by the actor's awareness frames. This only answers the question the
 * live stream cannot, because it was never watched — "what did I miss?" — and
 * it answers it the same way the lane answers everything else, by walking a
 * coherent route rather than exposing the durable end state as a jump.
 */
export function useJoinLateArrival(input: {
  /** The run that is changing this artifact, when one is. */
  runId: string | null | undefined;
  /** Canonical content paths this run has changed in this artifact. */
  changedPaths: readonly string[];
  /** False while the editor is unmounted, read-only or otherwise not watching. */
  enabled: boolean;
  /** Canvas position of a path, so spatial artifacts sweep nearest-next. */
  positionOf?: (path: string) => { x: number; y: number } | null;
  reducedMotion?: boolean;
}): { active: boolean; paths: string[] } {
  const { runId, enabled, positionOf, reducedMotion = false } = input;
  const pathKey = [...input.changedPaths].sort().join("|");
  const [step, setStep] = useState(0);

  const route = useMemo(
    () =>
      enabled ? planJoinLateArrival(runId, input.changedPaths, positionOf) : [],
    // `pathKey` stands in for the path array's identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [runId, enabled, pathKey, positionOf],
  );

  // Identity of the walk currently under way. A new route restarts the step
  // counter; the same route must not, or the arrival would loop on its first
  // control every time the live stream publishes another beat.
  const routeKey = `${runId ?? ""}~${route.join("|")}`;

  useEffect(() => {
    if (!runId) return;
    // A run that ended while this artifact was closed is history, not a
    // performance. Record the terminal phase so nothing tries to catch up.
    if (!runIsLiveFor(runId)) {
      const phase = getRunLedger(runId)?.phase;
      if (phase) markRunTerminal(runId, phase);
    }
  }, [runId]);

  useEffect(() => {
    setStep(0);
  }, [routeKey]);

  useEffect(() => {
    if (!runId || !route.length) return;
    if (reducedMotion) {
      // No motion budget: accept the durable state and remember it was seen,
      // rather than flashing every missed control at once.
      for (const path of route) {
        markOperationSeen(runId, arrivalOperationId(path));
      }
      setStep(route.length);
      return;
    }
    if (step >= route.length) return;
    const path = route[step]!;
    const timer = window.setTimeout(() => {
      markOperationSeen(runId, arrivalOperationId(path));
      setStep((current) => current + 1);
    }, ARRIVAL_STEP_MS);
    return () => window.clearTimeout(timer);
  }, [runId, route, routeKey, step, reducedMotion]);

  const active = Boolean(runId) && route.length > 0 && step < route.length;
  return {
    active,
    // One control at a time: an arrival that lit every missed field at once
    // would be exactly the broad wash this system exists to avoid.
    paths: active ? [route[step]!] : [],
  };
}
