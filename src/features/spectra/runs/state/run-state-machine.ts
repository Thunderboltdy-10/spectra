export type RunProtocolState =
  | "created"
  | "planning"
  | "running_model"
  | "running_tools"
  | "performing_action"
  | "waiting_for_resource"
  | "waiting_for_actor"
  | "waiting_for_user"
  | "paused"
  | "resuming"
  | "completed"
  | "completed_partial"
  | "cancelled"
  | "failed_terminal";

const terminal = new Set<RunProtocolState>(["completed", "completed_partial", "cancelled", "failed_terminal"]);
const transitions: Record<RunProtocolState, readonly RunProtocolState[]> = {
  created: ["planning", "cancelled", "failed_terminal"],
  planning: ["running_model", "running_tools", "performing_action", "waiting_for_user", "completed", "completed_partial", "cancelled", "failed_terminal"],
  running_model: ["running_tools", "performing_action", "waiting_for_resource", "waiting_for_actor", "waiting_for_user", "paused", "completed", "completed_partial", "cancelled", "failed_terminal"],
  running_tools: ["running_model", "performing_action", "waiting_for_resource", "waiting_for_user", "paused", "completed", "completed_partial", "cancelled", "failed_terminal"],
  performing_action: ["running_model", "running_tools", "waiting_for_actor", "waiting_for_resource", "paused", "completed", "completed_partial", "cancelled", "failed_terminal"],
  waiting_for_resource: ["resuming", "paused", "completed_partial", "cancelled", "failed_terminal"],
  waiting_for_actor: ["resuming", "paused", "cancelled"],
  waiting_for_user: ["resuming", "paused", "cancelled"],
  paused: ["resuming", "cancelled"],
  resuming: ["planning", "running_model", "running_tools", "performing_action", "waiting_for_resource", "waiting_for_actor", "waiting_for_user", "cancelled", "failed_terminal"],
  completed: [],
  completed_partial: [],
  cancelled: [],
  failed_terminal: [],
};

export type RunStateSnapshot = {
  state: RunProtocolState;
  revision: number;
  updatedAt: number;
  reason?: string;
};

export class RunStateMachine {
  private snapshot: RunStateSnapshot;
  private readonly listeners = new Set<(snapshot: RunStateSnapshot) => void>();

  constructor(initial: RunProtocolState = "created", now = Date.now()) {
    this.snapshot = { state: initial, revision: 0, updatedAt: now };
  }

  getSnapshot = () => this.snapshot;

  subscribe(listener: (snapshot: RunStateSnapshot) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  canTransition(next: RunProtocolState) {
    return transitions[this.snapshot.state].includes(next);
  }

  transition(next: RunProtocolState, reason?: string, now = Date.now()) {
    if (!this.canTransition(next))
      throw new Error(`RUN_STATE_TRANSITION_INVALID: ${this.snapshot.state} -> ${next}`);
    this.snapshot = { state: next, revision: this.snapshot.revision + 1, updatedAt: now, ...(reason ? { reason } : {}) };
    for (const listener of this.listeners) listener(this.snapshot);
    return this.snapshot;
  }

  isTerminal() {
    return terminal.has(this.snapshot.state);
  }

  isRecoverableWait() {
    return this.snapshot.state === "waiting_for_actor" || this.snapshot.state === "waiting_for_resource" || this.snapshot.state === "waiting_for_user" || this.snapshot.state === "paused";
  }
}

export function isTerminalRunState(state: RunProtocolState) {
  return terminal.has(state);
}
