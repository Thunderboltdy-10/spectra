"use client";

import { toast } from "sonner";
import {
  observedActionIdentitySchema, uiObservationSnapshotSchema,
  type SettingsToggleAction, type UiObservationSnapshot,
} from "../actions/protocol/semantic-action";
import { currentViewportSnapshot, getAppChoreographyCoordinator, performAppChoreography, presentAppControl } from "./app-choreography-host";
import { getSpectraMotionSnapshot } from "../motion/motion-level";
import { settingsToggleControls } from "./settings-toggle-control";
import { disengageFollowAi, getFollowedAiActorId, isFollowingAi, noteAiSurface, subscribeFollowAi } from "./follow-ai";

let clientId: string | undefined;
const runs = new Map<string, string>();
type Pending = { action: SettingsToggleAction; mode: "ordinary" | "follow"; confirmed: boolean; recovering: boolean; resolve: () => void; reject: (error: Error) => void };
const pending = new Map<string, Pending>();
const delivered = new Map<string, { key: string }>();
const currentActions = new Map<string, SettingsToggleAction>();
const interestRequests = new Map<string, Promise<unknown>>();
const identityKey = (action: SettingsToggleAction) => JSON.stringify([action.runId, action.executionId, action.operationId, action.epoch]);
const following = (runId: string) => isFollowingAi() && getFollowedAiActorId() === runId;

export function uiObserverForRun(runId: string) {
  clientId ??= crypto.randomUUID();
  return { clientId, mode: following(runId) ? "follow" as const : "ordinary" as const };
}

async function request(action: "ui_observer" | "ui_observer_ack", payload: Record<string, unknown>) {
  const response = await fetch("/api/spectra/run", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, payload }),
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error("This observed action is no longer available.");
  return response.json() as Promise<unknown>;
}

function endFollow(runId: string, message: string) {
  if (!following(runId)) return;
  disengageFollowAi();
  toast.message(message);
}

function sendInterest(runId: string, payload: Record<string, unknown>): Promise<unknown> {
  // Preserve actual Follow transition order even if HTTP responses race. This
  // queue exists only for in-flight requests and never owns durable state.
  const previous = interestRequests.get(runId) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(() => request("ui_observer", payload));
  interestRequests.set(runId, next);
  void next.finally(() => { if (interestRequests.get(runId) === next) interestRequests.delete(runId); }).catch(() => undefined);
  return next;
}

/** One interest update per discovered attempt or actual mode transition. */
export function observeUiRun(runId: string, executionId?: string, register = true): void {
  if (!executionId || runs.get(runId) === executionId) return;
  runs.set(runId, executionId);
  if (runs.size > 24) runs.delete(runs.keys().next().value!);
  if (register) void publishInterest(runId, executionId);
}

async function publishInterest(runId: string, executionId: string, release = false, releaseCurrent = false) {
  const observer = uiObserverForRun(runId);
  try {
    const current = currentActions.get(runId);
    const response = await sendInterest(runId, {
      runId, executionId, ...observer, ...(release || document.visibilityState !== "visible" ? { mode: "released" } : {}),
      ...(current?.executionId === executionId ? { operationId: current.operationId } : {}),
      ...(releaseCurrent ? { releaseCurrent: true } : {}),
    }) as { observation?: unknown };
    const joined = uiObservationSnapshotSchema.safeParse(response.observation);
    if (joined.success && joined.data.phase === "waiting" && joined.data.action &&
      joined.data.participants?.some((entry) => entry.clientId === clientId && !entry.outcome) &&
      !pending.has(identityKey(joined.data.action))) {
      delivered.delete(runId);
      await performPrepared(joined.data);
    }
  } catch {
    endFollow(runId, "Follow AI could not connect to this action. The task continues.");
  }
}

export function stopObservingUiRun(runId: string, recoverReceipt = false): void {
  runs.delete(runId);
  delivered.delete(runId);
  currentActions.delete(runId);
  for (const [key, value] of pending) if (value.action.runId === runId) {
    if (value.confirmed) continue;
    if (recoverReceipt) {
      value.recovering = true;
      void readOrAck(value.action, value.mode).then((state) => {
        if (state.phase === "committed") value.resolve();
        else value.reject(new Error("UI_OBSERVATION_ENDED"));
      }, () => value.reject(new Error("UI_OBSERVATION_ENDED")));
    } else {
      value.reject(new Error("UI_OBSERVATION_ENDED"));
      pending.delete(key);
    }
  }
}

export function startSettingsObservationClient(): () => void {
  let previousFollow = getFollowedAiActorId();
  const stop = subscribeFollowAi(() => {
    const next = getFollowedAiActorId();
    if (previousFollow === next) return;
    const changed = new Set([previousFollow, next]);
    previousFollow = next;
    for (const runId of changed) if (runId && runs.has(runId)) void publishInterest(runId, runs.get(runId)!, false, runId !== next);
  });
  const visibility = () => {
    for (const [runId, executionId] of runs) void publishInterest(runId, executionId, document.visibilityState !== "visible");
    if (document.visibilityState !== "visible" && previousFollow)
      endFollow(previousFollow, "Follow AI paused because this tab is hidden. The task continues.");
  };
  document.addEventListener("visibilitychange", visibility);
  return () => {
    stop(); document.removeEventListener("visibilitychange", visibility);
    for (const runId of [...runs.keys()]) stopObservingUiRun(runId);
  };
}

function observerIdentity(action: SettingsToggleAction) {
  return observedActionIdentitySchema.parse({
    runId: action.runId, executionId: action.executionId, operationId: action.operationId,
    operationDigest: action.operationDigest, epoch: action.epoch, sequence: action.sequence,
  });
}

async function readOrAck(action: SettingsToggleAction, mode: "ordinary" | "follow", outcome?: "target_ready" | "invisible" | "released") {
  return uiObservationSnapshotSchema.parse(await request("ui_observer_ack", {
    identity: observerIdentity(action), observer: { ...uiObserverForRun(action.runId), mode }, ...(outcome ? { outcome } : {}),
  }));
}

const pause = (signal: AbortSignal, milliseconds: number) => new Promise<void>((resolve, reject) => {
  if (signal.aborted) { reject(new Error("UI_OBSERVATION_ENDED")); return; }
  const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, milliseconds);
  const abort = () => { clearTimeout(timer); reject(new Error("UI_OBSERVATION_ENDED")); };
  signal.addEventListener("abort", abort, { once: true });
});

async function performPrepared(snapshot: UiObservationSnapshot) {
  const offered = snapshot.action;
  if (!offered || snapshot.phase !== "waiting") return;
  const key = identityKey(offered);
  if (delivered.get(offered.runId)?.key === key || pending.has(key)) return;
  const delivery = { key };
  delivered.set(offered.runId, delivery);
  // Durable feeds replay. Re-read exactly once before any local action; a saved
  // or expired epoch must never play cosmetic work over its completed write.
  const current = await readOrAck(offered, uiObserverForRun(offered.runId).mode);
  if (delivered.get(offered.runId) !== delivery) return;
  const action = current.action;
  if (!action || identityKey(action) !== key || current.phase !== "waiting") return;
  const participant = current.participants?.find((entry) => entry.clientId === clientId);
  if (!participant || participant.outcome) return;
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const receipt = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  void receipt.catch(() => undefined);
  const entry: Pending = { action, mode: participant.mode, confirmed: false, recovering: false, resolve: () => { entry.confirmed = true; resolve(); }, reject };
  pending.set(key, entry);
  const expiry = setTimeout(() => {
    void readOrAck(action, participant.mode).then((state) => {
      if (state.phase === "committed") entry.resolve();
      else {
        endFollow(action.runId, "Follow AI ended because this control did not stay ready. The task continues.");
        reject(new Error("UI_OBSERVATION_EXPIRED"));
      }
    }, () => {
      endFollow(action.runId, "Follow AI lost contact with this action. The task continues.");
      reject(new Error("UI_OBSERVATION_EXPIRED"));
    });
  }, Math.max(1, action.expiresAt - Date.now()));
  const clean = () => { clearTimeout(expiry); if (pending.get(key) === entry) pending.delete(key); };
  const requestId = `${action.executionId}:${action.operationId}:${action.epoch}`;
  let started = false;
  const cancel = () => {
    clean();
    getAppChoreographyCoordinator().cancel(action.runId, requestId);
  };
  // Queued performers have no callback finally block yet. Settle their local
  // lifetime here so expiry/Stop cannot strand a queue entry or replay a save.
  void receipt.then(() => {
    clearTimeout(expiry);
    if (!started) cancel();
  }, cancel);
  performAppChoreography({ actorId: action.runId, operationId: requestId, target: "settings", targetKey: action.target, summary: "Updating Smart completion" }, async (context) => {
    started = true;
    let hidePointer: (() => void) | undefined;
    const abort = () => { if (!entry.recovering && !entry.confirmed) reject(new Error("UI_OBSERVATION_ENDED")); };
    context.signal.addEventListener("abort", abort, { once: true });
    const acknowledge = async (outcome: "target_ready" | "invisible" | "released") => {
      let reply: UiObservationSnapshot;
      try { reply = await readOrAck(action, participant.mode, outcome); }
      catch (error) {
        // One uncertain-response read checks the canonical receipt. This never
        // replays an action or retries a non-idempotent write from a timeout.
        reply = await readOrAck(action, participant.mode);
        if (reply.phase !== "committed") throw error;
      }
      if (reply.phase === "committed") entry.resolve();
      if (outcome !== "target_ready") resolve();
    };
    try {
      let navigated = false;
      while (!context.signal.aborted && Date.now() < action.expiresAt) {
        if (!context.checkpoint()) throw new Error("UI_OBSERVATION_ENDED");
        if (participant.mode === "follow" && (!following(action.runId) || document.visibilityState !== "visible")) {
          await acknowledge("released"); return;
        }
        const decision = context.decision();
        if (!decision.animate) { await acknowledge("invisible"); return; }
        const control = settingsToggleControls().find(({ element }) =>
          currentViewportSnapshot(action.runId, { target: "settings", targetKey: action.target }, [element]).targetVisible,
        );
        if (!control) {
          if (!following(action.runId)) { await acknowledge("invisible"); return; }
          if (decision.navigate && !navigated) {
            noteAiSurface({ actorId: action.runId, route: "settings", target: "writing", note: "Updating Smart completion" });
            navigated = true;
          }
          if (following(action.runId)) settingsToggleControls()[0]?.element.scrollIntoView({ block: "nearest", behavior: "instant" });
          await pause(context.signal, 50);
          continue;
        }
        hidePointer = presentAppControl(action.runId, requestId, control.element);
        if (!getSpectraMotionSnapshot().reduced) await pause(context.signal, 180);
        // Visibility can change during the approach. Start again at the next
        // boundary; ordinary mode never reveals or steals selection/focus.
        if (!currentViewportSnapshot(action.runId, { target: "settings", targetKey: action.target }, [control.element]).targetVisible) { hidePointer(); hidePointer = undefined; continue; }
        await control.perform({ signal: context.signal, reachActionPoint: async () => {
          if (participant.mode === "follow" && !following(action.runId)) { await acknowledge("released"); throw new Error("UI_OBSERVATION_ENDED"); }
          if (!context.checkpoint() || !context.holdUntil(action.expiresAt + 5_000)) throw new Error("UI_OBSERVATION_ENDED");
          await acknowledge("target_ready");
          await receipt;
        } });
        return;
      }
      await acknowledge("released");
    } catch (error) {
      reject(error instanceof Error ? error : new Error("UI_OBSERVATION_ENDED"));
      // An unavailable control ends its observation, never the approved task.
      endFollow(action.runId, "Follow AI lost this control. The task continues.");
      await acknowledge("released").catch(() => undefined);
    } finally {
      hidePointer?.(); context.signal.removeEventListener("abort", abort); clean();
    }
  });
}

/** Existing run event transport only; no secondary action bus or poll loop. */
export function handleSettingsObservationEvent(event: { runId?: string; key: string; payload?: Record<string, unknown> }): boolean {
  if (event.key === "settings_toggle_prepared") {
    const snapshot = uiObservationSnapshotSchema.safeParse(event.payload);
    if (event.runId && snapshot.success && snapshot.data.action && snapshot.data.action.runId === event.runId) {
      currentActions.set(event.runId, snapshot.data.action);
      void performPrepared(snapshot.data).catch(() => endFollow(event.runId!, "Follow AI could not resume this action. The task continues."));
    }
    return true;
  }
  if (event.key === "settings_observer_ended") {
    if (event.runId && Array.isArray(event.payload?.clientIds) && event.payload.clientIds.includes(clientId)) {
      endFollow(event.runId, typeof event.payload.reason === "string" ? event.payload.reason : "Follow AI ended. The task continues.");
      for (const value of pending.values()) if (value.action.runId === event.runId && value.action.operationId === event.payload.operationId && value.action.epoch === event.payload.epoch)
        value.reject(new Error("UI_OBSERVATION_ENDED"));
    }
    return true;
  }
  if (event.key === "settings_toggle_committed") {
    const saved = observedActionIdentitySchema.safeParse(event.payload);
    if (saved.success && saved.data.runId === event.runId) {
      for (const value of pending.values()) if (value.action.runId === saved.data.runId && value.action.executionId === saved.data.executionId && value.action.operationId === saved.data.operationId && value.action.operationDigest === saved.data.operationDigest && value.action.epoch === saved.data.epoch)
        value.resolve();
    }
    return true;
  }
  return false;
}
