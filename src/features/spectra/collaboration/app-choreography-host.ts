"use client";

import { createElement, Fragment, useEffect, useState } from "react";
import {
  APP_CHOREOGRAPHY_SETTLE_MS,
  AppChoreographyCoordinator,
  appSurfaceForNavigation,
  appSurfaceFromChoreographyTarget,
  appSurfaceFromPathname,
  arbitrateAppSurface,
  type AppChoreographyRequest,
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
import { getSpectraMotionSnapshot } from "../motion/motion-level";
import { capabilityById } from "../capabilities/catalog";
import { spectraBus } from "../events";
import type { SpectraCommandOutcome } from "../events/contracts";
import { announceManualViewportInteraction } from "../viewport-readiness";
import type { ActorIdentity } from "./interaction-model";

const UI_EVENT_CAPABILITY: Record<string, string> = {
  organize_library: "app.library.organize",
  settings_changed: "app.settings.change",
  sync_policy_changed: "app.sync.policy.change",
  memory_written: "app.memory.write",
  sharing_changed: "app.sharing.change",
  managebac_sync_requested: "app.managebac.sync",
  managebac_classes_selected: "app.managebac.sync",
  calendar_changed: "app.page.calendar",
  bridge_setup: "app.bridge.setup",
  reference_insert: "app.reference.insert",
  comment_added: "app.comments.add",
  navigate: "app.navigate",
  navigate_spectra: "app.navigate",
};

let coordinator = new AppChoreographyCoordinator();
const settleTimers = new Map<string, number>();
let artifactPerformer: AiPerformer | null = null;
let claimTicker: number | null = null;

function idleActor(actorId: string): ActorIdentity {
  return {
    clientId: actorId,
    kind: "ai",
    name: "Spectra AI",
    runId: actorId,
  };
}

/** One artifact-level body per followed actor. Server awareness still owns
 * durable beats; this performer is the client queue so two envelopes cannot
 * put one actor in two places (ARCHITECTURE-AI §3). */
export function artifactPerformerFor(actorId: string): AiPerformer {
  if (!artifactPerformer) {
    artifactPerformer = new AiPerformer(idleActor(actorId), () => {
      // Artifact beats already publish through collaboration awareness.
      // The performer exists to serialize client envelopes without a second
      // visible body. Publishing here would duplicate the server frames.
    });
  } else {
    artifactPerformer.setActor(idleActor(actorId));
  }
  return artifactPerformer;
}

export function getAppChoreographyCoordinator(): AppChoreographyCoordinator {
  return coordinator;
}

export function currentViewportSnapshot(actorId?: string): AppViewportSnapshot {
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
  };
}

function settleMs(): number {
  return getSpectraMotionSnapshot().reduced ? 0 : APP_CHOREOGRAPHY_SETTLE_MS;
}

function completeLater(actorId: string, operationId: string): void {
  const previous = settleTimers.get(actorId);
  if (previous !== undefined && typeof window !== "undefined") {
    window.clearTimeout(previous);
  }
  const delay = settleMs();
  const finish = () => {
    settleTimers.delete(actorId);
    coordinator.complete(actorId, operationId);
  };
  if (typeof window === "undefined" || delay <= 0) {
    finish();
    return;
  }
  settleTimers.set(actorId, window.setTimeout(finish, delay));
}

export function performAppChoreography(
  request: AppChoreographyRequest,
): ReturnType<AppChoreographyCoordinator["enqueue"]> {
  coordinator.expireClaims();
  const decision = arbitrateAppSurface(
    request.target,
    currentViewportSnapshot(request.actorId),
  );
  const entry = coordinator.enqueue(request);
  if (decision.navigate || decision.animate) {
    completeLater(request.actorId, request.operationId);
  } else {
    coordinator.complete(request.actorId, request.operationId);
  }
  return entry;
}

export function performAppUiEvent(event: {
  key: string;
  runId?: string;
  payload?: Record<string, unknown>;
}): void {
  const actorId = event.runId?.trim();
  if (!actorId) return;
  const capabilityId = UI_EVENT_CAPABILITY[event.key];
  // Progress and authority messages are semantic run metadata, not user
  // actions. Do not turn an unregistered event into the generic workspace
  // target: that could steal the viewport when Follow AI is enabled.
  if (!capabilityId && event.key !== "navigate" && event.key !== "navigate_spectra") return;
  artifactPerformerFor(actorId);
  const primitive = capabilityId
    ? capabilityById(capabilityId)?.choreography
    : undefined;
  const destination =
    typeof event.payload?.destination === "string"
      ? event.payload.destination
      : undefined;
  const fromNav = destination ? appSurfaceForNavigation(destination) : null;
  const target: AppSurface =
    fromNav ??
    (primitive ? appSurfaceFromChoreographyTarget(primitive.target) : "workspace");
  const targetKey =
    (typeof event.payload?.targetId === "string" && event.payload.targetId) ||
    primitive?.region ||
    event.key;
  performAppChoreography({
    actorId,
    operationId: `${event.key}:${event.runId ?? "run"}`,
    target,
    targetKey,
    summary:
      typeof event.payload?.note === "string" ? event.payload.note : event.key,
  });
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
    if (claimTicker !== null) {
      window.clearInterval(claimTicker);
      claimTicker = null;
    }
    window.removeEventListener("pointerdown", onInput, true);
    window.removeEventListener("keydown", onInput, true);
    window.removeEventListener("wheel", onInput, true);
    removeStopFollowing();
    for (const timer of settleTimers.values()) window.clearTimeout(timer);
    settleTimers.clear();
  };
}

/** Test-only reset. */
export function __resetAppChoreographyHost(): void {
  for (const timer of settleTimers.values()) {
    if (typeof window !== "undefined") window.clearTimeout(timer);
  }
  settleTimers.clear();
  artifactPerformer?.dispose();
  artifactPerformer = null;
  coordinator = new AppChoreographyCoordinator();
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
