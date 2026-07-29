/**
 * The run ledger: the client-side projection of execution truth.
 *
 * A run is a ledger of operations, not one all-or-nothing request. This store
 * records, per run: which operations were intended, which committed durably,
 * which one is still in flight, and whether an invisible continuation is
 * under way. Every surface that tells the story of a run — Quick Chat,
 * artifact cards, the collaborator stack, catch-up decisions — reads from
 * here so they can never disagree about what happened.
 *
 * Two kinds of truth are kept apart:
 *
 *  - **Durable truth** arrives from run events (operation previews, results,
 *    terminal states). It survives reloads because the server re-publishes it.
 *  - **Presentation metadata** — which operations this client has already
 *    watched — is persisted to session storage so reopening an artifact
 *    mid-run never replays work the user already saw, and reopening after a
 *    terminal run shows only the clean final state.
 */

import { useSyncExternalStore } from "react";

export type LedgerOperationStatus =
  "intended" | "performing" | "committed" | "failed" | "skipped";

export type LedgerOperation = {
  operationId: string;
  /** create / update / archive / link / place / remove / workspace */
  action?: string;
  /** Human-readable intent, e.g. "Rewriting question 3". */
  title: string;
  artifactId?: string;
  blueprintKey?: string;
  status: LedgerOperationStatus;
  /** 0-based position within the run when known. */
  order: number;
  updatedAt: number;
};

export type RunPhase =
  | "queued"
  | "running"
  /** One invisible continuation attempt is in flight; the user was never shown an error. */
  | "continuing"
  | "awaiting_confirmation"
  | "completed"
  /** Some operations committed; a later one could not be finished. */
  | "partial"
  | "failed"
  | "cancelled";

export type RunLedgerEntry = {
  runId: string;
  prompt?: string;
  phase: RunPhase;
  operations: LedgerOperation[];
  /** Set once the model finished generating; choreography may still be playing. */
  generationDone: boolean;
  /** Public one-line explanation for a partial/failed run. */
  failureNote?: string;
  /** True when completed work exists alongside an unfinished operation. */
  preservedPartial: boolean;
  startedAt: number;
  updatedAt: number;
};

type PresentationMemory = {
  /** Operation ids this client has already seen performed. */
  seenOperationIds: string[];
  /** Terminal phase reached while this client watched. */
  terminal?: RunPhase;
  updatedAt: number;
};

const MAX_OPERATIONS_PER_RUN = 48;
const MAX_RUNS = 24;
const MEMORY_KEY = "spectra.run-ledger.v1";

const runs = new Map<string, RunLedgerEntry>();
const memory = new Map<string, PresentationMemory>();
const listeners = new Set<() => void>();
let memoryLoaded = false;

function emit(): void {
  for (const listener of listeners) listener();
}

function loadMemory(): void {
  if (memoryLoaded || typeof window === "undefined") return;
  memoryLoaded = true;
  try {
    const raw = window.sessionStorage.getItem(MEMORY_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return;
    for (const [runId, entry] of Object.entries(parsed)) {
      if (!entry || typeof entry !== "object") continue;
      const record = entry as Record<string, unknown>;
      if (!Array.isArray(record.seenOperationIds)) continue;
      memory.set(runId, {
        seenOperationIds: record.seenOperationIds
          .filter((id): id is string => typeof id === "string")
          .slice(0, MAX_OPERATIONS_PER_RUN),
        ...(typeof record.terminal === "string"
          ? { terminal: record.terminal as RunPhase }
          : {}),
        updatedAt: typeof record.updatedAt === "number" ? record.updatedAt : 0,
      });
    }
  } catch {
    // A corrupt or unavailable store must never break a session.
  }
}

function persistMemory(): void {
  if (typeof window === "undefined") return;
  try {
    const entries = [...memory.entries()]
      .sort((a, b) => b[1].updatedAt - a[1].updatedAt)
      .slice(0, MAX_RUNS);
    window.sessionStorage.setItem(
      MEMORY_KEY,
      JSON.stringify(Object.fromEntries(entries)),
    );
  } catch {
    // Storage full/unavailable: presentation memory becomes session-scoped.
  }
}

function entryFor(runId: string, create = false): RunLedgerEntry | null {
  const existing = runs.get(runId);
  if (existing) return existing;
  if (!create) return null;
  const now = Date.now();
  const entry: RunLedgerEntry = {
    runId,
    phase: "running",
    operations: [],
    generationDone: false,
    preservedPartial: false,
    startedAt: now,
    updatedAt: now,
  };
  runs.set(runId, entry);
  // Bound the store so a long session cannot accumulate dead runs.
  if (runs.size > MAX_RUNS) {
    const ordered = [...runs.values()].sort(
      (a, b) => a.updatedAt - b.updatedAt,
    );
    for (const stale of ordered.slice(0, runs.size - MAX_RUNS)) {
      runs.delete(stale.runId);
    }
  }
  return entry;
}

function upsertOperation(
  entry: RunLedgerEntry,
  operationId: string,
  update: Partial<LedgerOperation>,
): void {
  const index = entry.operations.findIndex(
    (operation) => operation.operationId === operationId,
  );
  if (index === -1) {
    entry.operations.push({
      operationId,
      title: update.title ?? "Working",
      status: update.status ?? "intended",
      order: entry.operations.length,
      updatedAt: Date.now(),
      ...update,
    });
    if (entry.operations.length > MAX_OPERATIONS_PER_RUN) {
      entry.operations = entry.operations.slice(-MAX_OPERATIONS_PER_RUN);
    }
    return;
  }
  entry.operations[index] = {
    ...entry.operations[index]!,
    ...update,
    updatedAt: Date.now(),
  };
}

/* ------------------------------------------------------------------ *
 * Event ingestion
 * ------------------------------------------------------------------ */

export type LedgerEvent = {
  type: string;
  runId: string;
  operationId?: string;
  operationType?: string;
  preview?: {
    action?: string;
    title?: string;
    blueprintKey?: string;
    targetId?: string;
    pendingArtifactId?: string;
  };
  affected?: Array<{ type: string; id: string }>;
  message?: string;
  partial?: boolean;
};

/**
 * Feed one run event into the ledger. Events are idempotent and may arrive
 * out of order on a reload; the ledger keeps the furthest-known state.
 */
export function recordRunEvent(event: LedgerEvent): void {
  const entry = entryFor(event.runId, true)!;
  entry.updatedAt = Date.now();
  switch (event.type) {
    case "run_created":
      entry.phase = "running";
      break;
    case "operation_preview": {
      const operationId =
        event.operationId ??
        `${event.runId}:preview:${entry.operations.length}`;
      upsertOperation(entry, operationId, {
        title: event.preview?.title?.trim() || "Working",
        ...(event.preview?.action ? { action: event.preview.action } : {}),
        ...(event.preview?.blueprintKey
          ? { blueprintKey: event.preview.blueprintKey }
          : {}),
        ...((event.preview?.pendingArtifactId ?? event.preview?.targetId)
          ? {
              artifactId:
                event.preview.pendingArtifactId ?? event.preview.targetId,
            }
          : {}),
        status: "performing",
      });
      break;
    }
    case "operation_commit":
    case "operation_result": {
      if (event.operationId) {
        upsertOperation(entry, event.operationId, { status: "committed" });
      } else {
        // A result without an id settles the oldest unfinished operation.
        const open = entry.operations.find(
          (operation) =>
            operation.status === "performing" ||
            operation.status === "intended",
        );
        if (open) open.status = "committed";
      }
      break;
    }
    case "status": {
      // The server's invisible continuation republishes calm status copy. The
      // ledger marks the run as continuing so no surface flashes a failure.
      const message = event.message ?? "";
      if (/another careful pass|cleaner read|retry/i.test(message)) {
        if (entry.phase === "running" || entry.phase === "continuing") {
          entry.phase = "continuing";
        }
      }
      break;
    }
    case "confirmation_required":
      entry.phase = "awaiting_confirmation";
      break;
    case "final":
      entry.phase = entry.preservedPartial ? "partial" : "completed";
      entry.generationDone = true;
      break;
    case "stopped":
      entry.phase = "cancelled";
      entry.generationDone = true;
      entry.preservedPartial = Boolean(event.partial);
      break;
    case "interrupted":
    case "error": {
      const committed = entry.operations.some(
        (operation) => operation.status === "committed",
      );
      entry.preservedPartial = committed || Boolean(event.partial);
      entry.phase = entry.preservedPartial ? "partial" : "failed";
      entry.generationDone = true;
      entry.failureNote = event.message?.trim() || "Could not finish this run.";
      // Mark the in-flight operation as failed; committed work stays committed.
      for (const operation of entry.operations) {
        if (
          operation.status === "performing" ||
          operation.status === "intended"
        ) {
          operation.status = "failed";
        }
      }
      break;
    }
    default:
      break;
  }
  emit();
}

/** Live awareness note for the operation currently being performed. */
export function noteOperationPerforming(
  runId: string,
  operationId: string | undefined,
  note: string,
): void {
  const entry = entryFor(runId, false);
  if (!entry || entry.phase === "completed" || entry.phase === "cancelled")
    return;
  if (operationId) {
    const operation = entry.operations.find(
      (candidate) => candidate.operationId === operationId,
    );
    if (operation && operation.status !== "committed") {
      operation.status = "performing";
      if (note.trim()) operation.title = note.trim();
      entry.updatedAt = Date.now();
      emit();
      return;
    }
  }
  entry.updatedAt = Date.now();
}

/* ------------------------------------------------------------------ *
 * Presentation memory
 * ------------------------------------------------------------------ */

/** Mark an operation as witnessed so a reopen never replays it. */
export function markOperationSeen(runId: string, operationId: string): void {
  loadMemory();
  const record = memory.get(runId) ?? { seenOperationIds: [], updatedAt: 0 };
  if (!record.seenOperationIds.includes(operationId)) {
    record.seenOperationIds.push(operationId);
  }
  record.updatedAt = Date.now();
  memory.set(runId, record);
  persistMemory();
}

export function hasSeenOperation(runId: string, operationId: string): boolean {
  loadMemory();
  return memory.get(runId)?.seenOperationIds.includes(operationId) ?? false;
}

/** Record the terminal phase this client witnessed. */
export function markRunTerminal(runId: string, phase: RunPhase): void {
  loadMemory();
  const record = memory.get(runId) ?? { seenOperationIds: [], updatedAt: 0 };
  record.terminal = phase;
  record.updatedAt = Date.now();
  memory.set(runId, record);
  persistMemory();
}

/**
 * True when an artifact opened now should treat this run as live work in
 * progress (and join the current beat), false when it must show the clean
 * final state with no catch-up chrome.
 */
export function runIsLiveFor(runId: string): boolean {
  const entry = entryFor(runId, false);
  if (!entry) return false;
  return (
    entry.phase === "running" ||
    entry.phase === "continuing" ||
    entry.phase === "queued" ||
    entry.phase === "awaiting_confirmation"
  );
}

export function getRunLedger(runId: string): RunLedgerEntry | null {
  return entryFor(runId, false);
}

export function listRunLedgers(): RunLedgerEntry[] {
  return [...runs.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Counts that let a partial run tell the truth about itself. */
export function operationCounts(entry: RunLedgerEntry): {
  committed: number;
  failed: number;
  pending: number;
} {
  let committed = 0;
  let failed = 0;
  let pending = 0;
  for (const operation of entry.operations) {
    if (operation.status === "committed") committed += 1;
    else if (operation.status === "failed") failed += 1;
    else pending += 1;
  }
  return { committed, failed, pending };
}

/* ------------------------------------------------------------------ *
 * React binding
 * ------------------------------------------------------------------ */

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useRunLedger(
  runId: string | null | undefined,
): RunLedgerEntry | null {
  return useSyncExternalStore(
    subscribe,
    () => (runId ? entryFor(runId, false) : null),
    () => null,
  );
}

/** Test-only reset. */
export function __resetRunLedger(): void {
  runs.clear();
  memory.clear();
  memoryLoaded = false;
  listeners.clear();
  if (typeof window !== "undefined") {
    try {
      window.sessionStorage.removeItem(MEMORY_KEY);
    } catch {
      // ignore
    }
  }
}
