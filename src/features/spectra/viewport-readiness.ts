import { spectraBus } from "./events";

export type ViewportView =
  | "library"
  | "workspace"
  | "settings"
  | "calendar"
  | "artifact"
  | "conversation";

export type ViewportReadinessAcknowledgement = {
  actionId: string;
  targetId: string;
  view: ViewportView;
  routeGeneration: number;
  status: "ready" | "failed" | "cancelled";
  reason?: string;
};

type PendingAction = {
  actionId: string;
  targetId: string;
  view: ViewportView;
  routeGeneration: number;
  supersedeKey: string;
  resolve: (ack: ViewportReadinessAcknowledgement) => void;
  timer?: ReturnType<typeof setTimeout>;
};

const pending = new Map<string, PendingAction>();
let generation = 0;

function id() {
  return globalThis.crypto?.randomUUID?.() ?? `viewport-${Date.now()}-${++generation}`;
}

function publish(ack: ViewportReadinessAcknowledgement) {
  spectraBus.emit("navigation.readiness", ack);
  return ack;
}

function finish(action: PendingAction, status: ViewportReadinessAcknowledgement["status"], reason?: string) {
  if (action.timer) clearTimeout(action.timer);
  pending.delete(action.actionId);
  const ack: ViewportReadinessAcknowledgement = {
    actionId: action.actionId,
    targetId: action.targetId,
    view: action.view,
    routeGeneration: action.routeGeneration,
    status,
    ...(reason ? { reason } : {}),
  };
  action.resolve(publish(ack));
}

/**
 * Correlates a human open/navigation with the mounted surface. A new human
 * navigation supersedes the previous one, so A → B → A cannot let B's late
 * mount acknowledge the final A request.
 */
export function requestViewportAction(input: {
  targetId: string;
  view: ViewportView;
  navigate: () => void | Promise<void>;
  actionId?: string;
  supersedeKey?: string;
  timeoutMs?: number;
}): Promise<ViewportReadinessAcknowledgement> {
  const actionId = input.actionId ?? id();
  const supersedeKey = input.supersedeKey ?? "human-navigation";
  for (const action of [...pending.values()]) {
    if (action.supersedeKey === supersedeKey)
      finish(action, "cancelled", "Superseded by a newer navigation.");
  }
  const routeGeneration = ++generation;
  return new Promise((resolve) => {
    const action: PendingAction = {
      actionId,
      targetId: input.targetId,
      view: input.view,
      routeGeneration,
      supersedeKey,
      resolve,
    };
    pending.set(actionId, action);
    action.timer = setTimeout(() => {
      if (pending.get(actionId) !== action) return;
      finish(action, "failed", "The requested surface did not become ready in time.");
    }, Math.max(250, input.timeoutMs ?? 6_000));
    Promise.resolve()
      .then(input.navigate)
      .catch((error: unknown) => {
        if (pending.get(actionId) !== action) return;
        finish(
          action,
          "failed",
          error instanceof Error ? error.message : "The requested surface could not be opened.",
        );
      });
  });
}

/** Called by a mounted route/studio, never by the navigation initiator. */
export function acknowledgeViewportReady(input: {
  actionId?: string;
  targetId: string;
  view: ViewportView;
}) {
  const action = input.actionId
    ? pending.get(input.actionId)
    : [...pending.values()]
        .reverse()
        .find(
          (candidate) =>
            candidate.view === input.view &&
            (candidate.targetId === input.targetId ||
              (candidate.view === "conversation" && candidate.targetId === "chat")),
        );
  if (!action || action.view !== input.view) return false;
  if (
    action.targetId !== input.targetId &&
    !(action.view === "conversation" && action.targetId === "chat")
  )
    return false;
  finish(action, "ready");
  return true;
}

export function cancelViewportAction(actionId: string, reason = "Navigation closed.") {
  const action = pending.get(actionId);
  if (!action) return false;
  finish(action, "cancelled", reason);
  return true;
}

export function announceManualViewportInteraction(input: {
  surface: string;
  interaction: "pointer" | "keyboard" | "wheel";
  targetId?: string;
}) {
  spectraBus.emit("navigation.manualInteraction", input);
}

export function pendingViewportActions() {
  return [...pending.values()].map(({ resolve: _resolve, timer: _timer, ...action }) => ({ ...action }));
}

export function __resetViewportReadiness() {
  for (const action of [...pending.values()])
    finish(action, "cancelled", "Reset for test.");
  generation = 0;
}
