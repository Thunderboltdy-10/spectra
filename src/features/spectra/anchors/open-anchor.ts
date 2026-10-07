/*
 * Landing on a place inside a work. Whatever opens a work at a region (a
 * search result, a citation, the command bar, Spectra) records the landing
 * here before it asks a host to open the work; the studio that shows the work
 * claims it once its content can resolve the region (use-open-anchor.ts).
 * Hosts differ (the side panel, the chat's canvas, the threads view), so the
 * landing travels beside `work.open` rather than through each host's props.
 *
 * A landing nobody claims expires; an unknown or stale region simply opens
 * the work where it would have opened anyway.
 */
import { useSyncExternalStore } from "react";
import { recentCause } from "../life/use-life";
import { workRegionFrom, type WorkRegion } from "./locate";

export type { WorkRegion } from "./locate";

/** How long a landing waits for its studio: loading a work into a host takes a moment, not a session. */
export const LANDING_TTL_MS = 15_000;

export type PendingLanding = {
  workId: string;
  region: WorkRegion;
  /** Distinguishes two landings on the same work, so a claim never takes a newer one. */
  seq: number;
  at: number;
  /** Where the user acted to ask for it (the result they pressed), for the light's arrival. */
  from?: [number, number];
};

const pending = new Map<string, PendingLanding>();
const listeners = new Set<() => void>();
let seq = 0;

function now() {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

function emit() {
  for (const listener of [...listeners]) listener();
}

function live(landing: PendingLanding | undefined) {
  if (!landing) return undefined;
  if (now() - landing.at <= LANDING_TTL_MS) return landing;
  pending.delete(landing.workId);
  return undefined;
}

/**
 * The next open of `workId` should land on `region`. Without a region nothing
 * changes: a plain open never cancels a landing already on its way.
 */
export function expectLanding(workId: string, region: unknown) {
  const target = workRegionFrom(region);
  if (!workId || !target) return;
  seq += 1;
  const from = recentCause();
  pending.set(workId, { workId, region: target, seq, at: now(), ...(from ? { from: [from[0], from[1]] as [number, number] } : {}) });
  emit();
}

/** The landing waiting for `workId`, if it has not expired. */
export function pendingLanding(workId: string | undefined) {
  return workId ? live(pending.get(workId)) : undefined;
}

/** The studio took this landing: it will not be offered again. A newer landing on the same work stays. */
export function claimLanding(workId: string, landingSeq: number) {
  const landing = pending.get(workId);
  if (!landing || landing.seq !== landingSeq) return false;
  pending.delete(workId);
  emit();
  return true;
}

/** Drop every landing (sign-out, tests). */
export function clearLandings() {
  if (!pending.size) return;
  pending.clear();
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The landing waiting for `workId`, re-read whenever one is recorded or claimed. */
export function usePendingLanding(workId: string | undefined) {
  return useSyncExternalStore(
    subscribe,
    () => pendingLanding(workId),
    () => undefined,
  );
}
