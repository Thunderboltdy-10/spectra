"use node";

import { createHash } from "node:crypto";
import * as Y from "yjs";
import { v } from "convex/values";
import { makeFunctionReference, type ApiFromModules, type FunctionReturnType } from "convex/server";
import { internalAction, type ActionCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { MAX_DURABLE_PAYLOAD_BYTES } from "../shared/durable-content";
import { encodeDurableFrontier } from "../shared/collaboration-durable-frontier.mjs";
import { artifactProjection } from "../scripts/collaboration-artifact-projection.mjs";
import { planArtifactYjsMutation } from "../src/features/spectra/collaboration/artifact-yjs-model";
import { preparePlannerProviderValue, type PlannerProviderValue } from "../shared/planner-provider-refresh";

type JobsApi = ApiFromModules<{
  jobs: typeof import("./managebacProjectionJobs");
  payload: typeof import("./collaborationDurablePayload");
}>;
type JobArgs = { projectionId: Id<"externalProjections">; operationId: string };
const headQuery = makeFunctionReference<"query", JobArgs, FunctionReturnType<JobsApi["jobs"]["head"]>>("managebacProjectionJobs:head");
const pageQuery = makeFunctionReference<"query", JobArgs & { roomId: Id<"collaborationRooms">; nextSequence: number; afterSequence?: number },
  FunctionReturnType<JobsApi["jobs"]["roomPage"]>>("managebacProjectionJobs:roomPage");
const payloadQuery = makeFunctionReference<"query", { payloadRef: string; digest: string },
  FunctionReturnType<JobsApi["payload"]["getMeta"]>>("collaborationDurablePayload:getMeta");
const commitMutation = makeFunctionReference<"mutation", Record<string, unknown>, FunctionReturnType<JobsApi["jobs"]["commit"]>>("managebacProjectionJobs:commit");
const failedMutation = makeFunctionReference<"mutation", JobArgs & { error: string }>("managebacProjectionJobs:failed");

type Head = Extract<FunctionReturnType<typeof headQuery>, { status: "ready" }>;
type StoredUpdate = { update: ArrayBuffer; byteLength: number; payloadRef: string | null; payloadDigest: string | null };

/** Same bounds as retained-pin replay. Longer logs recover through the existing
 * covering-snapshot/checkpoint path, then this job retries. */
const MAX_REPLAY_BYTES = MAX_DURABLE_PAYLOAD_BYTES * 2;
const MAX_REPLAY_MS = 45_000;
/** Matches the canonical appender's inline update bound. Provider fields are
 * bounded, so a larger captured update is rejected rather than spilled. */
const MAX_PROVIDER_UPDATE_BYTES = 760 * 1024;
const COMMIT_ATTEMPTS = 3;

const stateVectorHash = (document: Y.Doc) =>
  createHash("sha256").update(Y.encodeStateVector(document)).digest("base64url");

async function payloadBytes(ctx: ActionCtx, artifactId: string, entry: StoredUpdate, kind: "yjs-snapshot" | "yjs-update") {
  if (!entry.payloadRef && !entry.payloadDigest) {
    if (entry.update.byteLength !== entry.byteLength || entry.byteLength <= 0) throw new Error("MANAGEBAC_PROJECTION_ROOM_INVALID");
    return new Uint8Array(entry.update);
  }
  if (!entry.payloadRef || !entry.payloadDigest || entry.update.byteLength !== 0 ||
      !Number.isSafeInteger(entry.byteLength) || entry.byteLength <= 0 || entry.byteLength > MAX_DURABLE_PAYLOAD_BYTES)
    throw new Error("MANAGEBAC_PROJECTION_ROOM_INVALID");
  const meta = await ctx.runQuery(payloadQuery, { payloadRef: entry.payloadRef, digest: entry.payloadDigest });
  if (!meta || meta.artifactId !== artifactId || meta.kind !== kind || meta.byteLength !== entry.byteLength)
    throw new Error("MANAGEBAC_PROJECTION_ROOM_INVALID");
  const blob = await ctx.storage.get(meta.storageId);
  if (!blob || blob.size !== entry.byteLength) throw new Error("MANAGEBAC_PROJECTION_ROOM_UNAVAILABLE");
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (createHash("sha256").update(bytes).digest("hex") !== entry.payloadDigest) throw new Error("MANAGEBAC_PROJECTION_ROOM_INVALID");
  return bytes;
}

/** Complete, verified replay of the current room head, or a retryable status. */
async function replayRoom(ctx: ActionCtx, args: JobArgs, head: Head, room: NonNullable<Head["room"]>, document: Y.Doc) {
  let afterSequence: number | undefined;
  let bytesRead = 0;
  let expectedVector: string | undefined;
  const startedAt = Date.now();
  while (afterSequence === undefined || afterSequence < room.nextSequence - 1) {
    if (Date.now() - startedAt >= MAX_REPLAY_MS) return "needs_checkpoint" as const;
    const page = await ctx.runQuery(pageQuery, { ...args, roomId: room.id, nextSequence: room.nextSequence, afterSequence });
    if (!page) return "stale" as const;
    if (afterSequence === undefined) {
      afterSequence = page.afterSequence;
      if (page.snapshot) {
        bytesRead += page.snapshot.byteLength;
        if (bytesRead > MAX_REPLAY_BYTES) return "needs_checkpoint" as const;
        const bytes = await payloadBytes(ctx, head.artifactId, page.snapshot, "yjs-snapshot");
        if (createHash("sha256").update(bytes).digest("base64url") !== page.snapshot.contentHash)
          throw new Error("MANAGEBAC_PROJECTION_ROOM_INVALID");
        Y.applyUpdate(document, bytes);
        const expected = new Uint8Array(page.snapshot.stateVector);
        const actual = Y.encodeStateVector(document);
        if (actual.byteLength !== expected.byteLength || actual.some((value, index) => value !== expected[index]))
          throw new Error("MANAGEBAC_PROJECTION_ROOM_INVALID");
        expectedVector = createHash("sha256").update(expected).digest("base64url");
      }
    }
    for (const update of page.updates) {
      if (update.sequence !== afterSequence + 1) return "needs_checkpoint" as const;
      bytesRead += update.byteLength;
      if (bytesRead > MAX_REPLAY_BYTES) return "needs_checkpoint" as const;
      Y.applyUpdate(document, await payloadBytes(ctx, head.artifactId, update, "yjs-update"));
      afterSequence = update.sequence;
      expectedVector = update.stateVectorHash;
    }
    if (afterSequence < room.nextSequence - 1 && page.updates.length === 0) return "needs_checkpoint" as const;
  }
  // Matching clocks do not cover unresolved structs or pending deletes.
  if (room.nextSequence > 1 && (!encodeDurableFrontier(Y, document) || stateVectorHash(document) !== expectedVector))
    return "needs_checkpoint" as const;
  return "replayed" as const;
}

function projectionValue(json: string, typeKey: string): PlannerProviderValue {
  const value = JSON.parse(json) as Record<string, unknown>;
  if (value.typeKey !== typeKey) throw new Error("MANAGEBAC_PROJECTION_INVALID");
  return { title: value.title as string, summary: value.summary as string | undefined,
    tags: value.tags as string[], content: value.content };
}

/** Prepare the exact provider update against the replayed canonical room. */
async function prepare(ctx: ActionCtx, args: JobArgs, head: Head, room: NonNullable<Head["room"]>) {
  const document = new Y.Doc();
  try {
    const replay = await replayRoom(ctx, args, head, room, document);
    if (replay !== "replayed") return { status: replay };
    const initialized = document.getMap("spectra:artifact-meta").get("initialized") === true;
    const beforeJson = initialized ? artifactProjection(document, room.schemaVersion) : JSON.stringify({
      title: head.value.title, summary: head.value.summary || undefined, tags: head.value.tags,
      typeKey: "planner_task", schemaVersion: head.schemaVersion, content: head.value.content,
    });
    if (!beforeJson) throw new Error("MANAGEBAC_PROJECTION_INVALID");
    const before = projectionValue(beforeJson, "planner_task");
    const after = preparePlannerProviderValue(before, head.source, head.intent);
    const baseStateVectorHash = stateVectorHash(document);
    const plan = planArtifactYjsMutation(document, "planner_task", after);
    const captured: Uint8Array[] = [];
    const capture = (update: Uint8Array) => captured.push(update);
    document.on("update", capture);
    document.transact(() => plan.apply(), "managebac-provider");
    document.off("update", capture);
    const afterJson = artifactProjection(document, room.schemaVersion);
    if (!afterJson) throw new Error("MANAGEBAC_PROJECTION_INVALID");
    if (captured.length === 0 || plan.regions.length === 0)
      return { status: "prepared" as const, prepared: { beforeJson, afterJson } };
    const update = captured.length === 1 ? captured[0]! : Y.mergeUpdates(captured);
    if (update.byteLength > MAX_PROVIDER_UPDATE_BYTES || Buffer.byteLength(afterJson) > MAX_DURABLE_PAYLOAD_BYTES)
      throw new Error("MANAGEBAC_PROJECTION_TOO_LARGE");
    return {
      status: "prepared" as const,
      prepared: {
        beforeJson, afterJson,
        change: {
          baseStateVectorHash, stateVectorHash: stateVectorHash(document),
          update: update.buffer.slice(update.byteOffset, update.byteOffset + update.byteLength) as ArrayBuffer,
          regionIds: [...new Set(plan.regions.map(region => region.regionId))],
        },
      },
    };
  } finally {
    document.destroy();
  }
}

/** Internal only: scheduled by the admitting mutation for a staged intent. */
export const run = internalAction({
  args: { projectionId: v.id("externalProjections"), operationId: v.string() },
  handler: async (ctx, args) => {
    for (let attempt = 0; attempt < COMMIT_ATTEMPTS; attempt++) {
      const head = await ctx.runQuery(headQuery, args);
      if (head.status === "missing") return { status: "superseded" };
      if (head.status !== "ready") {
        await ctx.runMutation(failedMutation, { ...args, error: "MANAGEBAC_PROJECTION_FORBIDDEN" });
        return { status: "unavailable" };
      }
      try {
        let prepared: Awaited<ReturnType<typeof prepare>> | undefined;
        if (head.room) {
          prepared = await prepare(ctx, args, head, head.room);
          if (prepared.status === "stale") continue;
          if (prepared.status === "needs_checkpoint") throw new Error("MANAGEBAC_PROJECTION_ROOM_UNAVAILABLE");
        }
        return await ctx.runMutation(commitMutation, {
          ...args, artifactDigest: head.artifactDigest, roomId: head.room?.id ?? null,
          nextSequence: head.room?.nextSequence ?? 1,
          ...(prepared?.status === "prepared" ? { prepared: prepared.prepared } : {}),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/MANAGEBAC_PROJECTION_HEAD_STALE|COLLABORATION_BASE_STATE_STALE/.test(message) && attempt < COMMIT_ATTEMPTS - 1) continue;
        await ctx.runMutation(failedMutation, { ...args, error: message.slice(0, 500) });
        return { status: "failed" };
      }
    }
    await ctx.runMutation(failedMutation, { ...args, error: "MANAGEBAC_PROJECTION_HEAD_STALE" });
    return { status: "failed" };
  },
});
