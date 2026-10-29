import type { ArtifactTypeKey } from "../artifacts/types";
import { aiInteractionFrame, aiSettleFrame } from "../ai/ai-interaction-frames";
import type { ArtifactLiveValue } from "./artifact-yjs-model";
import {
  artifactLivePreviewPatches,
  valueAtPath,
  type ArtifactLivePreviewPatch,
} from "./artifact-live-preview";
import { hashSeed } from "./hand/random";
import {
  buildArtifactLivePreviewBeats,
  type AiStreamBeat,
} from "./interaction-choreography";
import type { ActorIdentity, InteractionAct } from "./interaction-model";

/*
 * An AI edit as one performance.
 *
 * The server sends each edit once: who is acting, what changed (the values at
 * the changed paths, before and after) and a seed. Every viewer expands it
 * locally into the same human-paced gestures (the hand), so motion is smooth
 * at the viewer's frame rate, nothing is streamed frame by frame, and the
 * durable write never waits for the animation. The edit itself is committed
 * straight away; viewers show the performance over it until it ends.
 */

export const PERFORMANCE_FIELD = "performances";
/** The most recent performances an actor keeps in its presence. */
export const MAX_KEPT_PERFORMANCES = 6;
/** A performance whose end passed this long ago is history: show the result. */
const STALE_AFTER_END_MS = 2_500;
/** Above this the payload is not worth sending; the edit just lands. */
export const MAX_PERFORMANCE_BYTES = 240_000;

export type AiPerformance = {
  v: 1;
  id: string;
  runId: string;
  operationId: string;
  artifactId: string;
  typeKey: ArtifactTypeKey;
  actor: ActorIdentity;
  regionIds: string[];
  /** Epoch ms the performance starts (the next one in a run starts after this one ends). */
  startAt: number;
  /** The server's estimate of how long it plays, for queueing. */
  estimateMs: number;
  seed: number;
  tempo: number;
  choreography?: { target: string; region?: string };
  before: ArtifactLivePreviewPatch[];
  after: ArtifactLivePreviewPatch[];
  /** The write it shows was refused: viewers stop the hand where it is. */
  withdrawn?: true;
};

/** Mirrors that the editor rebuilds itself from the semantic blocks. */
const DERIVED_CONTENT = new Set(["/content/tiptap"]);

function setPointer(root: unknown, path: string, value: unknown): unknown {
  if (!path || path === "/") return value;
  const segments = path
    .replace(/^\//, "")
    .split("/")
    .map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"));
  const copy = (node: unknown): Record<string, unknown> | unknown[] =>
    Array.isArray(node) ? [...node] : node && typeof node === "object" ? { ...(node as Record<string, unknown>) } : {};
  const top = copy(root);
  let cursor: Record<string, unknown> | unknown[] = top;
  segments.forEach((segment, index) => {
    const key = Array.isArray(cursor) ? Number(segment) : segment;
    if (index === segments.length - 1) {
      if (value === undefined && !Array.isArray(cursor)) delete (cursor as Record<string, unknown>)[segment];
      else (cursor as Record<string | number, unknown>)[key] = value;
      return;
    }
    const next = copy((cursor as Record<string | number, unknown>)[key]);
    (cursor as Record<string | number, unknown>)[key] = next;
    cursor = next;
  });
  return top;
}

function applyPatches(value: ArtifactLiveValue, patches: readonly ArtifactLivePreviewPatch[]) {
  let next: unknown = value;
  for (const patch of patches) next = setPointer(next, patch.path, patch.value);
  return next as ArtifactLiveValue;
}

function diffPaths(
  before: unknown,
  after: unknown,
  path: string,
  out: ArtifactLivePreviewPatch[],
) {
  if (Object.is(before, after) || DERIVED_CONTENT.has(path)) return;
  if (Array.isArray(before) && Array.isArray(after)) {
    // A list that grows or shrinks travels whole; same length diffs per item.
    if (before.length !== after.length) {
      out.push({ path, value: after });
      return;
    }
    after.forEach((item, index) => diffPaths(before[index], item, `${path}/${index}`, out));
    return;
  }
  if (
    before && after && typeof before === "object" && typeof after === "object" &&
    !Array.isArray(before) && !Array.isArray(after)
  ) {
    const left = before as Record<string, unknown>;
    const right = after as Record<string, unknown>;
    for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
      const child = `${path}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`;
      diffPaths(left[key], right[key], child, out);
    }
    return;
  }
  out.push({ path: path || "/", value: after });
}

/**
 * The changed paths of an edit, with their values on each side. Lists that
 * change length travel whole, so either side rebuilds exactly from any copy of
 * the document, whether or not the commit has reached it yet.
 */
export function performancePatches(base: ArtifactLiveValue, desired: ArtifactLiveValue) {
  const after: ArtifactLivePreviewPatch[] = [];
  diffPaths(base, desired, "", after);
  return {
    after,
    before: after.map((patch) => ({ path: patch.path, value: valueAtPath(base, patch.path) })),
  };
}

/** Rebuild both sides from whatever the viewer's document holds now. */
export function performanceSides(performance: AiPerformance, live: ArtifactLiveValue) {
  return {
    base: applyPatches(live, performance.before),
    desired: applyPatches(live, performance.after),
  };
}

export function performanceBeats(performance: AiPerformance, live: ArtifactLiveValue): AiStreamBeat[] {
  const { base, desired } = performanceSides(performance, live);
  return buildArtifactLivePreviewBeats(base, desired, performance.choreography, {
    seed: performance.seed,
    tempo: performance.tempo,
  });
}

export function beatsDuration(beats: readonly AiStreamBeat[]) {
  return beats.reduce((total, beat) => total + Math.max(0, beat.delayMs), 0);
}

export function performanceIsStale(performance: AiPerformance, now: number) {
  return now > performance.startAt + performance.estimateMs + STALE_AFTER_END_MS;
}

/**
 * The tempo for the next performance of a run: a backlog compresses the hand,
 * so the screen never trails the work by more than a few seconds.
 */
export function tempoForBacklog(backlogMs: number) {
  if (backlogMs <= 600) return 1;
  return Math.max(0.25, 1 / (1 + (backlogMs - 600) / 3_500));
}

function actForBeat(beat: AiStreamBeat, previous: AiStreamBeat | undefined, before: unknown, after: unknown): InteractionAct | undefined {
  if (beat.menu?.open) {
    if (!previous?.menu?.open) return { kind: "menuOpen" };
    if (!Object.is(before, after)) return { kind: "menuSelect", option: beat.menu.highlighted ?? String(after ?? "") };
    if (previous.menu.highlighted !== beat.menu.highlighted) return { kind: "menuNavigate", option: beat.menu.highlighted ?? "" };
    return { kind: "menuOpen" };
  }
  if (beat.menu === null && previous?.menu?.open) return { kind: "menuClose" };
  switch (beat.interaction?.kind) {
    case "pointer":
      return { kind: "hover" };
    case "focus":
      return { kind: "focus" };
    case "toggle":
      return !Object.is(before, after) ? { kind: "toggle", value: Boolean(after) } : { kind: "press" };
    case "dragging":
      return beat.gesturePhase === "release" ? { kind: "dragRelease" } : beat.gesturePhase === "move" ? { kind: "dragMove" } : { kind: "dragStart" };
    case "resizing":
      return beat.gesturePhase === "release" ? { kind: "resizeRelease" } : beat.gesturePhase === "move" ? { kind: "resizeMove" } : { kind: "resizeStart" };
    default:
      return undefined;
  }
}

function stableBlockPath(path: string, value: ArtifactLiveValue) {
  const match = path.match(/\/(?:content\/)?blocks\/(?:id:)?([^/]+)/i);
  let blockId = match ? decodeURIComponent(match[1]!) : undefined;
  if (blockId && /^\d+$/.test(blockId)) {
    const blocks = (value.content as { blocks?: Array<{ id?: unknown }> } | undefined)?.blocks;
    const indexed = Array.isArray(blocks) ? blocks[Number(blockId)] : undefined;
    blockId = indexed && typeof indexed.id === "string" ? indexed.id : undefined;
  }
  const relative = path.startsWith("/content/") ? path.slice("/content".length) : path;
  // Speculation patches by index; the editor's DOM is addressed by stable id.
  const framePath = blockId && match ? relative.replace(/^\/blocks\/(?:id:)?[^/]+/i, `/blocks/id:${encodeURIComponent(blockId)}`) : relative;
  return { blockId, framePath };
}

/**
 * The presence record a viewer shows for one beat: exactly the shape a live
 * collaborator publishes, so every presence surface renders it unchanged.
 */
export function beatPresence(
  performance: AiPerformance,
  beats: readonly AiStreamBeat[],
  index: number,
  base: ArtifactLiveValue,
): Record<string, unknown> {
  const beat = beats[index]!;
  const previous = index > 0 ? beats[index - 1]!.value : base;
  // Every path the edit touches, at this beat's value: complete over either
  // side, so the overlay is right whether or not the commit has arrived.
  const previewPatches = performance.after.map((patch) => ({
    path: patch.path,
    value: valueAtPath(beat.value, patch.path),
  }));
  const deltaPatches = artifactLivePreviewPatches(previous, beat.value);
  const focusPath =
    beat.focusPath ?? deltaPatches[0]?.path ?? previewPatches[0]?.path ?? "/";
  const { blockId, framePath } = stableBlockPath(focusPath, beat.value);
  const regionId =
    performance.regionIds.find((region) => blockId && (region === blockId || region.endsWith(`:${blockId}`) || region.includes(blockId))) ??
    performance.regionIds.find((region) => focusPath.includes(region.replace(/^.*:/, ""))) ??
    performance.regionIds[0];
  const focusValue = valueAtPath(beat.value, focusPath);
  const caretOffset =
    typeof beat.caretOffset === "number" ? beat.caretOffset : typeof focusValue === "string" ? focusValue.length : 0;
  const lineIndex = typeof beat.lineIndex === "number" ? beat.lineIndex : 0;
  const selecting = typeof beat.selectionEnd === "number" && beat.selectionEnd > 0;
  const selectionStart = selecting ? (beat.selectionStart ?? 0) : caretOffset;
  const selectionEnd = selecting ? beat.selectionEnd! : caretOffset;
  const linePoint = (offset: number) => (lineIndex > 0 ? { offset, line: lineIndex } : { offset });
  // Reaching for a word: the hand travels to the glyph it is about to click.
  const reaching = beat.interaction?.kind === "pointer" && typeof focusValue === "string";
  const act: InteractionAct | undefined = selecting
    ? { kind: "select", span: { anchor: linePoint(selectionStart), head: linePoint(selectionEnd) } }
    : reaching
      ? { kind: "caret", point: linePoint(caretOffset) }
      : actForBeat(beat, beats[index - 1], valueAtPath(previous, focusPath), focusValue);
  const interactionState = aiInteractionFrame({
    artifactId: performance.artifactId,
    typeKey: performance.typeKey,
    actor: performance.actor,
    path: framePath,
    ...(regionId ? { regionId } : {}),
    before: valueAtPath(previous, focusPath),
    after: focusValue,
    ...(act ? { act } : {}),
    ...(beat.focusPart ? { part: beat.focusPart } : {}),
    ...(beat.menu === null
      ? { menu: null }
      : beat.menu?.open && beat.menu.label
        ? {
            menu: {
              label: beat.menu.label,
              options: beat.menu.options ?? [],
              ...(beat.menu.highlighted ? { highlighted: beat.menu.highlighted } : {}),
            },
          }
        : {}),
    sequence: index,
    patches: previewPatches.map((patch) => ({ path: patch.path, value: patch.value })),
    ...(regionId ? { heldRegionIds: [regionId] } : {}),
  });
  const gesture = beat.previewGesture ?? (beat.menu?.open ? "selecting" : "typing");
  return {
    ...identityRecord(performance),
    interactionState,
    ...(regionId ? { activeRegionId: regionId, activeRegionIds: [regionId] } : {}),
    ...(previewPatches.length ? { previewPatches } : {}),
    previewSequence: index,
    previewPhase: "streaming",
    previewGesture: gesture,
    ...(beat.interaction !== undefined ? { interaction: beat.interaction } : {}),
    menu: beat.menu ?? null,
    ...(blockId && (typeof focusValue === "string" || selecting)
      ? {
          selection: {
            kind: "text",
            collapsed: !selecting,
            ranges: [{ blockId, startOffset: selectionStart, endOffset: selectionEnd, lineIndex }],
          },
        }
      : { selection: null }),
    cursor: {
      x: 0.5,
      y: 0.42,
      updatedAt: Date.now(),
      mode: beat.cursorMode ?? (selecting || beat.menu?.open ? "selecting" : "typing"),
      anchor: blockId
        ? { kind: "block", id: blockId, charOffset: selecting ? selectionEnd : caretOffset, lineIndex }
        : { kind: "path", id: focusPath, charOffset: selecting ? selectionEnd : caretOffset, lineIndex },
    },
  };
}

/** The record held on the finished control for a moment after the last beat. */
export function settlePresence(performance: AiPerformance, beats: readonly AiStreamBeat[]): Record<string, unknown> {
  const last = beats.at(-1);
  // The hand rests where it last worked, never on the whole artifact.
  const path = beats.findLast((beat) => beat.focusPath)?.focusPath ?? performance.after[0]?.path ?? "/";
  const { framePath } = last ? stableBlockPath(path, last.value) : { framePath: path };
  return {
    ...identityRecord(performance),
    interactionState: aiSettleFrame({
      artifactId: performance.artifactId,
      typeKey: performance.typeKey,
      actor: performance.actor,
      path: framePath,
      ...(performance.regionIds[0] ? { regionId: performance.regionIds[0] } : {}),
      before: undefined,
      after: undefined,
      sequence: beats.length,
    }),
    menu: null,
    selection: null,
  };
}

/** The same identity fields the AI's own connection publishes. */
function identityRecord(performance: AiPerformance) {
  const actor = performance.actor;
  return {
    clientId: actor.clientId,
    ...(actor.ownerAccountId ? { accountId: actor.ownerAccountId } : {}),
    name: actor.name,
    displayName: actor.name,
    actorKind: actor.kind,
    runId: performance.runId,
    operationId: performance.operationId,
  };
}

/** One seed per operation: every viewer plays the same hand. */
export function performanceSeed(operationId: string) {
  return hashSeed(operationId);
}

export function readPerformances(user: unknown): AiPerformance[] {
  if (!user || typeof user !== "object") return [];
  const list = (user as Record<string, unknown>)[PERFORMANCE_FIELD];
  if (!Array.isArray(list)) return [];
  return list.filter(
    (entry): entry is AiPerformance =>
      Boolean(entry) &&
      typeof entry === "object" &&
      (entry as AiPerformance).v === 1 &&
      typeof (entry as AiPerformance).id === "string" &&
      typeof (entry as AiPerformance).typeKey === "string" &&
      Array.isArray((entry as AiPerformance).after) &&
      Array.isArray((entry as AiPerformance).before),
  );
}
