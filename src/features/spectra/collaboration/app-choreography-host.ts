"use client";

import { useEffect } from "react";
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
} from "./follow-ai";
import { disengageFollow, isProgrammaticFollowOpen } from "./follow";
import { getSpectraMotionSnapshot } from "../motion/motion-level";
import { capabilityById } from "../capabilities/catalog";
import type { ActorIdentity } from "./interaction-model";

const UI_EVENT_CAPABILITY: Record<string, string> = {
  organize_library: "app.library.organize",
  settings_changed: "app.settings.change",
  sync_policy_changed: "app.sync.policy.change",
  memory_written: "app.memory.write",
  sharing_changed: "app.sharing.change",
  managebac_sync_requested: "app.managebac.sync",
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
  artifactPerformerFor(actorId);
  const capabilityId = UI_EVENT_CAPABILITY[event.key];
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
    disengageFollowAi();
    disengageFollow("user_input");
  };
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
  useEffect(() => startAppChoreographyMaintenance(), []);
  return null;
}
