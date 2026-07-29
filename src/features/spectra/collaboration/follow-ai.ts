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

export type AiLocation = {
  artifactId: string;
  /** Canonical semantic path of the control being worked, when known. */
  path?: string;
  /** Activity copy, e.g. "Rewriting question 3". */
  note?: string;
  updatedAt: number;
};

const PROGRAMMATIC_OPEN_MS = 1200;

let following = false;
let location: AiLocation | null = null;
let lastDispatchedArtifactId: string | null = null;
let programmaticOpenAt = 0;
const listeners = new Set<() => void>();

type FollowSnapshot = { following: boolean; location: AiLocation | null };
let snapshot: FollowSnapshot = { following: false, location: null };

function emit(): void {
  snapshot = { following, location };
  for (const listener of listeners) listener();
}

function dispatchOpen(artifactId: string): void {
  if (typeof window === "undefined") return;
  if (
    lastDispatchedArtifactId === artifactId &&
    Date.now() - programmaticOpenAt < PROGRAMMATIC_OPEN_MS
  ) {
    return;
  }
  lastDispatchedArtifactId = artifactId;
  programmaticOpenAt = Date.now();
  window.dispatchEvent(
    new CustomEvent("spectra:open-artifact", { detail: { artifactId } }),
  );
}

export function isFollowingAi(): boolean {
  return following;
}

export function setFollowingAi(next: boolean): void {
  if (following === next) return;
  following = next;
  if (next && location?.artifactId) dispatchOpen(location.artifactId);
  emit();
}

/** The user took control: navigation, scrolling, editing, any direct input. */
export function disengageFollowAi(): void {
  if (!following) return;
  following = false;
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
  artifactId: string;
  path?: string;
  note?: string;
}): void {
  if (!update.artifactId) return;
  const sameArtifact = location?.artifactId === update.artifactId;
  // A coarse publisher (the run feed) names only the artifact; never let it
  // overwrite a precise path and note reported by the open studio.
  const nextLocation: AiLocation = {
    artifactId: update.artifactId,
    ...(update.path !== undefined || !sameArtifact
      ? { path: update.path }
      : location?.path !== undefined
        ? { path: location.path }
        : {}),
    ...(update.note !== undefined || !sameArtifact
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
  if (sameArtifact && samePath && sameNote) return;
  location = nextLocation;
  if (following && !sameArtifact) dispatchOpen(update.artifactId);
  emit();
}

export function clearAiLocation(artifactId?: string): void {
  if (!location) return;
  if (artifactId && location.artifactId !== artifactId) return;
  location = null;
  emit();
}

export function getAiLocation(): AiLocation | null {
  return location;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const SERVER_SNAPSHOT: FollowSnapshot = { following: false, location: null };

export function useFollowAi(): {
  following: boolean;
  location: AiLocation | null;
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
  location = null;
  lastDispatchedArtifactId = null;
  programmaticOpenAt = 0;
  listeners.clear();
  snapshot = { following: false, location: null };
}
