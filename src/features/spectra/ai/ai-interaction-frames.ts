/**
 * Semantic presence frames for AI work.
 *
 * The AI operation pipeline streams provisional artifact values. This module is
 * the single place that turns one of those values into the protocol v2
 * `InteractionState` peers render: it names the control being operated, the act
 * being performed and the character position it happens at, so every client
 * resolves geometry locally instead of trusting a coordinate minted elsewhere.
 *
 * Deriving the act from the *values themselves* — rather than from a gesture
 * label chosen by the caller — is what keeps presence honest. An AI frame can
 * only claim to be typing when characters actually arrived.
 */

import type { ArtifactTypeKey } from "../artifacts/types";
import { buildTarget } from "../collaboration/control-descriptors";
import {
  canonicalPath,
  type ActorIdentity,
  type InteractionAct,
  type InteractionLifecycle,
  type InteractionState,
  type MenuObservation,
  type SemanticTarget,
  type SpeculativePatch,
  type TextPoint,
} from "../collaboration/interaction-model";
import {
  describeTextDelta,
  pointForOffset,
} from "../collaboration/text-transition";

/** Values a spatial primitive carries, used to tell a move from a resize. */
type SpatialValue = {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  start?: string;
  end?: string;
};

function asSpatial(value: unknown): SpatialValue | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const pick = (key: string) =>
    typeof record[key] === "number" ? (record[key] as number) : undefined;
  const time = (key: string) =>
    typeof record[key] === "string" ? (record[key] as string) : undefined;
  const spatial: SpatialValue = {
    ...(pick("x") !== undefined ? { x: pick("x") } : {}),
    ...(pick("y") !== undefined ? { y: pick("y") } : {}),
    ...(pick("width") !== undefined ? { width: pick("width") } : {}),
    ...(pick("height") !== undefined ? { height: pick("height") } : {}),
    ...(time("start") ? { start: time("start") } : {}),
    ...(time("end") ? { end: time("end") } : {}),
  };
  return Object.keys(spatial).length ? spatial : null;
}

/**
 * Timetable events move by changing `start`/`end` and resize by changing only
 * `end`, which reads as a drag and a resize respectively on the timeline.
 */
function spatialAct(
  before: SpatialValue,
  after: SpatialValue,
): InteractionAct | null {
  const moved =
    (after.x !== undefined && after.x !== before.x) ||
    (after.y !== undefined && after.y !== before.y) ||
    (after.start !== undefined && after.start !== before.start);
  const resized =
    (after.width !== undefined && after.width !== before.width) ||
    (after.height !== undefined && after.height !== before.height) ||
    (after.end !== undefined &&
      after.end !== before.end &&
      after.start === before.start);
  if (moved)
    return {
      kind: "dragMove",
      ...(after.x !== undefined && after.y !== undefined
        ? { at: { x: after.x, y: after.y } }
        : {}),
    };
  if (resized)
    return {
      kind: "resizeMove",
      ...(after.width !== undefined && after.height !== undefined
        ? { size: { width: after.width, height: after.height } }
        : {}),
    };
  return null;
}

function textPoint(value: string, offset: number): TextPoint {
  const point = pointForOffset(value, offset);
  return point.line > 0
    ? { offset: point.offset, line: point.line }
    : { offset: point.offset };
}

/** Where `longer` holds `shorter` with one run of characters added, that run. */
function keyedSpan(shorter: string, longer: string): { start: number; end: number } | null {
  if (longer.length <= shorter.length) return null;
  let start = 0;
  while (start < shorter.length && shorter[start] === longer[start]) start += 1;
  const end = start + longer.length - shorter.length;
  return longer.slice(end) === shorter.slice(start) ? { start, end } : null;
}

/**
 * Derive the act from what actually changed between two provisional values at
 * the same path. Returns `focus` when nothing observable changed, so presence
 * still parks on the right control instead of claiming an edit.
 */
export function actForValueChange(input: {
  before: unknown;
  after: unknown;
  /** Set when the caller is mid-selection before a replacement lands. */
  selectionEnd?: number;
  /** Where that selection starts; the start of the value when absent. */
  selectionStart?: number;
}): InteractionAct {
  const { before, after } = input;

  if (before === undefined && after !== undefined) return { kind: "create" };
  if (before !== undefined && after === undefined) return { kind: "remove" };

  if (typeof before === "boolean" || typeof after === "boolean")
    return { kind: "toggle", value: Boolean(after) };

  if (typeof after === "string" && typeof before === "string") {
    if (typeof input.selectionEnd === "number" && input.selectionEnd > 0) {
      return {
        kind: "select",
        span: {
          anchor: textPoint(before, input.selectionStart ?? 0),
          head: textPoint(before, input.selectionEnd),
        },
      };
    }
    // A keystroke is judged by its characters: "I" to "It" is typing, though
    // the word-level delta below would call it a rewrite of the word.
    const added = keyedSpan(before, after);
    if (added) {
      const point = textPoint(after, added.end);
      return added.end >= after.length ? { kind: "type", point } : { kind: "insert", point };
    }
    const erased = keyedSpan(after, before);
    if (erased) {
      const point = textPoint(after, erased.start);
      return { kind: "delete", span: { anchor: point, head: point } };
    }
    const delta = describeTextDelta(before, after);
    if (!delta) return { kind: "focus" };
    if (delta.removed && delta.inserted) {
      return {
        kind: "replace",
        span: {
          anchor: textPoint(after, delta.start),
          head: textPoint(after, delta.start + delta.inserted.length),
        },
      };
    }
    if (delta.removed) {
      const point = textPoint(after, delta.start);
      return { kind: "delete", span: { anchor: point, head: point } };
    }
    // Appending to the tail reads as typing; an interior insertion is an insert.
    const appending = delta.start >= before.length;
    const point = textPoint(after, delta.start + delta.inserted.length);
    return appending ? { kind: "type", point } : { kind: "insert", point };
  }

  const beforeSpatial = asSpatial(before);
  const afterSpatial = asSpatial(after);
  if (beforeSpatial && afterSpatial) {
    const act = spatialAct(beforeSpatial, afterSpatial);
    if (act) return act;
  }

  if (Array.isArray(before) && Array.isArray(after)) {
    if (after.length > before.length) return { kind: "create" };
    if (after.length < before.length) return { kind: "remove" };
  }

  return { kind: "focus" };
}

export type AiFrameInput = {
  artifactId: string;
  typeKey: ArtifactTypeKey;
  actor: ActorIdentity;
  /** Content-relative pointer; `/content` prefixes are stripped. */
  path: string;
  regionId?: string;
  /** Value at `path` in the previous frame (or the pre-edit baseline). */
  before: unknown;
  /** Value at `path` in this frame. */
  after: unknown;
  /** Overrides the derived act — used for menus, presses and view switches. */
  act?: InteractionAct;
  selectionEnd?: number;
  selectionStart?: number;
  menu?: MenuObservation | null;
  lifecycle?: InteractionLifecycle;
  /** Monotonic per actor; peers drop frames that arrive out of order. */
  sequence: number;
  /** Provisional patches peers apply to render the speculative value. */
  patches?: SpeculativePatch[];
  heldRegionIds?: string[];
  part?: string;
  note?: string;
  at?: number;
};

/**
 * Build the presence frame for one step of AI work. Callers publish the result
 * verbatim on awareness under `interactionState`.
 */
export function aiInteractionFrame(input: AiFrameInput): InteractionState {
  const target: SemanticTarget = buildTarget({
    typeKey: input.typeKey,
    artifactId: input.artifactId,
    path: canonicalPath(input.path),
    ...(input.regionId ? { regionId: input.regionId } : {}),
    ...(input.part ? { part: input.part } : {}),
  });
  const act =
    input.act ??
    actForValueChange({
      before: input.before,
      after: input.after,
      ...(input.selectionEnd !== undefined
        ? { selectionEnd: input.selectionEnd }
        : {}),
      ...(input.selectionStart !== undefined
        ? { selectionStart: input.selectionStart }
        : {}),
    });
  return {
    v: 2,
    actor: input.actor,
    act,
    lifecycle: input.lifecycle ?? "active",
    target,
    ...(input.menu !== undefined ? { menu: input.menu } : {}),
    ...(input.patches?.length
      ? { speculation: { sequence: input.sequence, patches: input.patches } }
      : {}),
    ...(input.note ? { note: input.note } : {}),
    ...(input.heldRegionIds?.length
      ? { heldRegionIds: input.heldRegionIds }
      : {}),
    at: input.at ?? Date.now(),
  };
}

/**
 * The frame published when AI work finishes on a target: presence settles on
 * the control it just edited for a beat before the actor goes idle, which is
 * what gives peers a moment to see where the change landed.
 */
export function aiSettleFrame(
  input: Omit<AiFrameInput, "act" | "lifecycle" | "patches">,
): InteractionState {
  return aiInteractionFrame({
    ...input,
    act: { kind: "focus" },
    lifecycle: "settled",
  });
}
