"use client";

import { createElement, Fragment, useEffect, useState } from "react";
import {
  AppChoreographyCoordinator,
  appSurfaceFromPathname,
  arbitrateAppSurface,
  type AppChoreographyRequest,
  type AppChoreographyEntry,
  type AppChoreographyDecision,
  type AppSurface,
  type AppViewportSnapshot,
} from "./app-choreography";
import { AiPerformer } from "./ai-performer";
import {
  disengageFollowAi,
  getFollowedAiActorId,
  isFollowingAi,
  isProgrammaticOpen,
  useFollowAi,
} from "./follow-ai";
import { disengageFollow, isProgrammaticFollowOpen } from "./follow";
import { spectraBus } from "../events";
import type { SpectraCommandOutcome } from "../events/contracts";
import { announceManualViewportInteraction } from "../viewport-readiness";
import type { ActorIdentity } from "./interaction-model";

let coordinator = new AppChoreographyCoordinator();
const artifactPerformers = new Map<string, AiPerformer>();
let claimTicker: number | null = null;

export type AppPerformanceContext = {
  signal: AbortSignal;
  /** Read at every control boundary; never cache visibility for a whole edit. */
  decision: () => AppChoreographyDecision;
  /** Acknowledge actual progress and renew the local claim before the next step. */
  checkpoint: () => boolean;
};

type PendingPerformance = {
  entry: AppChoreographyEntry;
  execute: (context: AppPerformanceContext) => void | Promise<void>;
  abort: AbortController;
  started: boolean;
};
const pendingPerformances = new Map<string, PendingPerformance>();
let stopObservingCoordinator = coordinator.subscribe(reconcilePerformances);

function performanceKey(request: Pick<AppChoreographyRequest, "actorId" | "operationId">): string {
  return JSON.stringify([request.actorId, request.operationId]);
}

function reconcilePerformances(): void {
  for (const [key, pending] of pendingPerformances) {
    const { entry, abort } = pending;
    if (entry.status === "cancelled" || entry.status === "failed" || entry.status === "completed") {
      pendingPerformances.delete(key);
      abort.abort();
      continue;
    }
    if (pending.started || entry.status !== "performing") continue;
    pending.started = true;
    // Defer until enqueue has returned; synchronous callbacks cannot reorder the queue.
    void Promise.resolve().then(async () => {
      if (abort.signal.aborted) return;
      try {
        await pending.execute({
          signal: abort.signal,
          decision: () => arbitrateAppSurface(entry.target, currentViewportSnapshot(entry.actorId, entry)),
          checkpoint: () => !abort.signal.aborted && coordinator.renewClaim(entry.actorId, entry.operationId),
        });
        if (!abort.signal.aborted && pendingPerformances.get(key) === pending)
          coordinator.complete(entry.actorId, entry.operationId);
      } catch (error) {
        if (!abort.signal.aborted && pendingPerformances.get(key) === pending)
          coordinator.fail(entry.actorId, entry.operationId, error instanceof Error ? error.message : "The local performer failed.");
      }
    });
  }
}

function idleActor(actorId: string): ActorIdentity {
  return {
    clientId: actorId,
    kind: "ai",
    name: "Spectra AI",
    runId: actorId,
  };
}

/** One artifact-level body per actor. Server awareness still owns
 * durable beats; this performer is the client queue so two envelopes cannot
 * put one actor in two places (ARCHITECTURE-AI §3). */
export function artifactPerformerFor(actorId: string): AiPerformer {
  let performer = artifactPerformers.get(actorId);
  if (!performer) {
    performer = new AiPerformer(idleActor(actorId), () => {
      // Artifact beats already publish through collaboration awareness.
      // The performer exists to serialize client envelopes without a second
      // visible body. Publishing here would duplicate the server frames.
    });
    artifactPerformers.set(actorId, performer);
  }
  return performer;
}

export function getAppChoreographyCoordinator(): AppChoreographyCoordinator {
  return coordinator;
}

export function currentViewportSnapshot(
  actorId?: string,
  target?: Pick<AppChoreographyRequest, "target" | "targetKey">,
): AppViewportSnapshot {
  const pathname =
    typeof window === "undefined" ? "/workspace" : window.location.pathname;
  const surface = appSurfaceFromPathname(pathname);
  const visible: AppSurface[] = [surface];
  if (typeof document !== "undefined") {
    const studioOpen = document.querySelector(
      "[data-spectra-artifact-studio], [data-spectra-studio]",
    );
    if (studioOpen && !visible.includes("artifact")) visible.push("artifact");
  }
  return {
    visibleSurfaces: visible,
    focusedSurface: surface,
    followingActor: isFollowingAi(),
    followedActorId: getFollowedAiActorId(),
    ...(actorId ? { actorId } : {}),
    ...(target ? { targetVisible: visible.includes(target.target) && isAppTargetVisible(target.targetKey) } : {}),
  };
}

function isAppTargetVisible(targetKey?: string): boolean {
  if (!targetKey || typeof document === "undefined") return false;
  const candidates = document.querySelectorAll<HTMLElement>(
    "[data-spectra-ai-target], [data-spectra-target], [data-ai-region], [data-node-id], [data-calendar-item-id]",
  );
  for (const element of candidates) {
    if (![element.dataset.spectraAiTarget, element.dataset.spectraTarget, element.dataset.aiRegion,
      element.dataset.nodeId, element.dataset.calendarItemId].includes(targetKey)) continue;
    const rect = element.getBoundingClientRect();
    let left = Math.max(0, rect.left), top = Math.max(0, rect.top);
    let right = Math.min(window.innerWidth, rect.right), bottom = Math.min(window.innerHeight, rect.bottom);
    let hidden = false;
    for (let parent: HTMLElement | null = element; parent; parent = parent.parentElement) {
      const style = window.getComputedStyle(parent);
      if (parent.hidden || style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
        hidden = true;
        break;
      }
      if (parent === element) continue;
      const clip = parent.getBoundingClientRect();
      if (/(hidden|clip|auto|scroll)/.test(style.overflowX || style.overflow)) {
        left = Math.max(left, clip.left); right = Math.min(right, clip.right);
      }
      if (/(hidden|clip|auto|scroll)/.test(style.overflowY || style.overflow)) {
        top = Math.max(top, clip.top); bottom = Math.min(bottom, clip.bottom);
      }
    }
    if (!hidden && right > left && bottom > top) return true;
  }
  return false;
}

/** Execute a prepared local performance. Completion acknowledges this callback,
 * not a canonical write. The callback must honor cancellation at control
 * boundaries; server authority and durable receipts remain independent. */
export function performAppChoreography(
  request: AppChoreographyRequest,
  execute: PendingPerformance["execute"],
): ReturnType<AppChoreographyCoordinator["enqueue"]> {
  const entry = coordinator.enqueue(request);
  const key = performanceKey(request);
  if (!pendingPerformances.has(key)) {
    pendingPerformances.set(key, { entry, execute, abort: new AbortController(), started: false });
    reconcilePerformances();
  }
  return entry;
}

export function isFollowControlEvent(event: Event): boolean {
  const target = event.target;
  return (
    target instanceof Element &&
    Boolean(target.closest("[data-spectra-follow-control]"))
  );
}

export function startAppChoreographyMaintenance(): () => void {
  if (typeof window === "undefined") return () => undefined;
  let stopped = false;
  if (claimTicker !== null) window.clearInterval(claimTicker);
  claimTicker = window.setInterval(() => {
    coordinator.expireClaims();
  }, 1_000);
  const onInput = (event: Event) => {
    if (isProgrammaticOpen() || isProgrammaticFollowOpen()) return;
    if (isFollowControlEvent(event)) return;
    const interaction = event.type === "pointerdown"
      ? "pointer"
      : event.type === "wheel"
        ? "wheel"
        : "keyboard";
    const target = event.target instanceof Element
      ? event.target.closest<HTMLElement>("[data-spectra-studio], [data-spectra-artifact-studio]")
      : null;
    announceManualViewportInteraction({
      surface: appSurfaceFromPathname(window.location.pathname),
      interaction,
      ...(target?.dataset.spectraStudio || target?.dataset.spectraArtifactStudio
        ? { targetId: target.dataset.spectraStudio ?? target.dataset.spectraArtifactStudio }
        : {}),
    });
    disengageFollowAi();
    disengageFollow("user_input");
  };
  const removeStopFollowing = spectraBus.handle("follow.stopRequested", () => {
    disengageFollowAi();
    disengageFollow("explicit");
    return {
      status: "completed",
      message: "Follow mode stopped. Durable work continues.",
    } satisfies SpectraCommandOutcome;
  });
  window.addEventListener("pointerdown", onInput, true);
  window.addEventListener("keydown", onInput, true);
  window.addEventListener("wheel", onInput, {
    capture: true,
    passive: true,
  });
  return () => {
    if (stopped) return;
    stopped = true;
    if (claimTicker !== null) {
      window.clearInterval(claimTicker);
      claimTicker = null;
    }
    window.removeEventListener("pointerdown", onInput, true);
    window.removeEventListener("keydown", onInput, true);
    window.removeEventListener("wheel", onInput, true);
    removeStopFollowing();
    cancelLocalPerformances();
  };
}

/** Test-only reset. */
export function __resetAppChoreographyHost(): void {
  cancelLocalPerformances();
  stopObservingCoordinator();
  coordinator = new AppChoreographyCoordinator();
  stopObservingCoordinator = coordinator.subscribe(reconcilePerformances);
}

function cancelLocalPerformances(): void {
  // Abort all callbacks first, so cancelling one actor cannot start another
  // queued callback during teardown. This never stops durable server work.
  for (const pending of pendingPerformances.values()) pending.abort.abort();
  pendingPerformances.clear();
  for (const actorId of new Set(coordinator.snapshot().map((entry) => entry.actorId))) coordinator.cancel(actorId);
  for (const performer of artifactPerformers.values()) performer.dispose();
  artifactPerformers.clear();
}

export function AppChoreographyMount() {
  const follow = useFollowAi();
  const [cursor, setCursor] = useState<{ left: number; top: number } | null>(null);
  useEffect(() => startAppChoreographyMaintenance(), []);
  useEffect(() => {
    if (!follow.following || typeof window === "undefined") {
      setCursor(null);
      return;
    }
    let disposed = false;
    const locate = () => {
      if (disposed) return;
      const location = follow.location;
      const surface = follow.surfaceLocation;
      const preferArtifact = Boolean(
        location && (!surface || location.updatedAt >= surface.updatedAt),
      );
      const targetKey = preferArtifact
        ? location?.path?.split("/").filter(Boolean).at(-1)
        : surface?.target;
      const candidates = Array.from(
        document.querySelectorAll<HTMLElement>(
          "[data-spectra-ai-target], [data-ai-region], [data-node-id], [data-calendar-item-id]",
        ),
      );
      const target = targetKey
        ? candidates.find((element) =>
            [
              element.dataset.spectraAiTarget,
              element.dataset.aiRegion,
              element.dataset.nodeId,
              element.dataset.calendarItemId,
            ].includes(targetKey),
          )
        : null;
      const rect = target?.getBoundingClientRect();
      if (rect && rect.width > 0 && rect.height > 0) {
        setCursor({
          left: Math.max(8, Math.min(window.innerWidth - 20, rect.left + 12)),
          top: Math.max(8, Math.min(window.innerHeight - 20, rect.top + 12)),
        });
        return;
      }
      const appSurface = document.querySelector<HTMLElement>(
        "[data-spectra-app-surface='true']",
      );
      const appRect = appSurface?.getBoundingClientRect();
      setCursor({
        left: Math.max(8, Math.min(window.innerWidth - 20, (appRect?.right ?? window.innerWidth) - 36)),
        top: Math.max(8, Math.min(window.innerHeight - 20, (appRect?.top ?? 52) + 28)),
      });
    };
    // Show the current target as soon as Follow AI changes location; animation
    // frames and settle timers keep it attached as navigation and layout finish.
    locate();
    const firstFrame = window.requestAnimationFrame(locate);
    const afterNavigation = [90, 260, 620].map((delay) =>
      window.setTimeout(locate, delay),
    );
    window.addEventListener("resize", locate);
    window.addEventListener("scroll", locate, true);
    return () => {
      disposed = true;
      window.cancelAnimationFrame(firstFrame);
      afterNavigation.forEach((timer) => window.clearTimeout(timer));
      window.removeEventListener("resize", locate);
      window.removeEventListener("scroll", locate, true);
    };
  }, [
    follow.following,
    follow.location,
    follow.surfaceLocation,
  ]);
  if (!follow.following) return null;
  const activity = follow.location?.note ?? follow.surfaceLocation?.note ?? "Watching the current Spectra task";
  const surfaceName = follow.location
    ? "Artifact"
    : follow.surfaceLocation?.route
      ? follow.surfaceLocation.route[0]!.toUpperCase() + follow.surfaceLocation.route.slice(1)
      : "Spectra";
  return createElement(
    Fragment,
    null,
    createElement(
      "div",
      {
        className: "spectra-follow-ai-status",
        role: "status",
        "aria-live": "polite",
        "data-spectra-follow-ai-viewport": "true",
      },
      createElement("span", null, `${surfaceName} · Spectra AI`),
      createElement("strong", null, activity),
    ),
    cursor
      ? createElement(
          "svg",
          {
            "aria-hidden": true,
            className: "spectra-follow-ai-cursor",
            "data-spectra-follow-ai-cursor": "true",
            style: { left: cursor.left, top: cursor.top },
            viewBox: "0 0 24 30",
            width: 24,
            height: 30,
          },
          createElement("path", {
            d: "M2 1.8v21.1l5.8-5.4 4.1 9.4 3.8-1.7-4.2-9.1h8.1L2 1.8Z",
          }),
        )
      : null,
  );
}
