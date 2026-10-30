/**
 * Follow AI: the explicit spectator mode.
 *
 * Default Spectra behaviour never touches the user's viewport. When Follow AI
 * is switched on from the thread panel, the product may open the artifact the
 * AI is operating on and reveal the exact target it is working, so watching a
 * run feels like spectating another collaborator.
 *
 * The store is deliberately tiny: one boolean, one location. Publishers are
 * the surfaces that know where the AI is — the open artifact studio reports
 * the precise semantic target; the run-event feed reports the artifact when
 * the work is happening somewhere closed. Consumers are the shells (which
 * open artifacts) and the studio (which reveals targets).
 *
 * Any direct interaction by the user disengages the mode instantly. Opens
 * dispatched by the store itself are marked so shells can tell a programmatic
 * open apart from a user choosing a different artifact.
 */

import { useSyncExternalStore } from "react";
import { spectraBus } from "../events";
import type { FollowRoute } from "./follow-navigation";
import { expectLanding } from "../anchors/open-anchor";
import type { WorkRegion } from "../anchors/locate";
import { isRunPerforming } from "./performance-stage";

export type AiLocation = {
  actorId?: string;
  artifactId: string;
  /** Canonical semantic path of the control being worked, when known. */
  path?: string;
  /** Activity copy, e.g. "Rewriting question 3". */
  note?: string;
  updatedAt: number;
};

export type AiSurfaceLocation = {
  actorId?: string;
  route: FollowRoute;
  target?: string;
  note?: string;
  updatedAt: number;
};

const PROGRAMMATIC_OPEN_MS = 1200;

let following = false;
let followedActorId: string | null = null;
let location: AiLocation | null = null;
let surfaceLocation: AiSurfaceLocation | null = null;
const locationsByActor = new Map<string, AiLocation>();
const surfacesByActor = new Map<string, AiSurfaceLocation>();
let lastDispatchedArtifactId: string | null = null;
let lastDispatchedSurfaceKey: string | null = null;
let programmaticOpenAt = 0;
const listeners = new Set<() => void>();

type FollowSnapshot = {
  following: boolean;
  followedActorId: string | null;
  location: AiLocation | null;
  surfaceLocation: AiSurfaceLocation | null;
};
let snapshot: FollowSnapshot = {
  following: false,
  followedActorId: null,
  location: null,
  surfaceLocation: null,
};

function emit(): void {
  emitVisible();
}

function dispatchOpen(artifactId: string, region?: WorkRegion): void {
  if (
    lastDispatchedArtifactId === artifactId &&
    Date.now() - programmaticOpenAt < PROGRAMMATIC_OPEN_MS
  ) {
    expectLanding(artifactId, region);
    return;
  }
  lastDispatchedArtifactId = artifactId;
  programmaticOpenAt = Date.now();
  void spectraBus.command("work.open", { workId: artifactId, surface: "panel", ...(region ? { region } : {}) });
}

function dispatchSurface(location: AiSurfaceLocation): void {
  const key = `${location.route}|${location.target ?? ""}`;
  if (lastDispatchedSurfaceKey === key) return;
  lastDispatchedSurfaceKey = key;
  void spectraBus.command("navigation.show", location);
}

function visibleLocation(): AiLocation | null {
  if (followedActorId) return locationsByActor.get(followedActorId) ?? null;
  return location;
}

function visibleSurface(): AiSurfaceLocation | null {
  if (followedActorId) return surfacesByActor.get(followedActorId) ?? null;
  return surfaceLocation;
}

function emitVisible(): void {
  snapshot = {
    following,
    followedActorId,
    location: visibleLocation(),
    surfaceLocation: visibleSurface(),
  };
  for (const listener of listeners) listener();
}

/** The most recently published attributed actor, if any. */
export function pickFollowAiActorId(): string | null {
  if (followedActorId) return followedActorId;
  let best: { id: string; at: number } | null = null;
  for (const [id, loc] of locationsByActor) {
    if (!best || loc.updatedAt >= best.at) best = { id, at: loc.updatedAt };
  }
  for (const [id, loc] of surfacesByActor) {
    if (!best || loc.updatedAt >= best.at) best = { id, at: loc.updatedAt };
  }
  return best?.id ?? location?.actorId ?? surfaceLocation?.actorId ?? null;
}

/*
 * A followed view shows the AI's work in the order it did it. The server is
 * usually ahead of the hand on screen: the edit is committed while its
 * performance still plays here. A move elsewhere waits until that
 * performance ends, then the held moves play back in order, at their own
 * spacing, so the view never leaves a sentence half written and never lands
 * on work that was finished out of sight.
 */
type HeldMove = { artifactId?: string; at: number; apply: () => void };
const held: HeldMove[] = [];
let heldTimer: ReturnType<typeof setTimeout> | undefined;
let heldSince = 0;
const HOLD_POLL_MS = 140;
/** The longest a view trails the run; past it the view catches up anyway. */
const MAX_HOLD_MS = 15_000;
/** Held moves replay at the AI's own spacing, within these bounds. */
const REPLAY_GAP_MS = { min: 260, max: 1_400 };

function handStillPlaying(): boolean {
  return Boolean(following && followedActorId && isRunPerforming(followedActorId));
}

/** Apply a followed move now, or once the hand on screen has finished. */
function inTurn(actorId: string | undefined, move: HeldMove): void {
  if (!shouldAnnounce(actorId) || (!held.length && !handStillPlaying())) {
    move.apply();
    return;
  }
  if (!held.length) heldSince = Date.now();
  held.push(move);
  pumpHeld();
}

function pumpHeld(delay = HOLD_POLL_MS): void {
  if (heldTimer !== undefined) return;
  heldTimer = setTimeout(() => {
    heldTimer = undefined;
    if (!held.length) return;
    // Not following any more: bring the record up to date without moving.
    if (!following) {
      for (const move of held.splice(0)) move.apply();
      return;
    }
    if (handStillPlaying() && Date.now() - heldSince < MAX_HOLD_MS) return pumpHeld();
    // The AI came back to the work on screen from other works: those are
    // finished, so the view stays. Its moves to other places still play.
    const shown = location?.artifactId;
    const back = shown ? held.findLastIndex((entry) => entry.artifactId === shown) : -1;
    if (back > 0 && held.slice(0, back).every((entry) => entry.artifactId)) held.splice(0, back);
    const move = held.shift()!;
    const gap = held[0] ? Math.min(REPLAY_GAP_MS.max, Math.max(REPLAY_GAP_MS.min, held[0].at - move.at)) : 0;
    move.apply();
    heldSince = Date.now();
    if (held.length) pumpHeld(gap);
  }, delay);
}

function dropHeld(): void {
  held.length = 0;
  if (heldTimer !== undefined) clearTimeout(heldTimer);
  heldTimer = undefined;
}

function shouldAnnounce(actorId?: string): boolean {
  if (!following) return false;
  if (followedActorId) return Boolean(actorId) && actorId === followedActorId;
  return true;
}

function lockActorIfNeeded(actorId?: string): void {
  if (!following || followedActorId || !actorId) return;
  followedActorId = actorId;
}

export function isFollowingAi(): boolean {
  return following;
}

export function setFollowingAi(next: boolean): void {
  if (following === next) return;
  following = next;
  if (!next) {
    for (const move of held.splice(0)) move.apply();
    dropHeld();
    followedActorId = null;
    lastDispatchedArtifactId = null;
    lastDispatchedSurfaceKey = null;
  } else {
    followedActorId = pickFollowAiActorId();
    lastDispatchedArtifactId = null;
    lastDispatchedSurfaceKey = null;
    const actorLocation = followedActorId
      ? (locationsByActor.get(followedActorId) ?? null)
      : location;
    const actorSurface = followedActorId
      ? (surfacesByActor.get(followedActorId) ?? null)
      : surfaceLocation;
    if (actorLocation?.artifactId) dispatchOpen(actorLocation.artifactId);
    if (actorSurface) dispatchSurface(actorSurface);
  }
  emit();
}

/** Follow exactly one AI actor. Passing null disengages. */
export function followAiActor(actorId: string | null): void {
  const normalized = actorId?.trim() || null;
  if (!normalized) {
    setFollowingAi(false);
    return;
  }
  followedActorId = normalized;
  following = true;
  lastDispatchedArtifactId = null;
  lastDispatchedSurfaceKey = null;
  const actorLocation = locationsByActor.get(normalized);
  const actorSurface = surfacesByActor.get(normalized);
  if (actorLocation?.artifactId) dispatchOpen(actorLocation.artifactId);
  if (actorSurface) dispatchSurface(actorSurface);
  emit();
}

/** How long the work stays watched after the followed run ends, so its last change is seen landing. */
const SETTLE_MS = 1600;

/** A followed run that ended hands the view back; the user stays where it brought them. */
export function endFollowedRun(runId: string): void {
  if (!following || followedActorId !== runId) return;
  const finish = () => {
    if (!following || followedActorId !== runId) return;
    if (isRunPerforming(runId)) window.setTimeout(finish, 250);
    else setFollowingAi(false);
  };
  window.setTimeout(finish, SETTLE_MS);
}

export function getFollowedAiActorId(): string | null {
  return followedActorId;
}

/** Publish an app-wide target for Follow AI. Non-followed actors only update
 * the dock; followed actors may navigate through this single controller. */
export function noteAiSurface(update: Omit<AiSurfaceLocation, "updatedAt">): void {
  const next = { ...update, updatedAt: Date.now() };
  const unchanged = surfaceLocation?.route === next.route && surfaceLocation?.target === next.target && surfaceLocation?.note === next.note && surfaceLocation?.actorId === next.actorId;
  if (unchanged) return;
  lockActorIfNeeded(next.actorId);
  inTurn(next.actorId, {
    at: next.updatedAt,
    apply: () => {
      // A replayed move is news now: what it names is happening on screen.
      const shown = { ...next, updatedAt: Math.max(next.updatedAt, Date.now()) };
      surfaceLocation = shown;
      if (shown.actorId) surfacesByActor.set(shown.actorId, shown);
      if (shouldAnnounce(shown.actorId)) dispatchSurface(shown);
      emit();
    },
  });
}

export function getAiSurfaceLocation(): AiSurfaceLocation | null {
  return surfaceLocation;
}

/** The user took control: navigation, scrolling, editing, any direct input. */
export function disengageFollowAi(): void {
  if (!following) return;
  following = false;
  for (const move of held.splice(0)) move.apply();
  dropHeld();
  followedActorId = null;
  emit();
}

/** True while an open dispatched by follow mode is still being applied. */
export function isProgrammaticOpen(): boolean {
  return Date.now() - programmaticOpenAt < PROGRAMMATIC_OPEN_MS;
}

/**
 * Publish where the AI is currently operating. When following, a change of
 * artifact opens it; a change of path is left to the open studio, which
 * reveals the exact target itself.
 */
export function noteAiLocation(update: {
  actorId?: string;
  artifactId: string;
  path?: string;
  note?: string;
  /** A place inside the work Spectra asked to show (open_in_spectra): a followed view lands there. */
  region?: WorkRegion;
  /** A mounted studio may refine its target, but cannot pull a run back after
   * the run feed has moved to another work while the next studio loads. */
  refineOnly?: boolean;
}): void {
  if (!update.artifactId) return;
  if (update.refineOnly && location && location.actorId === update.actorId && location.artifactId !== update.artifactId) return;
  // The studio on screen refines where the hand is in it; that never waits.
  if (update.refineOnly || (!held.length && location?.artifactId === update.artifactId)) {
    applyAiLocation(update);
    return;
  }
  lockActorIfNeeded(update.actorId);
  inTurn(update.actorId, { artifactId: update.artifactId, at: Date.now(), apply: () => applyAiLocation(update) });
}

function applyAiLocation(update: Parameters<typeof noteAiLocation>[0]): void {
  const sameArtifact = location?.artifactId === update.artifactId;
  // A coarse publisher (the run feed) names only the artifact; never let it
  // overwrite a precise path and note reported by the open studio.
  const nextLocation: AiLocation = {
    ...(update.actorId ? { actorId: update.actorId } : {}),
    artifactId: update.artifactId,
    ...(update.path !== undefined || !sameArtifact
      ? { path: update.path }
      : location?.path !== undefined
        ? { path: location.path }
        : {}),
    // A bare act from the open editor ("Focused", "Done") says less than the step it is part of.
    ...((update.note !== undefined && !(sameArtifact && location?.note && !update.note.includes(" "))) || !sameArtifact
      ? { note: update.note }
      : location?.note !== undefined
        ? { note: location.note }
        : {}),
    updatedAt: Date.now(),
  };
  const samePath = location?.path === nextLocation.path;
  const sameNote = location?.note === nextLocation.note;
  // A live interaction frame is often reconstructed from awareness on every
  // beat. Publishing the same semantic location must be a no-op; otherwise the
  // store re-renders ArtifactStudioEditor, which republishes the location, and
  // React correctly stops the resulting external-store feedback loop.
  if (sameArtifact && samePath && sameNote && location?.actorId === nextLocation.actorId) {
    // Already there: a followed view still moves to the place asked for.
    if (update.region && shouldAnnounce(update.actorId)) expectLanding(update.artifactId, update.region);
    return;
  }
  location = nextLocation;
  if (update.actorId) locationsByActor.set(update.actorId, nextLocation);
  lockActorIfNeeded(update.actorId);
  if (shouldAnnounce(update.actorId)) {
    if (!sameArtifact) dispatchOpen(update.artifactId, update.region);
    else expectLanding(update.artifactId, update.region);
  }
  emit();
}

export function clearAiLocation(artifactId?: string): void {
  for (const [actorId, actorLocation] of locationsByActor) {
    if (!artifactId || actorLocation.artifactId === artifactId) locationsByActor.delete(actorId);
  }
  if (!artifactId) surfacesByActor.clear();
  if (location && (!artifactId || location.artifactId === artifactId)) location = null;
  if (!artifactId || !location || location.artifactId === artifactId) surfaceLocation = null;
  if (!location && !surfaceLocation) {
    lastDispatchedArtifactId = null;
    lastDispatchedSurfaceKey = null;
  }
  emit();
}

export function getAiLocation(): AiLocation | null {
  return location;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Module-scope subscription for sibling stores (the generalized follow store)
 * that must react when Follow AI is toggled outside their own API.
 */
export function subscribeFollowAi(listener: () => void): () => void {
  return subscribe(listener);
}

const SERVER_SNAPSHOT: FollowSnapshot = {
  following: false,
  followedActorId: null,
  location: null,
  surfaceLocation: null,
};

export function useFollowAi(): {
  following: boolean;
  followedActorId: string | null;
  location: AiLocation | null;
  surfaceLocation: AiSurfaceLocation | null;
  setFollowing: (next: boolean) => void;
} {
  const state = useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => SERVER_SNAPSHOT,
  );
  return { ...state, setFollowing: setFollowingAi };
}

/** Test-only reset. */
export function __resetFollowAi(): void {
  following = false;
  followedActorId = null;
  location = null;
  surfaceLocation = null;
  lastDispatchedArtifactId = null;
  lastDispatchedSurfaceKey = null;
  programmaticOpenAt = 0;
  dropHeld();
  locationsByActor.clear();
  surfacesByActor.clear();
  listeners.clear();
  snapshot = { following: false, followedActorId: null, location: null, surfaceLocation: null };
}
