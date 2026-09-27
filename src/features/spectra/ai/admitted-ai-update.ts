import "server-only";
import { createHash } from "node:crypto";
import * as Y from "yjs";
import type { HocuspocusProvider } from "@hocuspocus/provider";
import type { Id } from "../../../../convex/_generated/dataModel";
import type { ArtifactLiveValue } from "../collaboration/artifact-yjs-model";

export type CanonicalPayload =
  | { update: string; payloadRef?: never; payloadDigest?: never; byteLength?: never; payloadManifest?: never }
  | { update: ""; payloadRef: string; payloadDigest: string; byteLength: number; payloadManifest: unknown };

/** Exact final delta, prepared once from the fenced durable base after native
 * readback. Only the trusted Node caller signs this evidence for the sink. */
export type PreparedCanonicalAiUpdate = {
  expected: {
    roomId: Id<"collaborationRooms">;
    nextSequence: number;
    artifactUpdatedAt: number;
    contentHash: string | null;
    currentVersionId: Id<"spectraArtifactVersions"> | null;
  };
  beforeProjectionJson: string;
  beforeProjectionHash: string;
  append: CanonicalPayload & {
    artifactId: Id<"spectraArtifacts">;
    accountId: Id<"accounts">;
    partitionKey: "root";
    actorKind: "ai";
    clientId: string;
    policyVersion: number;
    idempotencyKey: string;
    expectedRoomId: Id<"collaborationRooms">;
    expectedNextSequence: number;
    baseStateVectorHash: string;
    claimBaseStateVectorHash?: string;
    stateVectorHash: string;
    regionIds: string[];
    projectionJson: string;
    projectionHash: string;
  };
  evidence: {
    version: 1;
    operationDigest: string;
    sourceContentIdentity: string;
    baseContentDigest: string;
    resultContentDigest: string;
    fullContentDeletion: boolean;
  };
};

export type AdmittedAiCommit = {
  state: "committed";
  duplicate: boolean;
  receipt: {
    roomId: string;
    sequence: number;
    updateDigest: string;
    versionId?: string;
    nativeResult: unknown;
  };
  admitted:
    | { encoding: "inline"; updateBase64: string }
    | { encoding: "payload"; payloadRef: string; digest: string; byteLength: number }
    | { encoding: "replay"; roomId: string; throughSequence: number };
};

export type AiBeforeCommitInfo = {
  desired: ArtifactLiveValue;
  changedRegionIds: string[];
  prepareAdmittedUpdate: (normalizedDesired: ArtifactLiveValue) => Promise<PreparedCanonicalAiUpdate>;
};
export type AiBeforeCommit = (info: AiBeforeCommitInfo) => Promise<AdmittedAiCommit | void>;

/** The durable sink already authored this update. Hocuspocus recognizes its
 * own origin and does not enqueue the accepted bytes as another local write. */
export function applyAdmittedProviderUpdate(provider: HocuspocusProvider, update: Uint8Array, confirmationId: string) {
  Y.applyUpdate(provider.document, update, provider);
  try {
    provider.sendStateless(JSON.stringify({ type: "spectra.canonical_refresh", confirmationId }));
  } catch {
    // Receipt durability is independent of this latency hint. The gateway's
    // existing policy sweep will catch up a peer whose socket just closed.
  }
}

const MAX_ADMITTED_BYTES = 256 * 1024 * 1024;
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** A lost response consumes its original accepted delta, or a verified current
 * replay covering that receipt. It never consumes the new retry candidate. */
export async function readAdmittedAiUpdate(result: AdmittedAiCommit, readers: {
  payload: (descriptor: Extract<AdmittedAiCommit["admitted"], { encoding: "payload" }>) => Promise<Uint8Array>;
  replay: (descriptor: Extract<AdmittedAiCommit["admitted"], { encoding: "replay" }>) => Promise<{
    roomId: string; throughSequence: number; update: Uint8Array;
  }>;
}): Promise<Uint8Array> {
  if (result.state !== "committed" || !Number.isSafeInteger(result.receipt.sequence) || result.receipt.sequence < 1 ||
      !/^[a-f0-9]{64}$/.test(result.receipt.updateDigest)) throw new Error("AI_ADMITTED_RECEIPT_INVALID");
  const descriptor = result.admitted;
  let update: Uint8Array;
  if (descriptor.encoding === "replay") {
    if (descriptor.roomId !== result.receipt.roomId || !Number.isSafeInteger(descriptor.throughSequence) ||
        descriptor.throughSequence < result.receipt.sequence) throw new Error("AI_ADMITTED_REPLAY_BEHIND_RECEIPT");
    const replay = await readers.replay(descriptor);
    if (replay.roomId !== result.receipt.roomId || !Number.isSafeInteger(replay.throughSequence) ||
        replay.throughSequence < descriptor.throughSequence) throw new Error("AI_ADMITTED_REPLAY_BEHIND_RECEIPT");
    update = replay.update;
  } else if (descriptor.encoding === "inline") {
    if (descriptor.updateBase64.length > Math.ceil(MAX_ADMITTED_BYTES * 4 / 3) ||
        descriptor.updateBase64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(descriptor.updateBase64))
      throw new Error("AI_ADMITTED_UPDATE_INVALID");
    update = Uint8Array.from(Buffer.from(descriptor.updateBase64, "base64"));
  } else if (descriptor.encoding === "payload") {
    if (descriptor.digest !== result.receipt.updateDigest || !Number.isSafeInteger(descriptor.byteLength) ||
        descriptor.byteLength < 1 || descriptor.byteLength > MAX_ADMITTED_BYTES) throw new Error("AI_ADMITTED_UPDATE_INVALID");
    update = await readers.payload(descriptor);
    if (update.byteLength !== descriptor.byteLength) throw new Error("AI_ADMITTED_UPDATE_INVALID");
  } else throw new Error("AI_ADMITTED_UPDATE_INVALID");
  if (!update.byteLength || update.byteLength > MAX_ADMITTED_BYTES ||
      (descriptor.encoding !== "replay" && digest(update) !== result.receipt.updateDigest))
    throw new Error("AI_ADMITTED_UPDATE_INVALID");
  return update;
}
