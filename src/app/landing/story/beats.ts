/**
 * Beats: what an actor is doing, and when.
 *
 * A beat is declarative and time-free. It says "between this point and that
 * point of the scene, Pablo drags the assignment card onto the prism". It
 * never says where anything is on screen. Position is resolved later, from
 * the live DOM, by the same semantic geometry the product uses for real
 * collaborators — which is what lets the whole story survive scrolling,
 * resizing and reflow.
 *
 * Because a beat is a pure function of scene-local progress, scrubbing
 * backwards recomputes rather than rewinds. Nothing here holds state.
 */

import type {
  ControlPrimitive,
  InteractionAct,
  InteractionLifecycle,
  InteractionState,
  SemanticTarget,
} from "@/features/spectra/collaboration/interaction-model";
import { canonicalPath } from "@/features/spectra/collaboration/interaction-model";
import { ACTORS, STORY_ARTIFACT, type ActorId } from "./actors";

export type BeatAct =
  /** Author text into the target. The same path keys the rendered text. */
  | { kind: "type"; text: string; speed?: number }
  /** Carry an object to another target. */
  | { kind: "drag"; to: string; toPart?: string }
  /** Pull a handle. `handle` is a `BOX_HANDLE_PARTS` value. */
  | { kind: "resize"; handle: string }
  | { kind: "press" }
  | { kind: "hover" }
  | { kind: "focus" }
  | { kind: "select"; from?: number; to?: number; line?: number }
  | { kind: "menu"; option: string }
  | { kind: "switchView"; to: string }
  | { kind: "create" }
  /** Present, resolving, not yet able to act: the contention beat. */
  | { kind: "wait" };

export type Beat = {
  actor: ActorId;
  /** Scene-local window, 0..1. */
  from: number;
  to: number;
  /** Semantic path on the landing canvas. Also the authoring key. */
  path: string;
  part?: string;
  primitive?: ControlPrimitive;
  label?: string;
  act: BeatAct;
  lifecycle?: InteractionLifecycle;
  /** Short human-readable explanation, shown by the presence layer. */
  note?: string;
  /** Extra scene-t the actor lingers after finishing, before leaving. */
  linger?: number;
};

export function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** Progress through a beat's own window, 0..1. */
export function beatProgress(beat: Beat, t: number): number {
  if (beat.to <= beat.from) return t >= beat.to ? 1 : 0;
  return clamp01((t - beat.from) / (beat.to - beat.from));
}

function ease(t: number): number {
  return t * t * (3 - 2 * t);
}

function target(beat: Beat): SemanticTarget {
  return {
    artifactId: STORY_ARTIFACT,
    path: canonicalPath(beat.path),
    primitive: beat.primitive ?? primitiveFor(beat.act),
    ...(beat.part ? { part: beat.part } : {}),
    ...(beat.label ? { label: beat.label } : {}),
  };
}

function primitiveFor(act: BeatAct): ControlPrimitive {
  switch (act.kind) {
    case "type":
    case "select":
      return "richtext";
    case "drag":
    case "resize":
      return "canvasObject";
    case "menu":
      return "dropdown";
    case "switchView":
      return "viewSwitch";
    case "press":
      return "button";
    case "hover":
      return "surface";
    default:
      return "canvasObject";
  }
}

/**
 * How many characters of a typed beat have been committed at `t`.
 *
 * Typing accelerates: the first phrase reads at a human pace so the visitor
 * registers that someone is writing, then the rest catches up. Nobody wants to
 * watch a paragraph appear one character at a time.
 */
export function typedCount(beat: Beat, t: number): number {
  if (beat.act.kind !== "type") return 0;
  const text = beat.act.text;
  const p = beatProgress(beat, t);
  if (p >= 1) return text.length;
  if (p <= 0) return 0;
  /* First ~30% of the window covers the opening phrase; the remainder covers
     the rest. The curve is monotonic, so scrubbing is exact. */
  const lead = Math.min(text.length, Math.max(12, Math.round(text.length * 0.3)));
  const leadWindow = 0.42;
  if (p < leadWindow) return Math.round((p / leadWindow) * lead);
  const rest = (p - leadWindow) / (1 - leadWindow);
  return Math.min(text.length, lead + Math.round(ease(rest) * (text.length - lead)));
}

/** The act an actor is publishing at `t`, or null when the beat is over. */
function actAt(beat: Beat, t: number): InteractionAct | null {
  const p = beatProgress(beat, t);
  switch (beat.act.kind) {
    case "type": {
      const count = typedCount(beat, t);
      if (p >= 1) return { kind: "caret", point: { offset: count } };
      return { kind: "type", point: { offset: count } };
    }
    case "drag": {
      if (p <= 0.06) return { kind: "dragStart" };
      if (p >= 0.94) return { kind: "dragRelease" };
      return { kind: "dragMove", at: { x: 0.5, y: 0.5 } };
    }
    case "resize": {
      if (p <= 0.08) return { kind: "resizeStart" };
      if (p >= 0.92) return { kind: "resizeRelease" };
      return { kind: "resizeMove" };
    }
    case "press":
      return { kind: "press" };
    case "hover":
      return { kind: "hover", at: { x: 0.5, y: 0.5 } };
    case "focus":
      return { kind: "focus" };
    case "select": {
      const from = beat.act.from ?? 0;
      const to = beat.act.to ?? 0;
      const head = from + Math.round((to - from) * ease(p));
      return {
        kind: "select",
        span: {
          anchor: {
            offset: from,
            ...(beat.act.line !== undefined ? { line: beat.act.line } : {}),
          },
          head: {
            offset: head,
            ...(beat.act.line !== undefined ? { line: beat.act.line } : {}),
          },
        },
      };
    }
    case "menu": {
      if (p < 0.3) return { kind: "menuOpen" };
      if (p < 0.75) return { kind: "menuNavigate", option: beat.act.option };
      return { kind: "menuSelect", option: beat.act.option };
    }
    case "switchView":
      return { kind: "switchView", to: beat.act.to };
    case "create":
      return { kind: "create" };
    case "wait":
      return { kind: "hover", at: { x: 0.5, y: 0.5 } };
  }
}

function lifecycleAt(beat: Beat, t: number): InteractionLifecycle {
  if (beat.lifecycle) return beat.lifecycle;
  if (beat.act.kind === "wait") return "blocked";
  return beatProgress(beat, t) >= 1 ? "settled" : "active";
}

/**
 * Which beats are live at `t`.
 *
 * An actor performs one object at a time, so if two of their beats overlap the
 * later one wins: the actor moved on. This is the concurrency discipline the
 * product's presence model already assumes, enforced structurally rather than
 * left to the author to remember.
 */
export function activeBeats(beats: readonly Beat[], t: number): Beat[] {
  const byActor = new Map<ActorId, Beat>();
  for (const beat of beats) {
    const end = beat.to + (beat.linger ?? 0.02);
    if (t < beat.from || t > end) continue;
    const held = byActor.get(beat.actor);
    if (!held || beat.from >= held.from) byActor.set(beat.actor, beat);
  }
  return [...byActor.values()];
}

/**
 * The presence payload for a moment in the story.
 *
 * `at` is bucketed so a scrubbing visitor does not produce a new timestamp
 * every frame; the presence layer treats states as fresh for far longer than
 * the bucket, and a stable value keeps its memoisation intact.
 */
export function statesAt(
  beats: readonly Beat[],
  t: number,
  clockBucket: number,
): InteractionState[] {
  const states: InteractionState[] = [];
  for (const beat of activeBeats(beats, t)) {
    const act = actAt(beat, t);
    if (!act) continue;
    states.push({
      v: 2,
      actor: ACTORS[beat.actor],
      act,
      lifecycle: lifecycleAt(beat, t),
      target: target(beat),
      ...(beat.act.kind === "drag"
        ? {
            dropTarget: {
              artifactId: STORY_ARTIFACT,
              path: canonicalPath(beat.act.to),
              primitive: "canvasObject" as ControlPrimitive,
              ...(beat.act.toPart ? { part: beat.act.toPart } : {}),
            },
          }
        : {}),
      ...(beat.note ? { note: beat.note } : {}),
      at: clockBucket,
    });
  }
  return states;
}

/**
 * The authored state of one path: how much of its text exists yet, and
 * whether an actor's caret is currently sitting in it.
 */
export type Authoring = {
  text: string;
  /** Characters committed so far. */
  count: number;
  /** An actor is actively writing here right now. */
  writing: boolean;
  /** The caret should be visible (writing, or just finished). */
  caret: boolean;
  actor: ActorId | null;
};

const NOT_AUTHORED: Authoring = {
  text: "",
  count: 0,
  writing: false,
  caret: false,
  actor: null,
};

/**
 * Resolve what exists at `path` at time `t`.
 *
 * Text commits: once fully written it stays written for the rest of the
 * scene, and on reverse it is removed as a block rather than un-typed
 * character by character. Watching a person type backwards is uncanny; the
 * product's own reveal grammar is the right fallback.
 */
export function authoringAt(
  beats: readonly Beat[],
  path: string,
  t: number,
): Authoring {
  const canonical = canonicalPath(path);
  let chosen: Beat | null = null;
  for (const beat of beats) {
    if (beat.act.kind !== "type") continue;
    if (canonicalPath(beat.path) !== canonical) continue;
    if (t < beat.from) continue;
    if (!chosen || beat.from > chosen.from) chosen = beat;
  }
  if (!chosen || chosen.act.kind !== "type") return NOT_AUTHORED;
  const count = typedCount(chosen, t);
  const done = count >= chosen.act.text.length;
  return {
    text: chosen.act.text,
    count,
    writing: !done,
    caret: t <= chosen.to + (chosen.linger ?? 0.02) + 0.01,
    actor: chosen.actor,
  };
}

/**
 * The finished text of a path, independent of time.
 *
 * The animated rendering writes characters straight into the DOM, which means
 * the server-rendered markup carries none of the page's actual words. This is
 * what the accessible mirror reads: the same string, in the tree, from the
 * first byte, for anyone who is not going to watch it being typed.
 */
export function authoredText(beats: readonly Beat[], path: string): string {
  const canonical = canonicalPath(path);
  let chosen: Beat | null = null;
  for (const beat of beats) {
    if (beat.act.kind !== "type") continue;
    if (canonicalPath(beat.path) !== canonical) continue;
    if (!chosen || beat.from > chosen.from) chosen = beat;
  }
  return chosen?.act.kind === "type" ? chosen.act.text : "";
}

/**
 * How present an object is at `t`, 0..1.
 *
 * An object that an actor drags in is *carried*: it exists from the moment
 * the drag begins, and its own entrance is the drag. Everything else that a
 * scene owns is simply present. Nothing appears by fading up out of nothing.
 */
export function carriedAt(
  beats: readonly Beat[],
  path: string,
  t: number,
): { present: boolean; progress: number; actor: ActorId | null } {
  const canonical = canonicalPath(path);
  for (const beat of beats) {
    if (beat.act.kind !== "drag") continue;
    if (canonicalPath(beat.path) !== canonical) continue;
    if (t < beat.from) return { present: false, progress: 0, actor: beat.actor };
    if (t <= beat.to)
      return {
        present: true,
        progress: beatProgress(beat, t),
        actor: beat.actor,
      };
    return { present: true, progress: 1, actor: beat.actor };
  }
  return { present: true, progress: 1, actor: null };
}
