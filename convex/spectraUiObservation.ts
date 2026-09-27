import type { Infer } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { applicationOperationScope, applicationWriteReceipt } from "./spectraApplicationWriteScope";
import { normalizeAiPreferencePatch } from "../src/features/spectra/settings/schema/preferences";
import { SMART_COMPLETION_TARGET, smartCompletionValue, documentParagraphTargetSchema } from "../src/features/spectra/actions/protocol/semantic-action";
import { artifactOperationDigest, artifactOperationTarget, artifactSourceIdentity, artifactWriteReceipt } from "./spectraArtifactWriteScope";
import { getActorForAccountId } from "./identityShared";
import { requireActorArtifactCapability } from "./authorityShared";
import { createRunItem } from "../src/features/spectra/actions/protocol/run-item";
import type { vDocumentParagraphTarget, vUiObservationFence, vUiObserverInterest, vUiObserverInterests } from "./spectraUiObservationSchema";

export const UI_OBSERVATION_DEADLINE_MS = 15_000;
export const MAX_UI_OBSERVERS = 8;
type Run = Doc<"spectraAiRuns">;
type Operation = Doc<"spectraOperations">;
type Observation = NonNullable<Operation["uiObservation"]>;
type Interest = Infer<typeof vUiObserverInterest>;
type Fence = Infer<typeof vUiObservationFence>;
type ParagraphTarget = Infer<typeof vDocumentParagraphTarget>;

export function uiObservationReceipt(operation: Operation) {
  const receipt = operation.type === "app.command" ? applicationWriteReceipt(operation.output) : artifactWriteReceipt(operation.output);
  if (receipt && operation.uiObservation && operation.type !== "app.command" && receipt.scope !== operation.uiObservation.operationDigest)
    throw new Error("UI_OBSERVATION_STALE");
  return receipt;
}

/** Observation never grants artifact rights or a write permit. Reuse the
 * operation's resolved target and current capability at every request. */
export async function assertArtifactObservationTarget(ctx: QueryCtx | MutationCtx, run: Run, operation: Operation, target: ParagraphTarget, checkBase = false) {
  documentParagraphTargetSchema.parse(target);
  if (operation.type !== "artifact.update" || await artifactOperationTarget(ctx, operation) !== target.artifactId)
    throw new Error("UI_OBSERVATION_TARGET_MISMATCH");
  const actor = await getActorForAccountId(ctx, run.ownerAccountId);
  if (!actor) throw new Error("UI_OBSERVATION_STALE");
  const access = await requireActorArtifactCapability(ctx, actor, target.artifactId, "modify");
  const artifact = access.loaded!.resource as Doc<"spectraArtifacts">;
  if (artifact.blueprintKey !== "document") throw new Error("UI_OBSERVATION_UNSUPPORTED");
  if (checkBase) {
    const room = await ctx.db.get(target.baseRevision.roomId);
    if (!room || room.artifactId !== artifact._id || room.nextSequence !== target.baseRevision.nextSequence ||
      await artifactSourceIdentity(artifact) !== target.baseRevision.sourceContentIdentity)
      throw new Error("UI_OBSERVATION_BASE_STALE");
  }
}

/** Invoke again in the canonical/native admission transaction, after receipt
 * replay and before the first effect. Omitting a stored fence cannot bypass it. */
export async function assertArtifactUiObservationFence(ctx: MutationCtx, run: Run, operation: Operation, fence: Fence | undefined, now: number) {
  await assertUiObservationFence(operation, fence, now);
  const target = operation.uiObservation?.target;
  if (target && typeof target !== "string") await assertArtifactObservationTarget(ctx, run, operation, target, true);
}

export function mergeUiObserverInterest(run: Run, executionId: string, interest: Interest | { clientId: string; mode: "released" }): Infer<typeof vUiObserverInterests> {
  if (!interest.clientId.trim() || interest.clientId.length > 120) throw new Error("UI_OBSERVER_ID_INVALID");
  const clients = (run.uiObserverInterests?.executionId === executionId ? run.uiObserverInterests.clients : [])
    .filter((entry) => entry.clientId !== interest.clientId);
  if (interest.mode !== "released") {
    if (clients.length >= MAX_UI_OBSERVERS) {
      const ordinary = clients.findIndex((entry) => entry.mode === "ordinary");
      if (interest.mode === "ordinary") return { executionId, clients: run.uiObserverInterests?.clients ?? clients };
      if (ordinary < 0) throw new Error("UI_OBSERVER_CAPACITY");
      clients.splice(ordinary, 1);
    }
    clients.push({ clientId: interest.clientId, mode: interest.mode });
  }
  return { executionId, clients };
}

export function observedSettingsValue(operation: Pick<Operation, "type" | "input">): boolean | undefined {
  if (operation.type !== "app.command") return;
  const input = operation.input as { command?: unknown; args?: { patch?: unknown } } | null;
  if (input?.command !== "change_spectra_settings") return;
  return smartCompletionValue(normalizeAiPreferencePatch(input.args?.patch));
}

export async function observationDigest(operation: Operation): Promise<string> {
  if (operation.type !== "app.command") return artifactOperationDigest(operation);
  const bytes = new TextEncoder().encode(applicationOperationScope(operation));
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Called by the sole application writer AFTER receipt replay and ownership.
 * Omission cannot bypass a stored observation. Readiness adds no authority. */
export async function assertUiObservationFence(operation: Operation, fence: Fence | undefined, now: number): Promise<void> {
  const observation = operation.uiObservation;
  if (!observation) {
    if (fence) throw new Error("UI_OBSERVATION_STALE");
    return;
  }
  if (!fence || fence.epoch !== observation.epoch || fence.sequence !== observation.sequence ||
    fence.operationDigest !== observation.operationDigest ||
    observation.operationDigest !== await observationDigest(operation) ||
    observation.phase === "waiting" || (observation.phase === "sealed" && observation.expiresAt <= now))
    throw new Error("UI_OBSERVATION_STALE");
}

export function uiObservationSnapshot(run: Run, operation: Operation) {
  const observation = operation.uiObservation;
  const receipt = uiObservationReceipt(operation);
  if (receipt) {
    if (operation.type === "app.command" && receipt.scope !== applicationOperationScope(operation)) throw new Error("AI_APPLICATION_RECEIPT_SCOPE_MISMATCH");
    return { phase: "committed" as const, result: receipt.result };
  }
  if (!observation) return { phase: "headless" as const };
  return {
    phase: observation.phase,
    action: {
      runId: String(run._id), executionId: operation.executionId!, operationId: String(operation._id),
      operationDigest: observation.operationDigest, epoch: observation.epoch, sequence: observation.sequence,
      ...(typeof observation.target === "string"
        ? { kind: "settings_toggle" as const, target: observation.target, checked: observedSettingsValue(operation)! }
        : { kind: "artifact_paragraph" as const, target: observation.target }),
      expiresAt: observation.expiresAt,
    },
    ...(observation.ownerClientId ? { ownerClientId: observation.ownerClientId } : {}),
    participants: observation.participants,
  };
}

async function appendObservationEvent(ctx: MutationCtx, run: Run, operation: Operation, key: string, payload: Record<string, unknown>) {
  // Point read sees earlier event appends made in this transaction. Never reuse
  // a stale run.eventSequence when expiration and a new offer share a mutation.
  const current = await ctx.db.get(run._id);
  if (!current || current.executionId !== operation.executionId) throw new Error("UI_OBSERVATION_STALE");
  const sequence = (current.eventSequence ?? 0) + 1;
  const now = Date.now();
  const runItem = createRunItem(String(run._id), sequence, key.endsWith("_prepared")
    ? { type: "action_start", action: payload }
    : { type: "action_progress", actionId: String(operation._id), step: payload }, now);
  await ctx.db.insert("spectraRunEvents", {
    runId: run._id, executionId: operation.executionId, sequence, type: "ui_event", createdAt: now,
    payload: { type: "ui_event", runId: String(run._id), key, payload, protocolVersion: runItem.protocolVersion, runItem },
  });
  await ctx.db.patch(run._id, { eventSequence: sequence });
}

function sealIfReady(observation: Observation): Observation {
  const following = observation.participants.filter((entry) => entry.mode === "follow" && entry.outcome !== "released");
  if (following.some((entry) => entry.outcome !== "target_ready")) return observation;
  const ready = following[0] ?? observation.participants.find((entry) => entry.outcome === "target_ready");
  if (ready) return { ...observation, phase: "sealed", ownerClientId: ready.clientId };
  if (observation.participants.some((entry) => entry.outcome === undefined)) return observation;
  return { ...observation, phase: "headless", ownerClientId: undefined };
}

/** Actual Follow transitions may join the current unsealed boundary. Its
 * absolute deadline never moves; a sealed action is immutable to newcomers. */
export async function changeUiObservationInterest(ctx: MutationCtx, run: Run, operation: Operation, interest: Interest | { clientId: string; mode: "released" }) {
  const observation = operation.uiObservation;
  if (!observation || observation.phase !== "waiting" || observation.expiresAt <= Date.now() || uiObservationReceipt(operation))
    return uiObservationSnapshot(run, operation);
  const existing = observation.participants.find((entry) => entry.clientId === interest.clientId);
  if (interest.mode === "released" && existing) {
    const next = sealIfReady({ ...observation, participants: observation.participants.map((entry) =>
      entry.clientId === interest.clientId ? { ...entry, outcome: "released" } : entry,
    ) });
    await ctx.db.patch(operation._id, { uiObservation: next });
    await appendObservationEvent(ctx, run, operation, "settings_observer_ended", {
      operationId: String(operation._id), executionId: operation.executionId, epoch: observation.epoch,
      clientIds: [interest.clientId], reason: "Follow AI ended for this action. The task continues.",
    });
    return uiObservationSnapshot(run, { ...operation, uiObservation: next });
  }
  if (interest.mode !== "follow" || existing) return uiObservationSnapshot(run, operation);
  if (observation.participants.length >= MAX_UI_OBSERVERS) throw new Error("UI_OBSERVER_CAPACITY");
  const next = { ...observation, participants: [...observation.participants, interest] };
  await ctx.db.patch(operation._id, { uiObservation: next });
  const snapshot = uiObservationSnapshot(run, { ...operation, uiObservation: next });
  await appendObservationEvent(ctx, run, operation, typeof next.target === "string" ? "settings_toggle_prepared" : "artifact_paragraph_prepared", snapshot);
  return snapshot;
}

export async function expireUiObservation(ctx: MutationCtx, run: Run, operation: Operation, now: number) {
  const observation = operation.uiObservation;
  if (!observation || observation.phase === "headless" || observation.expiresAt > now || uiObservationReceipt(operation)) return operation;
  const clientIds = observation.participants.map((entry) => entry.clientId);
  const next: Observation = { ...observation, epoch: observation.epoch + 1, phase: "headless", ownerClientId: undefined, participants: [] };
  await ctx.db.patch(operation._id, { uiObservation: next });
  // A dead tab cannot impose the same wait on the next operation.
  const current = await ctx.db.get(run._id);
  if (current?.uiObserverInterests?.executionId === operation.executionId)
    await ctx.db.patch(run._id, { uiObserverInterests: {
      executionId: operation.executionId!, clients: current.uiObserverInterests.clients.filter((entry) => !clientIds.includes(entry.clientId)),
    } });
  await appendObservationEvent(ctx, run, operation, "settings_observer_ended", {
    operationId: String(operation._id), executionId: operation.executionId, epoch: observation.epoch,
    clientIds, reason: "The control could not stay ready. Follow AI ended; the approved task continues.",
  });
  return { ...operation, uiObservation: next };
}

export async function prepareUiObservation(ctx: MutationCtx, run: Run, operation: Operation, paragraph?: ParagraphTarget) {
  if (uiObservationReceipt(operation)) return uiObservationSnapshot(run, operation);
  if (paragraph) await assertArtifactObservationTarget(ctx, run, operation, paragraph, true);
  else if (observedSettingsValue(operation) === undefined) throw new Error("UI_OBSERVATION_UNSUPPORTED");
  if (operation.uiObservation) {
    if (operation.uiObservation.operationDigest !== await observationDigest(operation)) throw new Error("UI_OBSERVATION_STALE");
    if (JSON.stringify(operation.uiObservation.target) !== JSON.stringify(paragraph ?? SMART_COMPLETION_TARGET))
      throw new Error("UI_OBSERVATION_TARGET_MISMATCH");
    const current = await expireUiObservation(ctx, run, operation, Date.now());
    return uiObservationSnapshot(run, current);
  }
  const interests = run.uiObserverInterests?.executionId === operation.executionId ? run.uiObserverInterests.clients : [];
  if (!interests.length) return { phase: "headless" as const };
  const followers = interests.filter((entry) => entry.mode === "follow");
  // Ordinary observers never form a global barrier. One owns the control;
  // explicit Follow participants observe the same single canonical effect.
  const participants = followers.length ? followers : interests.slice(-1);
  const observation: Observation = {
    version: 1, epoch: 1, sequence: 0, operationDigest: await observationDigest(operation),
    target: paragraph ?? SMART_COMPLETION_TARGET, phase: "waiting", expiresAt: Date.now() + UI_OBSERVATION_DEADLINE_MS,
    ownerClientId: participants[0]?.clientId, participants,
  };
  await ctx.db.patch(operation._id, { uiObservation: observation });
  const snapshot = uiObservationSnapshot(run, { ...operation, uiObservation: observation });
  await appendObservationEvent(ctx, run, operation, paragraph ? "artifact_paragraph_prepared" : "settings_toggle_prepared", snapshot);
  return snapshot;
}

export async function notifyArtifactObservationCommitted(ctx: MutationCtx, run: Run, operation: Operation) {
  const observation = operation.uiObservation;
  const snapshot = uiObservationSnapshot(run, operation);
  if (snapshot.phase !== "committed") throw new Error("UI_OBSERVATION_RECEIPT_REQUIRED");
  if (observation && typeof observation.target !== "string") await appendObservationEvent(ctx, run, operation, "artifact_paragraph_committed", {
    runId: String(run._id), executionId: operation.executionId, operationId: String(operation._id),
    operationDigest: observation.operationDigest, epoch: observation.epoch, sequence: observation.sequence,
  });
  return snapshot;
}

export async function acknowledgeUiObservation(ctx: MutationCtx, run: Run, operation: Operation, args: Fence & {
  clientId: string; mode: "ordinary" | "follow"; outcome: "target_ready" | "invisible" | "released";
}) {
  if (uiObservationReceipt(operation)) return uiObservationSnapshot(run, operation);
  const observation = operation.uiObservation;
  if (!observation || observation.epoch !== args.epoch || observation.sequence !== args.sequence ||
    observation.operationDigest !== args.operationDigest || observation.operationDigest !== await observationDigest(operation))
    throw new Error("UI_OBSERVATION_STALE");
  if (observation.expiresAt <= Date.now()) return uiObservationSnapshot(run, await expireUiObservation(ctx, run, operation, Date.now()));
  const participant = observation.participants.find((entry) => entry.clientId === args.clientId);
  if (!participant) throw new Error("UI_OBSERVER_NOT_PARTICIPATING");
  if (args.outcome !== "released" && args.mode !== participant.mode) throw new Error("UI_OBSERVER_MODE_MISMATCH");
  if (args.mode === "follow" && args.outcome === "invisible") throw new Error("UI_FOLLOW_REQUIRES_VISIBLE_TARGET");
  if (observation.phase !== "waiting") return uiObservationSnapshot(run, operation);
  if (participant.outcome !== undefined) {
    if (participant.outcome !== args.outcome || participant.mode !== args.mode) throw new Error("UI_OBSERVATION_ACK_CONFLICT");
    return uiObservationSnapshot(run, operation);
  }
  const next = sealIfReady({ ...observation, participants: observation.participants.map((entry) =>
    entry.clientId === args.clientId ? { ...entry, outcome: args.outcome } : entry,
  ) });
  await ctx.db.patch(operation._id, { uiObservation: next });
  if (args.outcome === "released") {
    await ctx.db.patch(run._id, { uiObserverInterests: mergeUiObserverInterest(run, operation.executionId!, { clientId: args.clientId, mode: "released" }) });
    await appendObservationEvent(ctx, run, operation, "settings_observer_ended", {
      operationId: String(operation._id), executionId: operation.executionId, epoch: observation.epoch,
      clientIds: [args.clientId], reason: "Follow AI ended because the control is unavailable. The approved task continues.",
    });
  }
  return uiObservationSnapshot(run, { ...operation, uiObservation: next });
}
