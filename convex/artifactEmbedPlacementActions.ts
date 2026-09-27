"use node";

import { createHash } from "node:crypto";
import * as Y from "yjs";
import { v } from "convex/values";
import { makeFunctionReference, type FunctionReturnType } from "convex/server";
import { action, type ActionCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import type { loadHead, loadRoomPage } from "./artifactEmbedPlacement";
import type { getMeta } from "./collaborationDurablePayload";
import { isDurableContentRef, MAX_DURABLE_PAYLOAD_BYTES } from "../shared/durable-content";
import { containsPinnedArtifactPlacement } from "../shared/artifact-embed-placement";
import { artifactProjection } from "../scripts/collaboration-artifact-projection.mjs";
import { encodeDurableFrontier } from "../shared/collaboration-durable-frontier.mjs";

const headQuery = makeFunctionReference<"query", { embedId: Id<"artifactEmbeds"> }, FunctionReturnType<typeof loadHead>>("artifactEmbedPlacement:loadHead");
const pageQuery = makeFunctionReference<"query", { embedId: Id<"artifactEmbeds">; headHash: string; afterSequence?: number }, FunctionReturnType<typeof loadRoomPage>>("artifactEmbedPlacement:loadRoomPage");
const payloadQuery = makeFunctionReference<"query", { payloadRef: string; digest: string }, FunctionReturnType<typeof getMeta>>("collaborationDurablePayload:getMeta");
const recordMutation = makeFunctionReference<"mutation", { embedId: Id<"artifactEmbeds">; headHash: string }, boolean>("artifactEmbedPlacement:recordProof");

type Head = NonNullable<FunctionReturnType<typeof loadHead>>;
type StoredUpdate = { update: ArrayBuffer; byteLength: number; payloadRef: string | null; payloadDigest: string | null };
type ProofResult = { status: "proven" | "unavailable" | "stale" | "needs_checkpoint"; headHash?: string };

/** Per-payload capacity matches the existing product bound. Long uncompacted
 * logs can recover through the existing covering-snapshot/checkpoint path. */
const MAX_REPLAY_BYTES = MAX_DURABLE_PAYLOAD_BYTES * 2;
const MAX_REPLAY_MS = 45_000;

async function payloadBytes(ctx: ActionCtx, artifactId: string, ref: string, digest: string,
  byteLength: number, kind: "projection" | "yjs-snapshot" | "yjs-update") {
  if (!Number.isSafeInteger(byteLength) || byteLength <= 0 || byteLength > MAX_DURABLE_PAYLOAD_BYTES)
    throw new Error("PLACEMENT_PAYLOAD_INVALID");
  const meta = await ctx.runQuery(payloadQuery, { payloadRef: ref, digest });
  if (!meta || meta.artifactId !== artifactId || meta.kind !== kind || meta.byteLength !== byteLength || meta.digest !== digest)
    throw new Error("PLACEMENT_PAYLOAD_INVALID");
  const blob = await ctx.storage.get(meta.storageId);
  if (!blob || blob.size !== byteLength) throw new Error("PLACEMENT_PAYLOAD_MISSING");
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (createHash("sha256").update(bytes).digest("hex") !== digest) throw new Error("PLACEMENT_PAYLOAD_CORRUPT");
  return bytes;
}

async function updateBytes(ctx: ActionCtx, head: Head, entry: StoredUpdate, kind: "yjs-snapshot" | "yjs-update") {
  if (entry.payloadRef || entry.payloadDigest) {
    if (!entry.payloadRef || !entry.payloadDigest || entry.update.byteLength !== 0) throw new Error("PLACEMENT_UPDATE_INVALID");
    return payloadBytes(ctx, head.target.containerId, entry.payloadRef, entry.payloadDigest, entry.byteLength, kind);
  }
  if (entry.update.byteLength !== entry.byteLength || entry.byteLength <= 0) throw new Error("PLACEMENT_UPDATE_INVALID");
  return new Uint8Array(entry.update);
}

async function materializeRoom(ctx: ActionCtx, embedId: Id<"artifactEmbeds">, head: Head) {
  if (!head.room) return { status: "unavailable" as const };
  const document = new Y.Doc();
  let afterSequence: number | undefined;
  let bytesRead = 0;
  const startedAt = Date.now();
  let expectedVector: string | undefined;
  try {
    // Each query is a keyset page bounded by row count and bytes. The fixed
    // head and strict sequence checks make continuation finite and complete.
    while (true) {
      if (Date.now() - startedAt >= MAX_REPLAY_MS) return { status: "needs_checkpoint" as const };
      const page = await ctx.runQuery(pageQuery, { embedId, headHash: head.headHash, afterSequence });
      if (!page || page.roomId !== head.room._id || page.nextSequence !== head.room.nextSequence)
        return { status: "stale" as const };
      if (afterSequence === undefined) {
        afterSequence = page.afterSequence;
        if (page.snapshot) {
          bytesRead += page.snapshot.byteLength;
          if (bytesRead > MAX_REPLAY_BYTES) return { status: "needs_checkpoint" as const };
          const bytes = await updateBytes(ctx, head, page.snapshot, "yjs-snapshot");
          if (createHash("sha256").update(bytes).digest("base64url") !== page.snapshot.contentHash)
            throw new Error("PLACEMENT_SNAPSHOT_CORRUPT");
          Y.applyUpdate(document, bytes);
          const vector = Y.encodeStateVector(document);
          const expected = new Uint8Array(page.snapshot.stateVector);
          if (vector.byteLength !== expected.byteLength || vector.some((value, index) => value !== expected[index]))
            throw new Error("PLACEMENT_SNAPSHOT_CORRUPT");
          expectedVector = createHash("sha256").update(expected).digest("base64url");
        }
      }
      for (const update of page.updates) {
        if (update.sequence !== afterSequence + 1) return { status: "needs_checkpoint" as const };
        bytesRead += update.byteLength;
        if (bytesRead > MAX_REPLAY_BYTES || Date.now() - startedAt >= MAX_REPLAY_MS)
          return { status: "needs_checkpoint" as const };
        Y.applyUpdate(document, await updateBytes(ctx, head, update, "yjs-update"));
        afterSequence = update.sequence;
        expectedVector = update.stateVectorHash;
      }
      if (afterSequence === head.room.nextSequence - 1) break;
      if (page.updates.length === 0) return { status: "needs_checkpoint" as const };
    }
    // Matching clocks do not cover unresolved structs or pending deletes.
    // Missing dependencies must recover before any observed node proves access.
    if (!encodeDurableFrontier(Y, document)) return { status: "needs_checkpoint" as const };
    if (!expectedVector || createHash("sha256").update(Y.encodeStateVector(document)).digest("base64url") !== expectedVector)
      throw new Error("PLACEMENT_ROOM_INCOMPLETE");
    const json = artifactProjection(document, head.room.schemaVersion);
    if (!json || Buffer.byteLength(json) > MAX_DURABLE_PAYLOAD_BYTES) return { status: "needs_checkpoint" as const };
    const projection = JSON.parse(json);
    if (projection.typeKey !== head.typeKey) throw new Error("PLACEMENT_ROOM_TYPE_MISMATCH");
    return { status: "materialized" as const, content: projection.content };
  } finally { document.destroy(); }
}

/** No caller-authored content or receipt is accepted. The result describes
 * placement evidence, never source access; source authority is checked afresh
 * by the retained-pin evaluator that consumes the resulting proof. */
export const refresh = action({
  args: { embedId: v.id("artifactEmbeds") },
  handler: async (ctx, args): Promise<ProofResult> => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const head = await ctx.runQuery(headQuery, args);
      if (!head) return { status: "unavailable" };
      if (head.proven) return { status: "proven", headHash: head.headHash };
      let content = head.content;
      try {
        if (!head.projectionCurrent) {
          const result = await materializeRoom(ctx, args.embedId, head);
          if (result.status === "stale") continue;
          if (result.status !== "materialized") return { status: result.status, headHash: head.headHash };
          content = result.content;
        } else if (isDurableContentRef(content)) {
          const ref = content.spectraContentRef;
          const bytes = await payloadBytes(ctx, head.target.containerId, ref.payloadRef, ref.digest, ref.byteLength, "projection");
          const body = JSON.parse(new TextDecoder().decode(bytes));
          content = ref.path === "content" ? body.content : body;
        }
        if (!containsPinnedArtifactPlacement(head.typeKey, content, head.target))
          return { status: "unavailable", headHash: head.headHash };
      } catch {
        return { status: "unavailable", headHash: head.headHash };
      }
      if (await ctx.runMutation(recordMutation, { embedId: args.embedId, headHash: head.headHash }))
        return { status: "proven", headHash: head.headHash };
    }
    return { status: "stale" };
  },
});
