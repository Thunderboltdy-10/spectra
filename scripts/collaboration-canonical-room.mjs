import * as Y from "yjs";
import { createHash } from "node:crypto";
import { applyStoredRoomUpdates } from "./collaboration-room-state.mjs";
import { encodeDurableFrontier } from "../shared/collaboration-durable-frontier.mjs";

export const stateVectorHash = document => createHash("sha256")
  .update(Y.encodeStateVector(document)).digest("base64url");

export const durableFrontierHash = document => {
  const frontier = encodeDurableFrontier(Y, document);
  return frontier ? createHash("sha256").update(frontier).digest("hex") : null;
};

/** A separate committed replica: speculative live edits never become its base. */
export function createCanonicalRoom({ load, expectedRoomId }) {
  let stored = null;
  let document = null;
  let tail = Promise.resolve();
  const nativeRegions = new Map();
  let historyFloor = 0;
  function invalidate() {
    document?.destroy();
    document = null;
    stored = null;
  }
  async function refresh() {
    let latest;
    try {
      latest = await load(stored ? stored.nextSequence - 1 : 0);
    } catch (error) {
      // A verified snapshot may replace tail rows between reads. Restart from
      // that snapshot, never infer missing causal state from a head hash.
      if (!stored || !String(error).includes("COLLABORATION_REPLAY_GENERATION_CHANGED")) throw error;
      latest = await load(0);
      invalidate();
    }
    if (!latest || latest.roomId !== expectedRoomId ||
        !Number.isSafeInteger(latest.nextSequence) || latest.nextSequence < 1 ||
        (stored && latest.nextSequence < stored.nextSequence)) {
      invalidate();
      throw new Error("COLLABORATION_REPLAY_GENERATION_CHANGED");
    }
    if (!document) document = applyStoredRoomUpdates(Y, latest);
    else for (const item of latest.updates ?? []) {
      Y.applyUpdate(document, typeof item.update === "string"
        ? Uint8Array.from(Buffer.from(item.update, "base64")) : item.update);
    }
    stored = latest;
    historyFloor = Math.max(historyFloor, latest.snapshot?.throughSequence ?? 0);
    for (const entry of latest.updates ?? []) if (entry.nativeReconciliationOperationId) {
      for (const regionId of entry.regionIds ?? []) nativeRegions.set(regionId, {
        regionId, sequence: entry.sequence, operationId: entry.nativeReconciliationOperationId,
      });
    }
    if (latest.liveStateVectorHash && stateVectorHash(document) !== latest.liveStateVectorHash) {
      invalidate();
      throw new Error("COLLABORATION_REPLAY_HEAD_MISMATCH");
    }
    return { document, stored, nativeRegions, historyFloor };
  }
  return {
    run(work) {
      const next = tail.then(() => work({ refresh, invalidate, commit(sequence) {
        if (!stored || sequence !== stored.nextSequence) throw new Error("COLLABORATION_REPLAY_GENERATION_CHANGED");
        stored = { ...stored, nextSequence: sequence + 1, liveStateVectorHash: stateVectorHash(document) };
      } }));
      tail = next.catch(() => { invalidate(); });
      return next;
    },
    dispose() { return tail.then(invalidate); },
  };
}

/** Delete sets must travel even when both replicas have the same vector. */
export function mergeCanonicalIntoLive(canonical, live) {
  Y.applyUpdate(live, Y.encodeStateAsUpdate(canonical, Y.encodeStateVector(live)), "spectra:durable-catchup");
}

/** Derive every claim about a batch from exactly the state protected by CAS. */
export function prepareCanonicalAppend({ document, stored, update, projection, regions }) {
  const before = projection(document);
  const baseStateVectorHash = stateVectorHash(document);
  Y.applyUpdate(document, update);
  const after = projection(document);
  return {
    expectedRoomId: stored.roomId,
    expectedNextSequence: stored.nextSequence,
    baseStateVectorHash,
    stateVectorHash: stateVectorHash(document),
    frontierHash: durableFrontierHash(document),
    projectionJson: after,
    regionIds: regions(before, after),
  };
}

export function nativeOverlap({ baseSequence, authoredRegions, nativeRegions, historyFloor = 0 }) {
  if (!Number.isSafeInteger(baseSequence)) return null;
  if (baseSequence < historyFloor) return { regionId: "artifact:structure", operationId: null, historyUnavailable: true };
  for (const change of nativeRegions.values()) {
    if (change.sequence < baseSequence) continue;
    if (authoredRegions.includes("artifact:structure") || change.regionId === "artifact:structure" || authoredRegions.includes(change.regionId))
      return change;
  }
  return null;
}
