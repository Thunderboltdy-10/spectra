/**
 * Generalized follow: spectate a collaborator, presenter, or the AI.
 *
 * `follow-ai.ts` owns the original AI-only spectator mode and keeps its API;
 * this store generalizes the same contract to any presence actor while
 * deferring to Follow AI for `kind: "ai"` targets so the two never disagree.
 *
 * Contracts preserved from Follow AI:
 * - Spectra never moves the user's viewport until they explicitly follow.
 * - Any local interaction disengages immediately (`reason: "user_input"`).
 * - Opens dispatched by the store are marked so shells can tell a programmatic
 *   navigation apart from a user choosing a different artifact.
 * - The store never steals keyboard focus: it only dispatches open/reveal
 *   events; surfaces scroll targets into view without focusing them.
 *
 * Following a person is deliberately forgiving: taking back control keeps a
 * `disengagedFrom` handle so a calm "Return to …" control can re-engage when
 * the followed actor is still present. Explicitly stopping follow drops that
 * handle — the product does not nag.
 */

import { useSyncExternalStore } from "react";
import { spectraBus } from "../events";

import {
  disengageFollowAi,
  followAiActor,
  isFollowingAi,
  pickFollowAiActorId,
  setFollowingAi,
  subscribeFollowAi,
} from "./follow-ai";

export type FollowTarget =
  | { kind: "ai" }
  | { kind: "collaborator"; clientId: string; label: string }
  | { kind: "presenter"; clientId: string; label: string };

export type FollowLocation = {
  artifactId: string;
  /** Canonical semantic path of the control being worked, when known. */
  path?: string;
  /** Activity copy, e.g. "Editing the budget table". */
  note?: string;
  updatedAt: number;
};

export type FollowDisengageReason = "user_input" | "explicit";

type FollowSnapshot = {
  target: FollowTarget | null;
  /** Timestamp follow began, for late-join catch-up calculations. */
  followedAt: number;
  /** Last target the user disengaged from by taking control (resumable). */
  disengagedFrom: FollowTarget | null;
  /** Most recent location published for the followed target. */
  location: FollowLocation | null;
};

const PROGRAMMATIC_OPEN_MS = 1200;

let target: FollowTarget | null = null;
let followedAt = 0;
let disengagedFrom: FollowTarget | null = null;
let location: FollowLocation | null = null;
let lastDispatchedArtifactId: string | null = null;
let programmaticOpenAt = 0;
let suppressAiSync = false;
const listeners = new Set<() => void>();

let snapshot: FollowSnapshot = {
  target: null,
  followedAt: 0,
  disengagedFrom: null,
  location: null,
};

function emit(): void {
  snapshot = { target, followedAt, disengagedFrom, location };
  for (const listener of listeners) listener();
}

export function followTargetsEqual(
  a: FollowTarget | null,
  b: FollowTarget | null,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.kind !== b.kind) return false;
  if (a.kind === "ai" || b.kind === "ai") return true;
  return (
    a.clientId === (b as { clientId: string }).clientId &&
    a.label === (b as { label: string }).label
  );
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
  void spectraBus.command("work.open", { workId: artifactId, surface: "panel" });
}

function dispatchReveal(artifactId: string, path?: string): void {
  if (typeof window === "undefined") return;
  void spectraBus.command("work.reveal", {
    workId: artifactId,
    ...(path ? { path } : {}),
  });
}

/**
 * Begin spectating a target. AI targets are delegated to Follow AI so the
 * thread-panel toggle and this store remain two faces of one mode.
 */
export function follow(next: FollowTarget): void {
  if (followTargetsEqual(target, next)) return;
  target = next;
  followedAt = Date.now();
  disengagedFrom = null;
  location = null;
  lastDispatchedArtifactId = null;
  if (next.kind === "ai") {
    suppressAiSync = true;
    try {
      const actor = pickFollowAiActorId();
      if (actor) followAiActor(actor);
      else setFollowingAi(true);
    } finally {
      suppressAiSync = false;
    }
  }
  emit();
}

/**
 * Stop following. `user_input` (the user scrolled, typed or navigated away)
 * leaves a resumable handle; `explicit` (the user pressed Stop) does not.
 */
export function disengageFollow(
  reason: FollowDisengageReason = "user_input",
): void {
  const previous = target;
  if (!previous) return;
  target = null;
  followedAt = 0;
  location = null;
  lastDispatchedArtifactId = null;
  disengagedFrom =
    reason === "user_input" && previous.kind !== "ai" ? previous : null;
  if (previous.kind === "ai") {
    suppressAiSync = true;
    try {
      disengageFollowAi();
    } finally {
      suppressAiSync = false;
    }
  }
  emit();
}

/**
 * Re-engage the target the user last took control away from. Returns the
 * resumed target, or null when there is nothing to return to.
 */
export function resumeFollow(): FollowTarget | null {
  const resumable = disengagedFrom;
  if (!resumable) return null;
  follow(resumable);
  return resumable;
}

/**
 * Look at a location once without following. Used by "show me where they are"
 * affordances; persistent viewport-keeping remains opt-in via `follow`.
 */
export function peekOnce(targetLocation: {
  artifactId: string;
  path?: string;
}): boolean {
  if (!targetLocation.artifactId) return false;
  dispatchReveal(targetLocation.artifactId, targetLocation.path);
  return true;
}

/**
 * Publish the followed actor's current location. Publishers are surfaces that
 * already resolve actor frames (the open studio); publishing for an actor the
 * user is not following is a no-op so the store stays cheap.
 */
export function noteFollowLocation(update: {
  clientId: string;
  artifactId: string;
  path?: string;
  note?: string;
}): void {
  if (!target || target.kind === "ai") return;
  if (target.clientId !== update.clientId) return;
  if (!update.artifactId) return;
  const previousArtifactId = location?.artifactId ?? null;
  const samePath = location?.path === update.path;
  const sameNote = location?.note === update.note;
  if (previousArtifactId === update.artifactId && samePath && sameNote) return;
  location = {
    artifactId: update.artifactId,
    ...(update.path !== undefined ? { path: update.path } : {}),
    ...(update.note !== undefined ? { note: update.note } : {}),
    updatedAt: Date.now(),
  };
  // The followed person moved work: keep the spectator with them by opening
  // the artifact they moved to (marked programmatic).
  if (previousArtifactId && previousArtifactId !== update.artifactId) {
    dispatchOpen(update.artifactId);
  }
  emit();
}

export function isFollowing(clientId?: string): boolean {
  if (!target) return false;
  if (clientId === undefined) return true;
  return target.kind !== "ai" && target.clientId === clientId;
}

/** True while an open dispatched by follow mode is still being applied. */
export function isProgrammaticFollowOpen(): boolean {
  return Date.now() - programmaticOpenAt < PROGRAMMATIC_OPEN_MS;
}

export function getFollowSnapshot(): FollowSnapshot {
  return snapshot;
}

/**
 * Late-join catch-up: when a spectator starts following mid-activity, bound
 * what they replay. Frames older than the lookback window are history, not
 * context; beyond `maxFrames` only the most recent beat matters.
 */
export function planCatchUp<T extends { at: number }>(input: {
  frames: readonly T[];
  followedAt: number;
  lookbackMs?: number;
  maxFrames?: number;
}): { frames: T[]; skipped: number } {
  const lookbackMs = input.lookbackMs ?? 30_000;
  const maxFrames = input.maxFrames ?? 24;
  const eligible = input.frames.filter(
    (frame) => frame.at >= input.followedAt - lookbackMs,
  );
  const frames = eligible.slice(-maxFrames);
  return { frames, skipped: eligible.length - frames.length };
}

/* ------------------------------------------------------------------ *
 * Follow AI interop: external toggles of Follow AI reconcile into this
 * store so `useFollow` reports AI spectating regardless of which API
 * engaged it.
 * ------------------------------------------------------------------ */

let aiSyncUnsubscribe: (() => void) | null = null;

function reconcileAiSync(): void {
  if (suppressAiSync) return;
  const aiActive = isFollowingAi();
  if (aiActive && target?.kind !== "ai") {
    target = { kind: "ai" };
    followedAt = Date.now();
    disengagedFrom = null;
    location = null;
    lastDispatchedArtifactId = null;
    emit();
  } else if (!aiActive && target?.kind === "ai") {
    target = null;
    followedAt = 0;
    location = null;
    disengagedFrom = null;
    emit();
  }
}

function ensureAiSync(): void {
  if (aiSyncUnsubscribe) return;
  aiSyncUnsubscribe = subscribeFollowAi(reconcileAiSync);
}

ensureAiSync();

/* ------------------------------------------------------------------ *
 * React binding
 * ------------------------------------------------------------------ */

function subscribe(listener: () => void): () => void {
  ensureAiSync();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const SERVER_SNAPSHOT: FollowSnapshot = {
  target: null,
  followedAt: 0,
  disengagedFrom: null,
  location: null,
};

export function useFollow(): FollowSnapshot & {
  following: boolean;
  follow: (next: FollowTarget) => void;
  disengage: (reason?: FollowDisengageReason) => void;
  resume: () => FollowTarget | null;
} {
  const state = useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => SERVER_SNAPSHOT,
  );
  return {
    ...state,
    following: state.target !== null,
    follow,
    disengage: disengageFollow,
    resume: resumeFollow,
  };
}

/** Test-only reset. */
export function __resetFollow(): void {
  target = null;
  followedAt = 0;
  disengagedFrom = null;
  location = null;
  lastDispatchedArtifactId = null;
  programmaticOpenAt = 0;
  suppressAiSync = false;
  listeners.clear();
  snapshot = {
    target: null,
    followedAt: 0,
    disengagedFrom: null,
    location: null,
  };
  if (aiSyncUnsubscribe) {
    aiSyncUnsubscribe();
    aiSyncUnsubscribe = null;
  }
  ensureAiSync();
}
