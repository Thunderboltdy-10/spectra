import type { SpectraCommands } from "../events/contracts";

export type PendingBridgeIntent =
  | {
      kind: "setup";
      actionId: string;
      input: SpectraCommands["bridge.setup"];
    }
  | {
      kind: "policy";
      actionId: string;
      input: SpectraCommands["bridge.policy.change"];
    };

let pending: PendingBridgeIntent | null = null;

/**
 * Keep one exact Bridge action alive while settings is being mounted. This is
 * deliberately a tiny handoff, not a second command registry: a newer action
 * supersedes the older one and the mounted Bridge surface consumes it once.
 */
export function retainBridgeIntent(intent: PendingBridgeIntent) {
  if (pending?.actionId === intent.actionId) return;
  pending = intent;
}

export function takePendingBridgeIntent() {
  const intent = pending;
  pending = null;
  return intent;
}

export function clearBridgeIntent(actionId: string) {
  if (pending?.actionId === actionId) pending = null;
}

export function pendingBridgeIntent() {
  return pending;
}

export function __resetBridgeIntents() {
  pending = null;
}
