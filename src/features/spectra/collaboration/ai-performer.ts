"use client";

/**
 * The AI performer.
 *
 * Turns validated operation envelopes into a *performance*: owner-attributed
 * presence arrives, moves to the real control, operates it through the native
 * choreography for that control primitive, then releases it. Committed work
 * leaves no mark; it is ordinary content the moment it is durable.
 *
 * The contract deliberately starts from the earliest safe point. A performance
 * needs only one small envelope — artifact, semantic target, action, identity —
 * so visible work can begin as soon as the model has produced enough validated
 * information for one operation, rather than after an entire response parses.
 *
 * Four properties are structural rather than incidental:
 *
 *  1. Nothing untrusted is ever animated. An envelope that fails validation is
 *     rejected before it can affect the screen.
 *  2. Streamed frames are speculative. They are published as speculation and
 *     rendered as provisional; only `commit` makes a value durable.
 *  3. Failure reverses one operation. A malformed later envelope discards that
 *     operation's unfinished preview and leaves every completed operation alone,
 *     so recovery never replays work that already succeeded.
 *  4. **One actor has one body.** However fast the model returns operations,
 *     exactly one is ever being performed. The rest wait, and they wait in
 *     route order rather than arrival order, so the visible pass through an
 *     artifact reads as methodical instead of scattered.
 */

import {
  planChoreography,
  type ChoreographyFrame,
  type ChoreographyPlan,
} from "./choreography";
import { buildTarget } from "./control-descriptors";
import { orderPathsByRoute } from "./presentation-lane";
import {
  canonicalPath,
  normalizeInteractionState,
  type ActorIdentity,
  type InteractionLifecycle,
  type InteractionState,
  type SemanticTarget,
} from "./interaction-model";
import { describeAct } from "./interaction-model";
import type { ArtifactTypeKey } from "../artifacts/types";
import { getSpectraMotionSnapshot } from "../motion/motion-level";

export type AiOperationAction =
  "set" | "create" | "remove" | "reorder" | "group" | "switchView";

/**
 * The minimum an operation needs to become visible. Everything optional is a
 * refinement of the performance, never a precondition for starting it.
 */
export type AiOperationEnvelope = {
  runId: string;
  operationId: string;
  artifactId: string;
  typeKey: ArtifactTypeKey;
  /** Canonical content pointer for the control being operated. */
  path: string;
  action: AiOperationAction;
  before?: unknown;
  after?: unknown;
  regionId?: string;
  /** Real option list, so an observed dropdown shows the truth. */
  menuOptions?: Array<{ value: string; label: string }>;
  reorder?: { from: number; to: number };
  members?: string[];
  /** Where a moved object lands. */
  dropPath?: string;
  /** Human-readable description for traces and history. */
  summary?: string;
  /** History version that restores the pre-operation state. */
  restoreVersionId?: string;
};

export type AiPerformanceStatus =
  | "queued"
  | "performing"
  | "blocked"
  | "paused"
  | "committing"
  | "completed"
  | "failed"
  | "cancelled";

export type AiPerformanceSnapshot = {
  /** Values the AI is provisionally showing, keyed by canonical path. */
  speculation: Map<string, unknown>;
  /** Current live state for each in-flight operation. */
  operations: Array<{
    operationId: string;
    target: SemanticTarget;
    status: AiPerformanceStatus;
    note: string;
    /** 0..1 through the choreography. */
    progress: number;
  }>;
};

const EMPTY_SNAPSHOT: AiPerformanceSnapshot = {
  speculation: new Map(),
  operations: [],
};

/**
 * How long a settled value is held after the choreography finishes, waiting for
 * the durable Yjs value to arrive. Prevents a visible flash back to the old
 * value between the animation ending and the commit landing.
 */
const DURABLE_GRACE_MS = 4_000;

type Performance = {
  envelope: AiOperationEnvelope;
  plan: ChoreographyPlan;
  target: SemanticTarget;
  status: AiPerformanceStatus;
  frameIndex: number;
  note: string;
  timer: number | null;
  /** Last provisional value this operation published. */
  provisional?: unknown;
  /** Set once the choreography has finished and we await the durable value. */
  graceTimer: number | null;
};

/**
 * Validate an envelope. Returns null for anything that cannot be performed
 * safely — the gate that keeps raw or partial model output off the screen.
 */
export function validateEnvelope(value: unknown): AiOperationEnvelope | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const strings = [
    "runId",
    "operationId",
    "artifactId",
    "typeKey",
    "path",
  ] as const;
  for (const key of strings) {
    if (typeof record[key] !== "string" || !(record[key] as string))
      return null;
  }
  const action = record.action;
  const allowed: AiOperationAction[] = [
    "set",
    "create",
    "remove",
    "reorder",
    "group",
    "switchView",
  ];
  if (
    typeof action !== "string" ||
    !allowed.includes(action as AiOperationAction)
  )
    return null;

  // A `set` with no intended value cannot be performed; performing it anyway is
  // how "final-state updates masquerading as streaming" used to appear.
  if (action === "set" && !("after" in record)) return null;
  if (action === "reorder") {
    const reorder = record.reorder as Record<string, unknown> | undefined;
    if (
      !reorder ||
      typeof reorder.from !== "number" ||
      typeof reorder.to !== "number"
    )
      return null;
  }

  return {
    runId: record.runId as string,
    operationId: record.operationId as string,
    artifactId: record.artifactId as string,
    typeKey: record.typeKey as ArtifactTypeKey,
    path: canonicalPath(record.path as string),
    action: action as AiOperationAction,
    ...("before" in record ? { before: record.before } : {}),
    ...("after" in record ? { after: record.after } : {}),
    ...(typeof record.regionId === "string"
      ? { regionId: record.regionId }
      : {}),
    ...(Array.isArray(record.menuOptions)
      ? {
          menuOptions: record.menuOptions.flatMap((option) => {
            if (!option || typeof option !== "object") return [];
            const entry = option as Record<string, unknown>;
            if (typeof entry.value !== "string") return [];
            return [
              {
                value: entry.value,
                label:
                  typeof entry.label === "string" ? entry.label : entry.value,
              },
            ];
          }),
        }
      : {}),
    ...(record.reorder
      ? { reorder: record.reorder as { from: number; to: number } }
      : {}),
    ...(Array.isArray(record.members)
      ? {
          members: record.members.filter(
            (member): member is string => typeof member === "string",
          ),
        }
      : {}),
    ...(typeof record.dropPath === "string"
      ? { dropPath: canonicalPath(record.dropPath) }
      : {}),
    ...(typeof record.summary === "string" ? { summary: record.summary } : {}),
    ...(typeof record.restoreVersionId === "string"
      ? { restoreVersionId: record.restoreVersionId }
      : {}),
  };
}

export class AiPerformer {
  private readonly performances = new Map<string, Performance>();
  private readonly listeners = new Set<() => void>();
  private snapshot: AiPerformanceSnapshot = EMPTY_SNAPSHOT;
  private disposed = false;

  constructor(
    private actor: ActorIdentity,
    /** Publishes an interaction frame, or clears presence when passed null. */
    private readonly publish: (state: InteractionState | null) => void,
  ) {}

  setActor(actor: ActorIdentity): void {
    this.actor = actor;
  }

  getSnapshot(): AiPerformanceSnapshot {
    return this.snapshot;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Accept an operation. It begins immediately if the body is free, and
   * otherwise joins the queue — including when it targets an entirely
   * unrelated control, because a second simultaneous performance would put one
   * actor in two places at once.
   */
  start(input: AiOperationEnvelope | unknown): boolean {
    if (this.disposed) return false;
    const envelope = isEnvelope(input) ? input : validateEnvelope(input);
    if (!envelope) return false;
    if (this.performances.has(envelope.operationId)) return true;

    const target = buildTarget({
      typeKey: envelope.typeKey,
      artifactId: envelope.artifactId,
      path: envelope.path,
      ...(envelope.regionId ? { regionId: envelope.regionId } : {}),
    });

    const plan = this.planFor(envelope, target);
    if (!plan) {
      // Nothing to perform. Still record the change so history and traces are
      // complete, but never show a working state for a no-op.
      this.commit(envelope);
      return false;
    }

    const performance: Performance = {
      envelope,
      plan,
      target,
      status: this.bodyBusy() ? "queued" : "performing",
      frameIndex: 0,
      note: `Preparing ${target.label ?? "the change"}`,
      timer: null,
      graceTimer: null,
    };
    this.performances.set(envelope.operationId, performance);

    // A queued operation is recorded so activity surfaces can report it, but it
    // publishes nothing: presence follows the body, and the body is elsewhere.
    if (performance.status === "performing") this.advance(performance);
    this.refresh();
    return true;
  }

  private planFor(
    envelope: AiOperationEnvelope,
    target: SemanticTarget,
  ): ChoreographyPlan | null {
    const dropTarget = envelope.dropPath
      ? buildTarget({
          typeKey: envelope.typeKey,
          artifactId: envelope.artifactId,
          path: envelope.dropPath,
        })
      : null;
    return planChoreography({
      target,
      ...("before" in envelope ? { before: envelope.before } : {}),
      ...("after" in envelope ? { after: envelope.after } : {}),
      ...(envelope.menuOptions ? { menuOptions: envelope.menuOptions } : {}),
      ...(dropTarget ? { dropTarget } : {}),
      ...(envelope.reorder ? { reorder: envelope.reorder } : {}),
      ...(envelope.members ? { members: envelope.members } : {}),
      ...(envelope.action !== "set"
        ? {
            intent: envelope.action as
              "create" | "remove" | "reorder" | "group" | "switchView",
          }
        : {}),
    });
  }

  /**
   * True while the body is mid-gesture. A performance that has finished its
   * choreography and is only waiting for its durable write does *not* hold the
   * body: the value stays provisionally on screen while the AI moves on, which
   * is what keeps a fast run fast.
   */
  private bodyBusy(): boolean {
    for (const performance of this.performances.values()) {
      if (performance.status === "performing") return true;
    }
    return false;
  }

  /** Play the next frame of a performance. */
  private advance(performance: Performance): void {
    if (this.disposed) return;
    if (performance.status === "blocked" || performance.status === "paused")
      return;

    if (getSpectraMotionSnapshot().reduced) {
      const last = performance.plan.frames.at(-1);
      if (last?.value !== undefined) performance.provisional = last.value;
      performance.frameIndex = performance.plan.frames.length;
      if (last) this.emitFrame(performance, last);
      this.finishChoreography(performance);
      return;
    }

    const frame = performance.plan.frames[performance.frameIndex];
    if (!frame) {
      this.finishChoreography(performance);
      return;
    }
    performance.frameIndex += 1;

    if (frame.value !== undefined) performance.provisional = frame.value;
    performance.note = frame.note ?? describeAct(frame.act, performance.target);

    this.emitFrame(performance, frame);
    this.refresh();

    performance.timer = window.setTimeout(
      () => {
        performance.timer = null;
        this.advance(performance);
      },
      Math.max(24, frame.hold),
    );
  }

  private emitFrame(performance: Performance, frame: ChoreographyFrame): void {
    const lifecycle: InteractionLifecycle =
      frame.lifecycle ??
      (performance.status === "queued" ? "queued" : "active");
    this.publish(
      normalizeInteractionState({
        v: 2,
        actor: this.actor,
        act: frame.act,
        lifecycle,
        target: performance.target,
        ...(frame.menu !== undefined ? { menu: frame.menu } : {}),
        ...(frame.dropTarget !== undefined
          ? { dropTarget: frame.dropTarget }
          : {}),
        ...(performance.provisional !== undefined
          ? {
              speculation: {
                sequence: performance.frameIndex,
                patches: [
                  {
                    path: performance.target.path,
                    value: performance.provisional,
                  },
                ],
              },
            }
          : {}),
        note: performance.note,
        ...(performance.envelope.regionId
          ? { heldRegionIds: [performance.envelope.regionId] }
          : {}),
        at: Date.now(),
      }),
    );
  }

  private emitPresence(
    performance: Performance,
    lifecycle: InteractionLifecycle,
    note?: string,
  ): void {
    this.publish(
      normalizeInteractionState({
        v: 2,
        actor: this.actor,
        act: { kind: "focus" },
        lifecycle,
        target: performance.target,
        note: note ?? performance.note,
        at: Date.now(),
      }),
    );
  }

  /** Choreography finished; hold the value until the durable write arrives. */
  private finishChoreography(performance: Performance): void {
    performance.status = "committing";
    performance.graceTimer = window.setTimeout(() => {
      performance.graceTimer = null;
      // The durable value never confirmed. Release the provisional value rather
      // than presenting a speculative one indefinitely.
      this.commit(performance.envelope);
    }, DURABLE_GRACE_MS);
    this.startNextQueued();
    this.refresh();
  }

  /**
   * The durable value for an operation has landed. Clears the speculation and
   * releases presence; committed work is ordinary content and leaves no mark.
   */
  commit(envelope: AiOperationEnvelope): void {
    const performance = this.performances.get(envelope.operationId);
    if (performance) this.teardown(performance, "completed");

    this.startNextQueued();
    this.refresh();
  }

  /** Confirm a durable value by path, e.g. when a Yjs update is observed. */
  confirmDurable(path: string): void {
    const canonical = canonicalPath(path);
    for (const performance of [...this.performances.values()]) {
      if (performance.status !== "committing") continue;
      if (canonicalPath(performance.envelope.path) !== canonical) continue;
      this.commit(performance.envelope);
    }
  }

  /**
   * Reverse one unfinished operation. Only this operation's preview is discarded;
   * completed work is untouched and is never replayed to recover.
   */
  fail(operationId: string, reason?: string): void {
    const performance = this.performances.get(operationId);
    if (!performance) return;
    performance.note = reason ?? "Could not finish this change";
    this.teardown(performance, "failed");
    this.startNextQueued();
    this.refresh();
  }

  cancel(operationId?: string): void {
    const targets = operationId
      ? [this.performances.get(operationId)].filter(Boolean)
      : [...this.performances.values()];
    for (const performance of targets as Performance[]) {
      this.teardown(performance, "cancelled");
    }
    this.refresh();
  }

  /** Region contention: hold the performance and say so, rather than overwriting. */
  block(operationId: string, reason: string): void {
    const performance = this.performances.get(operationId);
    if (!performance) return;
    this.clearTimers(performance);
    performance.status = "blocked";
    performance.note = reason;
    this.emitPresence(performance, "blocked", reason);
    this.refresh();
  }

  pause(operationId: string, reason: string): void {
    const performance = this.performances.get(operationId);
    if (!performance) return;
    this.clearTimers(performance);
    performance.status = "paused";
    performance.note = reason;
    this.emitPresence(performance, "paused", reason);
    this.refresh();
  }

  /** Resume a blocked or paused performance from where it stopped. */
  resume(operationId: string): void {
    const performance = this.performances.get(operationId);
    if (!performance) return;
    if (performance.status !== "blocked" && performance.status !== "paused")
      return;
    performance.status = "performing";
    this.advance(performance);
    this.refresh();
  }

  /**
   * Catch-up materialisation for an artifact opened midway or after completion.
   * Jumps each operation to its final frame so the change appears immediately
   * with attribution, instead of replaying the whole performance slowly.
   */
  materialize(envelopes: readonly AiOperationEnvelope[]): void {
    for (const envelope of envelopes) this.commit(envelope);
  }

  /**
   * Hand the body to the next waiting operation.
   *
   * The choice is the route's, not the model's: whichever queued control comes
   * next in the artifact's own reading order goes next, so a burst of
   * operations returned in any order still plays as one coherent pass. Where
   * several operations target the same control, the earliest accepted wins, so
   * provisional values on one control can never interleave into an invalid
   * state.
   */
  private startNextQueued(): void {
    if (this.bodyBusy()) return;
    const queued = [...this.performances.values()].filter(
      (performance) => performance.status === "queued",
    );
    if (!queued.length) return;
    const route = orderPathsByRoute(
      queued.map((performance) => performance.envelope.path),
    );
    let next = queued[0]!;
    let bestRank = Number.POSITIVE_INFINITY;
    for (const performance of queued) {
      const rank = route.indexOf(canonicalPath(performance.envelope.path));
      if (rank !== -1 && rank < bestRank) {
        bestRank = rank;
        next = performance;
      }
    }
    next.status = "performing";
    this.advance(next);
  }

  private clearTimers(performance: Performance): void {
    if (performance.timer !== null) {
      window.clearTimeout(performance.timer);
      performance.timer = null;
    }
    if (performance.graceTimer !== null) {
      window.clearTimeout(performance.graceTimer);
      performance.graceTimer = null;
    }
  }

  private teardown(
    performance: Performance,
    status: AiPerformanceStatus,
  ): void {
    this.clearTimers(performance);
    performance.status = status;
    performance.provisional = undefined;
    this.performances.delete(performance.envelope.operationId);
    // Presence must not survive the work. If nothing else is in flight, clear it.
    if (!this.performances.size) {
      this.publish(null);
    } else {
      const next = [...this.performances.values()].find(
        (candidate) => candidate.status === "performing",
      );
      if (next) this.emitPresence(next, "active");
      else this.publish(null);
    }
  }

  private refresh(): void {
    const speculation = new Map<string, unknown>();
    const operations: AiPerformanceSnapshot["operations"] = [];
    for (const performance of this.performances.values()) {
      if (performance.provisional !== undefined) {
        speculation.set(performance.target.path, performance.provisional);
      }
      operations.push({
        operationId: performance.envelope.operationId,
        target: performance.target,
        status: performance.status,
        note: performance.note,
        progress: performance.plan.frames.length
          ? Math.min(1, performance.frameIndex / performance.plan.frames.length)
          : 1,
      });
    }
    this.snapshot = { speculation, operations };
    for (const listener of this.listeners) listener();
  }

  dispose(): void {
    this.disposed = true;
    for (const performance of this.performances.values())
      this.clearTimers(performance);
    this.performances.clear();
    this.snapshot = EMPTY_SNAPSHOT;
    this.publish(null);
    this.listeners.clear();
  }
}

function isEnvelope(value: unknown): value is AiOperationEnvelope {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    typeof (value as AiOperationEnvelope).operationId === "string" &&
    typeof (value as AiOperationEnvelope).path === "string" &&
    typeof (value as AiOperationEnvelope).action === "string"
  );
}
