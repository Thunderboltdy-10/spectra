import { describe, expect, it, vi } from "vitest";
import type { Id } from "../../../../convex/_generated/dataModel";
import { isNativeContentRegion, linkedOfficeKind, promoteNativeAiContent, type NativeMaterializeResult,
  type NativePromotionDeps } from "../ai/native-ai-promotion";
import type { AiBeforeCommitInfo, AdmittedAiCommit, PreparedCanonicalAiUpdate } from "../ai/admitted-ai-update";
import { nativeAiRequestDigest } from "../../../../shared/native-ai-commit";

vi.mock("@/app/api/spectra/lenses/docx/route", () => ({ materializeDocxArtifact: vi.fn() }));
vi.mock("@/app/api/spectra/lenses/office/route", () => ({ materializeOfficeArtifact: vi.fn() }));
vi.mock("@/lib/native-ai-commit-server", () => ({ commitPreparedNativeAiRequest: vi.fn() }));
const aiOperation = { runId: "run-native", executionId: "execution-native", operationId: "op-native" };
const workId = "work-native" as Id<"spectraArtifacts">;
const hash = "a".repeat(64);
function fixture() {
  const desired = { title: "Keep title", tags: [], content: { text: "draft" } };
  const canonical: PreparedCanonicalAiUpdate = {
    expected: { roomId: "room" as Id<"collaborationRooms">, nextSequence: 4, artifactUpdatedAt: 30, contentHash: null, currentVersionId: null },
    beforeProjectionJson: "{}", beforeProjectionHash: hash,
    append: { artifactId: workId, accountId: "account" as Id<"accounts">, partitionKey: "root", actorKind: "ai",
      update: "AQ==", clientId: "client", policyVersion: 1, idempotencyKey: "operation", expectedRoomId: "room" as Id<"collaborationRooms">,
      expectedNextSequence: 4, baseStateVectorHash: hash, stateVectorHash: hash, regionIds: ["body"], projectionJson: "{}", projectionHash: hash },
    evidence: { version: 1, operationDigest: hash, sourceContentIdentity: hash, baseContentDigest: hash, resultContentDigest: hash, fullContentDeletion: false },
  };
  const prepared: NativeMaterializeResult = {
    state: "prepared", hash, projectionContent: { text: "actual native readback" },
    nativeSource: { replicaId: "source", payloadRef: "payload", hash, revision: hash, bytes: 100, nativeFormat: "docx" },
    nativeCandidate: { destination: "none", unchanged: { sourcePayloadRef: "payload", resultPayloadRef: "payload", sourceHash: hash, resultHash: hash,
      readbackProjectionHash: hash, preservationEvidence: { kind: "native-office-save", format: "docx", operationId: "native-op", artifactId: workId,
        basePayloadHash: hash, resultPayloadHash: hash, baseRevision: hash, resultRevision: hash, targets: { regionIds: [], partNames: [] },
        semantic: { resultDigest: hash, readbackDigest: hash }, preservedPartNames: [], state: "unchanged" } } },
  };
  const admitted: AdmittedAiCommit = { state: "committed", duplicate: false,
    receipt: { roomId: "room", sequence: 4, updateDigest: hash, nativeResult: { state: "pending" } },
    admitted: { encoding: "inline", updateBase64: "AQ==" } };
  const commit: AiBeforeCommitInfo = { desired, changedRegionIds: ["docx:paragraph:body"], prepareAdmittedUpdate: vi.fn(async () => canonical) };
  const deps = { materializeDocx: vi.fn<NonNullable<NativePromotionDeps["materializeDocx"]>>(async () => prepared),
    materializeOffice: vi.fn<NonNullable<NativePromotionDeps["materializeOffice"]>>(async () => prepared),
    commit: vi.fn<NonNullable<NativePromotionDeps["commit"]>>(async () => admitted) };
  return { args: { workId, blueprintKey: "document", nativeFormat: "docx", aiOperation, commit, deps }, prepared, canonical, admitted, commit, deps };
}

describe("native AI atomic admission", () => {
  it("prepares verified bytes, builds from readback, then admits exactly once", async () => {
    const f = fixture(), order: string[] = [];
    f.deps.materializeDocx.mockImplementation(async (_id, content, options) => {
      order.push("native-readback"); expect(content).toEqual({ text: "draft" });
      expect(options).toEqual({ prepareOnly: true, aiOperation }); return f.prepared;
    });
    f.commit.prepareAdmittedUpdate = vi.fn(async value => {
      order.push("final-delta"); expect(value).toEqual({ title: "Keep title", tags: [], content: f.prepared.projectionContent }); return f.canonical;
    });
    f.deps.commit.mockImplementation(async request => {
      order.push("atomic-commit"); expect(request.nativeCandidate).toEqual(f.prepared.nativeCandidate);
      expect(request.expected.nativeSource).toEqual(f.prepared.nativeSource); expect(request.aiOperation).toEqual(aiOperation);
      expect(request.requestDigest).toBe(await nativeAiRequestDigest(request)); return f.admitted;
    });
    expect(await promoteNativeAiContent(f.args)).toBe(f.admitted);
    expect(order).toEqual(["native-readback", "final-delta", "atomic-commit"]); expect(f.deps.commit).toHaveBeenCalledTimes(1);
  });
  it.each(["pending", "claimed", "verified", "cloud_saved", "deferred_native", "unchanged", "failed"])(
    "refuses legacy %s results without admitting a canonical write", async state => {
      const f = fixture(); f.prepared.state = state;
      await expect(promoteNativeAiContent(f.args)).rejects.toThrow("NATIVE_PROMOTION_NOT_PREPARED");
      expect(f.commit.prepareAdmittedUpdate).not.toHaveBeenCalled(); expect(f.deps.commit).not.toHaveBeenCalled();
    });
  it.each(["conflicted", "protected-pending"])("refuses %s native state", async state => {
    const f = fixture(); f.prepared.state = state;
    await expect(promoteNativeAiContent(f.args)).rejects.toThrow("NATIVE_PROMOTION_"); expect(f.deps.commit).not.toHaveBeenCalled();
  });
  it("requires executor identity and the atomic builder before native I/O", async () => {
    const f = fixture();
    await expect(promoteNativeAiContent({ ...f.args, aiOperation: undefined as never })).rejects.toThrow("IDENTITY_REQUIRED");
    await expect(promoteNativeAiContent({ ...f.args, commit: undefined as never })).rejects.toThrow("ADMISSION_REQUIRED");
    expect(f.deps.materializeDocx).not.toHaveBeenCalled();
  });
  it("propagates canonical contention without retrying normalized desired content", async () => {
    const f = fixture(); f.commit.prepareAdmittedUpdate = vi.fn(async () => { throw new Error("AI_NATIVE_CANONICAL_STALE"); });
    await expect(promoteNativeAiContent(f.args)).rejects.toThrow("AI_NATIVE_CANONICAL_STALE");
    expect(f.deps.materializeDocx).toHaveBeenCalledTimes(1); expect(f.deps.commit).not.toHaveBeenCalled();
  });
  it("passes the original accepted receipt through on a duplicate", async () => {
    const f = fixture(); f.admitted.duplicate = true;
    f.admitted.admitted = { encoding: "replay", roomId: "room", throughSequence: 4 };
    expect(await promoteNativeAiContent(f.args)).toBe(f.admitted);
  });
  it.each(["xlsx", "pptx"])("uses the Office preparer for %s", async nativeFormat => {
    const f = fixture(); expect(await promoteNativeAiContent({ ...f.args, nativeFormat })).toBe(f.admitted);
    expect(f.deps.materializeOffice).toHaveBeenCalledTimes(1); expect(f.deps.materializeDocx).not.toHaveBeenCalled();
  });
  it("rejects a cross-artifact delta before signing", async () => {
    const f = fixture(); f.canonical.append.artifactId = "another-work" as Id<"spectraArtifacts">;
    await expect(promoteNativeAiContent(f.args)).rejects.toThrow("ARTIFACT_MISMATCH"); expect(f.deps.commit).not.toHaveBeenCalled();
  });
  it("classifies native content and Office formats", () => {
    expect(isNativeContentRegion("docx:paragraph:one")).toBe(true); expect(isNativeContentRegion("metadata:title")).toBe(false);
    expect(linkedOfficeKind("DOCX")).toBe("docx"); expect(linkedOfficeKind("pptx")).toBe("office"); expect(linkedOfficeKind("spectra-native")).toBeNull();
  });
});
