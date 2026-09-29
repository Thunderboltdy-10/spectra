"use node";

import { internalAction } from "./functions";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import * as Y from "yjs";

export const verify = internalAction({
  args: { snapshotId: v.id("collaborationSnapshots") },
  handler: async (ctx, args): Promise<unknown> => {
    const { snapshot, storageId } = await ctx.runQuery(internal.collaborationSnapshotCandidate.candidate, args);
    const blob = await ctx.storage.get(storageId);
    if (!blob) throw new Error("COLLABORATION_SNAPSHOT_PAYLOAD_MISSING");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const hashBytes = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    const digest = Array.from(hashBytes, byte => byte.toString(16).padStart(2, "0")).join("");
    const hash = btoa(String.fromCharCode(...hashBytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
    const doc = new Y.Doc();
    let valid = false;
    try {
      Y.applyUpdate(doc, bytes);
      const vector = Y.encodeStateVector(doc);
      const expected = new Uint8Array(snapshot.stateVector);
      valid = digest === snapshot.payloadDigest && hash === snapshot.contentHash && bytes.byteLength === snapshot.byteLength &&
        vector.length === expected.length && vector.every((byte, index) => byte === expected[index]);
    } finally { doc.destroy(); }
    return ctx.runMutation(internal.collaboration.verifySnapshot, { ...args, verifiedPayloadDigest: valid ? digest : "invalid" });
  },
});
