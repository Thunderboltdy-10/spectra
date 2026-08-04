export type CapabilityState<T = unknown> =
  | { kind: "available"; data?: T; updatedAt?: number }
  | { kind: "refreshing"; previous?: T }
  | { kind: "stale"; data?: T; updatedAt: number; reason?: string }
  | { kind: "partial"; data?: T; details: string }
  | { kind: "not_connected" }
  | { kind: "permission_denied" }
  | { kind: "unsupported" }
  | { kind: "schema_incompatible"; issueId?: string }
  | { kind: "unavailable"; retryable: boolean; message: string };

export function capabilityData<T>(state: CapabilityState<T>): T | undefined {
  if (state.kind === "available") return state.data;
  if (state.kind === "stale" || state.kind === "partial") return state.data;
  if (state.kind === "refreshing") return state.previous;
  return undefined;
}

export function capabilityIsActionable<T>(state: CapabilityState<T>) {
  return state.kind === "available" || state.kind === "stale" || state.kind === "partial";
}
