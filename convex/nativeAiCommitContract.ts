import { v, type ObjectType, type Infer } from "convex/values";
import { appendRoomUpdateArgs } from "./collaborationGatewayStore";
import { queueMaterializationArgs, commitCloudMaterializationArgs } from "./replicaMaterialization";
import { nativeSaveReceiptValidator } from "./nativeOfficeValidators";

/** Source bytes actually opened by the trusted Node materializer. This is a
 * replica binding, not permission to look up arbitrary account-owned bytes. */
export const nativeAiSourceValidator = v.object({
  replicaId: v.id("workReplicas"), payloadRef: v.string(), hash: v.string(),
  revision: v.string(), bytes: v.number(), nativeFormat: v.string(),
});

export const nativeAiCandidateValidator = v.union(
  v.object({ destination: v.literal("bridge"), queue: queueMaterializationArgs }),
  v.object({ destination: v.literal("cloud"), cloud: commitCloudMaterializationArgs }),
  v.object({ destination: v.literal("none"), unchanged: v.object({
    sourcePayloadRef: v.string(), sourceHash: v.string(), resultPayloadRef: v.string(), resultHash: v.string(),
    readbackProjectionHash: v.string(), preservationEvidence: nativeSaveReceiptValidator,
  }) }),
);
export type NativeAiCandidate = Infer<typeof nativeAiCandidateValidator>;

/** Wire append uses base64; the existing signed bridge decodes only that field
 * before applying these mutation validators. Evidence is signed by Node after
 * native readback (or, without a native binding, after fenced live preparation)
 * and is never a browser-authored permission grant. */
export const nativeAiCommitArgs = {
  aiOperation: v.object({ runId: v.id("spectraAiRuns"), executionId: v.string(), operationId: v.id("spectraOperations") }),
  requestDigest: v.string(),
  expected: v.object({
    roomId: v.id("collaborationRooms"), nextSequence: v.number(), artifactUpdatedAt: v.number(),
    contentHash: v.union(v.string(), v.null()), currentVersionId: v.union(v.id("spectraArtifactVersions"), v.null()),
    // Absent together with nativeCandidate for a live artifact that has no
    // native file binding: the same admission, history and receipt apply.
    nativeSource: v.optional(nativeAiSourceValidator),
  }),
  beforeProjectionJson: v.string(), beforeProjectionHash: v.string(),
  append: v.object({ ...appendRoomUpdateArgs, actorKind: v.literal("ai"), partitionKey: v.literal("root"),
    projectionJson: v.string(), projectionHash: v.string() }),
  evidence: v.object({ version: v.literal(1), operationDigest: v.string(), sourceContentIdentity: v.string(),
    baseContentDigest: v.string(), resultContentDigest: v.string(), fullContentDeletion: v.boolean() }),
  nativeCandidate: v.optional(nativeAiCandidateValidator),
};
export type NativeAiCommitArgs = ObjectType<typeof nativeAiCommitArgs>;
