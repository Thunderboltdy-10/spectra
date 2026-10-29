"use client";

import { createElement, Fragment, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
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
import { disengageFollow, isFollowing, isProgrammaticFollowOpen } from "./follow";
import { toast } from "@/components/ui/toast";
import { spectraBus } from "../events";
import { getSpectraMotionSnapshot } from "../motion/motion-level";
import type { SpectraCommandOutcome } from "../events/contracts";
import { announceManualViewportInteraction } from "../viewport-readiness";
import type { ActorIdentity } from "./interaction-model";
import { getRunLedger } from "./run-ledger";
import { life } from "../life/life";
import { markCause, markWorking, prismPoint } from "../life/use-life";
import { startSettingsObservationClient } from "./settings-observation-client";
import { startFollowNavigation } from "./follow-navigation";

let coordinator = new AppChoreographyCoordinator();
const artifactPerformers = new Map<string, AiPerformer>();
const MAX_IDLE_ARTIFACT_PERFORMERS = 24;
let claimTicker: number | null = null;
type ControlPresentation = { actorId: string; operationId: string; element: HTMLElement };
const controlPresentations = new Map<string, ControlPresentation>();
const controlPresentationListeners = new Set<() => void>();

/* Spectra's body in the field (LIFE.md): where each actor's light last was, so
   its next move crosses the field from there. The first move leaves the prism. */
const sparkAt = new Map<string, [number, number]>();

/** How long Spectra's light lingers where it last acted before it goes home. */
export const SPARK_HOME_MS = 1400;
const sparkHome = new Map<string, number>();

/**
 * When Spectra stops working the interface, its light crosses the field back
 * into the prism, which takes it in, and its next move leaves the prism again.
 * Another move before then keeps it out.
 */
function sparkGoesHome(actorId: string) {
  window.clearTimeout(sparkHome.get(actorId));
  sparkHome.set(
    actorId,
    window.setTimeout(() => {
      sparkHome.delete(actorId);
      const from = sparkAt.get(actorId);
      sparkAt.delete(actorId);
      const home = document.querySelector("[data-island-home]")?.getBoundingClientRect();
      if (!from || !life.on || !home?.width) return;
      void life.send(from, { x: home.x, y: home.y, width: home.width, height: home.height }, { colour: "spectrum", strength: 0.6, absorb: true });
    }, SPARK_HOME_MS),
  );
}

/** Light crosses the field to where Spectra acts next. */
function moveSpark(actorId: string, to: [number, number]) {
  window.clearTimeout(sparkHome.get(actorId));
  sparkHome.delete(actorId);
  const from = sparkAt.get(actorId) ?? prismPoint();
  sparkAt.set(actorId, to);
  // What Spectra makes here forms from where its spark is, as a person's would from their press.
  markCause(to);
  if (!life.on || Math.hypot(to[0] - from[0], to[1] - from[1]) < 6) return;
  life.send(from, to, { colour: "spectrum", strength: 0.7 });
}

/** A pointer is attached only while the registered control performs its action.
 * It cannot navigate, focus, mutate the control, or acknowledge a save.
 * Spectra's spark travels to the control, the band crosses it while Spectra
 * works it (as anything Spectra works on), and the paper ripples when it lets go. */
export function presentAppControl(actorId: string, operationId: string, element: HTMLElement): () => void {
  const presentation = { actorId, operationId, element };
  controlPresentations.set(actorId, presentation);
  for (const listener of controlPresentationListeners) listener();
  let release: (() => void) | null = null;
  if (life.on && element.isConnected) {
    const r = element.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) {
      moveSpark(actorId, [r.left + r.width / 2, r.top + r.height / 2]);
      release = markWorking(element);
    }
  }
  return () => {
    if (release) {
      release();
      if (element.isConnected) {
        const r = element.getBoundingClientRect();
        if (r.width > 0) life.pulse(r.left + r.width / 2, r.top + r.height / 2, 0.6, "spectrum");
      }
      sparkGoesHome(actorId);
    }
    if (controlPresentations.get(actorId) !== presentation) return;
    controlPresentations.delete(actorId);
    for (const listener of controlPresentationListeners) listener();
  };
}

export type AppPerformanceContext = {
  signal: AbortSignal;
  /** Read at every control boundary; never cache visibility for a whole edit. */
  decision: () => AppChoreographyDecision;
  /** Acknowledge actual progress and renew the local claim before the next step. */
  checkpoint: () => boolean;
  /** Bound a pending server acknowledgement without pretending it is progress. */
  holdUntil: (deadline: number) => boolean;
};

type PendingPerformance = {
  entry: AppChoreographyEntry;
  execute: (context: AppPerformanceContext) => void | Promise<void>;
  abort: AbortController;
  started: boolean;
  targets?: ReturnType<typeof observeAppTargets>;
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
      pending.targets?.dispose();
      abort.abort();
      continue;
    }
    if (pending.started || entry.status !== "performing") continue;
    pending.started = true;
    pending.targets = observeAppTargets(entry.targetKey);
    // Defer until enqueue has returned; synchronous callbacks cannot reorder the queue.
    void Promise.resolve().then(async () => {
      if (abort.signal.aborted) return;
      try {
        await pending.execute({
          signal: abort.signal,
          decision: () => arbitrateAppSurface(entry.target, currentViewportSnapshot(entry.actorId, entry, pending.targets?.read())),
          checkpoint: () => !abort.signal.aborted && coordinator.renewClaim(entry.actorId, entry.operationId),
          holdUntil: (deadline) => !abort.signal.aborted && coordinator.holdClaimUntil(entry.actorId, entry.operationId, deadline),
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
    // Completed/abandoned idle bodies must not accumulate in a long session.
    // Active bodies are released by their run lifecycle, never evicted mid-edit.
    for (const [id, candidate] of artifactPerformers) {
      if (artifactPerformers.size < MAX_IDLE_ARTIFACT_PERFORMERS) break;
      if (candidate.getSnapshot().operations.length) continue;
      candidate.dispose();
      artifactPerformers.delete(id);
    }
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
  candidates?: readonly HTMLElement[],
): AppViewportSnapshot {
  const pathname =
    typeof window === "undefined" ? "/workspace" : window.location.pathname;
  const surface = appSurfaceFromPathname(pathname);
  const visible: AppSurface[] = [surface];
  if ((!target || target.target === "artifact") && typeof document !== "undefined") {
    const studioSelector = "[data-spectra-artifact-studio], [data-spectra-studio]";
    const studioOpen = candidates
      ? candidates.some((candidate) => candidate.closest(studioSelector))
      : document.querySelector(studioSelector);
    if (studioOpen && !visible.includes("artifact")) visible.push("artifact");
  }
  return {
    visibleSurfaces: visible,
    focusedSurface: surface,
    followingActor: isFollowingAi(),
    followedActorId: getFollowedAiActorId(),
    ...(actorId ? { actorId } : {}),
    ...(target ? { targetVisible: visible.includes(target.target) && isAppTargetVisible(target.targetKey, candidates) } : {}),
  };
}

const APP_TARGET_ATTRIBUTES = [
  "data-spectra-ai-target", "data-spectra-target", "data-ai-region", "data-node-id", "data-calendar-item-id",
];

function appTargetSelector(targetKey: string): string {
  // Attribute values are quoted; escape control characters, quotes and slashes
  // without allowing a target key to become selector syntax.
  const escaped = targetKey.replace(/[\x00-\x1f\x7f"\\]/g, (character) => `\\${character.charCodeAt(0).toString(16)} `);
  return APP_TARGET_ATTRIBUTES.map((attribute) => `[${attribute}="${escaped}"]`).join(", ");
}

function findAppTargets(targetKey?: string): HTMLElement[] {
  if (!targetKey || typeof document === "undefined") return [];
  return Array.from(document.querySelectorAll<HTMLElement>(appTargetSelector(targetKey)));
}

/** Cache target identity for one active performance, not its visibility. Text,
 * scroll and style changes need fresh geometry but not another document scan. */
function observeAppTargets(targetKey?: string) {
  let candidates: HTMLElement[] = [];
  let dirty = true;
  let disposed = false;
  const selector = targetKey ? appTargetSelector(targetKey) : null;
  const invalidate = (records: MutationRecord[]) => {
    if (dirty) return;
    if (candidates.some((candidate) => !candidate.isConnected)) { dirty = true; return; }
    for (const record of records) {
      if (record.type === "attributes" && record.target instanceof HTMLElement &&
        (candidates.includes(record.target) || (selector && record.target.matches(selector)))) {
        dirty = true;
        return;
      }
      for (const node of record.addedNodes) {
        if (selector && node instanceof Element && (node.matches(selector) || node.querySelector(selector))) {
          dirty = true;
          return;
        }
      }
    }
  };
  const observer = selector && typeof MutationObserver !== "undefined" && typeof document !== "undefined"
    ? new MutationObserver(invalidate) : null;
  observer?.observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: APP_TARGET_ATTRIBUTES });
  return {
    read(): readonly HTMLElement[] {
      if (disposed) return [];
      if (observer) invalidate(observer.takeRecords());
      if (dirty) { candidates = findAppTargets(targetKey); dirty = false; }
      return candidates;
    },
    dispose() {
      disposed = true;
      observer?.disconnect();
      candidates = [];
    },
  };
}

function isAppTargetVisible(targetKey?: string, resolved?: readonly HTMLElement[]): boolean {
  if (!targetKey || typeof document === "undefined") return false;
  if (document.visibilityState === "hidden") return false;
  const candidates = resolved ?? findAppTargets(targetKey);
  for (const element of candidates) {
    if (!element.isConnected) continue;
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
      const clipsX = /(hidden|clip|auto|scroll)/.test(style.overflowX || style.overflow);
      const clipsY = /(hidden|clip|auto|scroll)/.test(style.overflowY || style.overflow);
      if (!clipsX && !clipsY) continue;
      const clip = parent.getBoundingClientRect();
      if (clipsX) {
        left = Math.max(left, clip.left); right = Math.min(right, clip.right);
      }
      if (clipsY) {
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
    // Watching someone work is not handing the page back: pressing, scrolling, selecting and reading all go on
    // while following. Only what would take the page away from them (leaving it, editing under their hands) is held.
    if (isFollowingAi() || isFollowing()) return;
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
  const removeRunChanged = spectraBus.on("run.changed", ({ runId }) => {
    const phase = getRunLedger(runId)?.phase;
    if (phase === "completed" || phase === "partial" || phase === "failed" || phase === "cancelled")
      releaseChoreographyActor(runId);
  });
  const following = () => isFollowingAi() || isFollowing();
  const holdNotice = () =>
    toast.info("You're following Spectra", {
      id: "follow:held",
      description: "Stop following to move around or edit.",
      action: { label: "Stop following", onClick: () => {
        disengageFollowAi();
        disengageFollow("explicit");
      } },
    });
  // Leaving the page while following: the link is held, with the way out offered.
  const onClick = (event: MouseEvent) => {
    if (!following() || isFollowControlEvent(event) || event.defaultPrevented) return;
    const target = event.target instanceof Element ? event.target : null;
    if (!target || target.closest("[data-island], [data-side-panel], [role='dialog'], [role='menu']")) return;
    const link = target.closest<HTMLElement>("a[href], [data-rail-destination], [data-nav-link]");
    if (!link) return;
    if (link instanceof HTMLAnchorElement && (link.target === "_blank" || link.getAttribute("href")?.startsWith("#"))) return;
    event.preventDefault();
    event.stopPropagation();
    holdNotice();
  };
  // Editing under the hands of whoever is followed: typing, pasting and dropping into the work wait.
  const onBeforeInput = (event: Event) => {
    if (!following()) return;
    const target = event.target instanceof Element ? event.target : null;
    if (!target?.closest("[data-spectra-studio], [data-spectra-artifact-studio]")) return;
    event.preventDefault();
    holdNotice();
  };
  window.addEventListener("click", onClick, true);
  window.addEventListener("beforeinput", onBeforeInput, true);
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
    window.removeEventListener("click", onClick, true);
    window.removeEventListener("beforeinput", onBeforeInput, true);
    window.removeEventListener("pointerdown", onInput, true);
    window.removeEventListener("keydown", onInput, true);
    window.removeEventListener("wheel", onInput, true);
    removeStopFollowing();
    removeRunChanged();
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
  for (const pending of pendingPerformances.values()) {
    pending.abort.abort();
    pending.targets?.dispose();
  }
  pendingPerformances.clear();
  for (const actorId of new Set(coordinator.snapshot().map((entry) => entry.actorId))) coordinator.cancel(actorId);
  for (const performer of artifactPerformers.values()) performer.dispose();
  artifactPerformers.clear();
  controlPresentations.clear();
  for (const listener of controlPresentationListeners) listener();
}

/** Release one terminal run without cancelling another actor or durable work. */
export function releaseChoreographyActor(actorId: string): void {
  for (const [key, pending] of pendingPerformances) {
    if (pending.entry.actorId !== actorId) continue;
    pending.abort.abort();
    pending.targets?.dispose();
    pendingPerformances.delete(key);
  }
  coordinator.cancel(actorId);
  artifactPerformers.get(actorId)?.dispose();
  artifactPerformers.delete(actorId);
  controlPresentations.delete(actorId);
  for (const listener of controlPresentationListeners) listener();
}

export function AppChoreographyMount() {
  const follow = useFollowAi();
  const router = useRouter();
  const [cursor, setCursor] = useState<{ left: number; top: number } | null>(null);
  const [controlPointers, setControlPointers] = useState<Array<{ actorId: string; left: number; top: number }>>([]);
  useEffect(() => startAppChoreographyMaintenance(), []);
  useEffect(() => startSettingsObservationClient(), []);
  // Spectra shows a destination on every page through the client router.
  useEffect(() => startFollowNavigation((href) => router.push(href)), [router]);
  useEffect(() => {
    let observing = false;
    const observer = new MutationObserver(() => update());
    const update = () => {
      if (!controlPresentations.size) { observer.disconnect(); observing = false; }
      else if (!observing) {
        observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden", "style", "class"] });
        observing = true;
      }
      const next = [...controlPresentations.values()].flatMap(({ actorId, element }) => {
        if (!isAppTargetVisible(element.dataset.spectraAiTarget, [element])) return [];
        const rect = element.getBoundingClientRect();
        return [{ actorId, left: rect.left + rect.width / 2, top: rect.top + rect.height / 2 }];
      });
      setControlPointers((current) => current.length === next.length && current.every((pointer, index) =>
        pointer.actorId === next[index]!.actorId && pointer.left === next[index]!.left && pointer.top === next[index]!.top,
      ) ? current : next);
    };
    controlPresentationListeners.add(update);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    update();
    return () => {
      controlPresentationListeners.delete(update);
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
      observer.disconnect();
    };
  }, []);
  const revealedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!follow.following || typeof window === "undefined") {
      setCursor(null);
      revealedRef.current = null;
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
      let rect = target?.getBoundingClientRect();
      // Following moves the page to the work, once per new target, as a person
      // scrolls to what they are about to change; it never fights the reader after.
      if (target && rect && targetKey && revealedRef.current !== targetKey) {
        revealedRef.current = targetKey;
        if (rect.bottom < 0 || rect.top > window.innerHeight || rect.right < 0 || rect.left > window.innerWidth) {
          target.scrollIntoView({ block: "center", inline: "nearest", behavior: getSpectraMotionSnapshot().reduced ? "auto" : "smooth" });
          rect = target.getBoundingClientRect();
        }
      }
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
  // The followed actor's light moves with its spark.
  const followedActor = follow.followedActorId;
  const lastCursor = useRef<string | null>(null);
  useEffect(() => {
    if (!cursor || !followedActor) return;
    const key = `${cursor.left}:${cursor.top}`;
    if (lastCursor.current === key) return;
    lastCursor.current = key;
    moveSpark(followedActor, [cursor.left, cursor.top]);
  }, [cursor, followedActor]);
  if (!follow.following && !controlPointers.length) return null;
  // What the followed run is doing, said once at the top of the screen, with the way out beside it.
  const activity = follow.location?.note || follow.surfaceLocation?.note || "Spectra is working";
  return createElement(
    Fragment,
    null,
    follow.following ? createElement(
      "div",
      {
        className: "spectra-follow-ai-status",
        role: "status",
        "aria-live": "polite",
        "data-spectra-follow-ai-viewport": "true",
        "data-spectra-follow-control": "",
      },
      createElement("span", { "aria-hidden": true, className: "spectra-follow-ai-status-light" }),
      createElement("span", { className: "spectra-follow-ai-status-label" }, "Following"),
      createElement("strong", { key: activity }, activity),
      createElement(
        "button",
        {
          type: "button",
          className: "spectra-follow-ai-status-stop",
          onClick: () => {
            disengageFollowAi();
            disengageFollow("user_input");
          },
        },
        "Stop",
      ),
    ) : null,
    ...controlPointers.map((pointer) => createElement("span", {
      key: pointer.actorId,
      "aria-hidden": true,
      className: "spectra-follow-ai-cursor spectra-ai-spark",
      "data-spectra-control-cursor": "true",
      "data-spectra-actor": pointer.actorId,
      style: { left: pointer.left, top: pointer.top },
    })),
    follow.following && cursor && !controlPointers.some((pointer) => pointer.actorId === follow.followedActorId)
      ? createElement("span", {
          "aria-hidden": true,
          className: "spectra-follow-ai-cursor spectra-ai-spark",
          "data-spectra-follow-ai-cursor": "true",
          style: { left: cursor.left, top: cursor.top },
        })
      : null,
  );
}
