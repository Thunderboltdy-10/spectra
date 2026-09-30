import { beforeEach, describe, expect, it, vi } from "vitest";
import { Document } from "@ariadng/office/docx";
import { Workbook } from "@ariadng/office/xlsx";
import type { Id } from "../../../../convex/_generated/dataModel";
import { materializeDocxArtifact } from "@/app/api/spectra/lenses/docx/route";
import { materializeOfficeArtifact } from "@/app/api/spectra/lenses/office/route";
import { docxLens, sha256Payload } from "../lenses/docx-lens";
import { xlsxLens } from "../lenses/xlsx-lens";
import { xlsxArtifactContent } from "../lenses/office-content";
import { compactDocxProjectionForStorage } from "../lenses/document-projection";
import { prepareWholeNativeHistoryRestore, preparePartialNativeHistoryRestore } from "../lenses/native-restore-preparation";

const io = vi.hoisted(() => ({
  query: vi.fn(), mutation: vi.fn(), fetchNative: vi.fn(), upload: vi.fn(),
}));
vi.mock("@/lib/convex-server", () => ({
  convexQuery: io.query, convexMutation: io.mutation,
  hydrateContentForWrite: vi.fn(), checkpointArtifactDurableContent: vi.fn(),
}));
vi.mock("../lenses/native-payload-server", () => ({
  fetchVerifiedNativePayload: io.fetchNative,
  fetchStoredNativeBase: vi.fn(),
  uploadNativePayload: io.upload,
  ensureImportedNativePayload: vi.fn(),
}));
const workId = "work-native-prepare" as Id<"spectraArtifacts">;
const aiOperation = { runId: "run-native", executionId: "attempt-native", operationId: "operation-native" };
const options = { prepareOnly: true, aiOperation };

beforeEach(() => {
  vi.clearAllMocks();
  io.mutation.mockImplementation(async () => { throw new Error("UNEXPECTED_NATIVE_EFFECT"); });
  io.upload.mockResolvedValue({ payloadRef: "retained-result", deduplicated: false });
});

async function fixture(format: "docx" | "xlsx", changed: boolean, local = true) {
  let payload: Uint8Array;
  let content: unknown;
  if (format === "docx") {
    const document = Document.create();
    document.addParagraph("Original");
    payload = await document.save();
    const opened = await docxLens.open(payload, "strict-native");
    content = compactDocxProjectionForStorage({
      ...opened.projection,
      blocks: opened.projection.blocks.map(block => changed ? {
        ...block, text: "Changed",
        inlineContent: [{ kind: "text" as const, text: "Changed" }],
      } : block),
    });
  } else {
    const workbook = Workbook.create();
    workbook.sheet("Sheet1")!.setCell("A1", "Original");
    payload = await workbook.save();
    const opened = await xlsxLens.open(payload);
    const next = xlsxArtifactContent(opened.projection);
    if (changed) next.sheets[0]!.cells.A1 = { ...next.sheets[0]!.cells.A1, value: "Changed" };
    content = next;
  }
  const hash = await sha256Payload(payload);
  const truth = {
    replicaId: "cloud-source", payloadRef: "retained-source", hash, revision: hash,
    bytes: payload.byteLength, nativeFormat: format, replicaKind: "cloud", state: "current",
    compatibilityProfile: "strict-native", url: "https://example.invalid/unused",
  };
  io.fetchNative.mockResolvedValue({ truth, payload });
  io.query.mockResolvedValue({ replicas: local ? [
    { _id: "local-target", kind: "local", revision: hash, state: "current" },
  ] : [] });
  return { truth, payload, content, materialize: format === "docx" ? materializeDocxArtifact : materializeOfficeArtifact };
}

describe("Native preparation before atomic admission", () => {
  it.each(["docx", "xlsx"] as const)("rejects %s preparation before effects when replica metadata disappears", async (format) => {
    const f = await fixture(format, true);
    io.query.mockResolvedValue(null);
    await expect(f.materialize(workId, f.content, options)).rejects.toThrow("WORK_NOT_FOUND");
    expect(io.upload).not.toHaveBeenCalled();
    expect(io.mutation).not.toHaveBeenCalled();
  });

  it("rejects native history preparation when replica metadata disappears", async () => {
    const f = await fixture("docx", false);
    io.query.mockResolvedValue(null);
    await expect(prepareWholeNativeHistoryRestore(workId, {
      sourceVersionId: "exact-version", sourcePayloadHash: f.truth.hash, payloadRef: "version-copy",
      nativeFormat: "docx", bytes: f.payload.length,
    }, f.payload)).rejects.toThrow("WORK_NOT_FOUND");
    expect(io.upload).not.toHaveBeenCalled();
    expect(io.mutation).not.toHaveBeenCalled();
  });

  it("prepares a human partial restore through the current-package preservation path", async () => {
    const f = await fixture("docx", true);
    const result = await preparePartialNativeHistoryRestore(workId, "docx", f.content);
    expect(result.state).toBe("prepared");
    expect(io.mutation).not.toHaveBeenCalled();
  });

  it("retains exact historical bytes while fencing the current native source", async () => {
    const current = await fixture("docx", false);
    const historical = Document.create(); historical.addParagraph("Historical body");
    const bytes = await historical.save(); const hash = await sha256Payload(bytes);
    const result = await prepareWholeNativeHistoryRestore(workId, {
      sourceVersionId: "exact-version", sourcePayloadHash: hash, payloadRef: "version-retained-copy", nativeFormat: "docx", bytes: bytes.length,
    }, bytes);
    expect(result.nativeSource.hash).toBe(current.truth.hash);
    expect(result.hash).toBe(hash);
    expect(result.nativeCandidate).toMatchObject({ destination: "bridge", queue: {
      baseRevision: current.truth.revision, contentHash: hash,
      nativeReceipt: { basePayloadHash: current.truth.hash, resultPayloadHash: hash, state: "pending" },
    } });
    expect(io.upload.mock.calls[0]?.[1]).toEqual(bytes);
    expect(io.mutation).not.toHaveBeenCalled();
  });

  it("prepares unchanged historical bytes without uploading or claiming a save", async () => {
    const f = await fixture("xlsx", false);
    const result = await prepareWholeNativeHistoryRestore(workId, {
      sourceVersionId: "exact-version", sourcePayloadHash: f.truth.hash, payloadRef: "version-copy", nativeFormat: "xlsx", bytes: f.payload.length,
    }, f.payload);
    expect(result.nativeCandidate.destination).toBe("none"); expect(io.upload).not.toHaveBeenCalled();
    expect(io.mutation).not.toHaveBeenCalled();
  });

  it("rejects substituted historical bytes before reading current state", async () => {
    await expect(prepareWholeNativeHistoryRestore(workId, {
      sourceVersionId: "exact-version", sourcePayloadHash: "a".repeat(64), payloadRef: "version-copy", nativeFormat: "docx", bytes: 1,
    }, new Uint8Array([1]))).rejects.toThrow("NATIVE_RESTORE_SOURCE_INVALID");
    expect(io.fetchNative).not.toHaveBeenCalled(); expect(io.upload).not.toHaveBeenCalled();
  });
  it.each([
    ["docx", true], ["docx", false], ["xlsx", true], ["xlsx", false],
  ] as const)("prepares %s with local=%s using actual native bytes but creates no effect", async (format, local) => {
    const f = await fixture(format, true, local);
    const result = await f.materialize(workId, f.content, options);
    expect(result.state).toBe("prepared");
    if (result.state !== "prepared") throw new Error("Expected a prepared candidate");
    expect(result.nativeSource).toEqual({
      replicaId: f.truth.replicaId, payloadRef: f.truth.payloadRef, hash: f.truth.hash,
      revision: f.truth.revision, bytes: f.truth.bytes, nativeFormat: format,
    });
    expect(result.nativeCandidate.destination).toBe(local ? "bridge" : "cloud");
    expect(io.mutation).not.toHaveBeenCalled();
    expect(io.upload).toHaveBeenCalledTimes(1);
    const bytes = io.upload.mock.calls[0]![1] as Uint8Array;
    expect(result.hash).toBe(await sha256Payload(bytes));
    const candidate = result.nativeCandidate;
    const args = candidate.destination === "bridge" ? candidate.queue :
      candidate.destination === "cloud" ? candidate.cloud : undefined;
    expect(args).toMatchObject({
      payloadRef: "retained-result", contentHash: result.hash, baseRevision: f.truth.hash,
      projectionContent: result.projectionContent,
    });
    if (format === "docx") {
      const readback = await docxLens.open(bytes, "strict-native");
      expect(readback.projection.blocks.some(block => block.text === "Changed")).toBe(true);
      expect(args?.nativeReceipt?.semantic.readbackDigest).toBe(readback.projection.nativeBinding.semanticDigest);
    } else {
      const readback = await xlsxLens.open(bytes);
      expect(readback.projection.sheets[0]!.cells.find(cell => cell.ref === "A1")?.value).toBe("Changed");
      expect(args?.nativeReceipt?.semantic.readbackDigest).toBe(readback.projection.nativeBinding.semanticDigest);
    }
  });

  it.each(["docx", "xlsx"] as const)("binds unchanged %s to the actual retained source without upload", async format => {
    const f = await fixture(format, false);
    const result = await f.materialize(workId, f.content, options);
    expect(result.state).toBe("prepared");
    if (result.state !== "prepared") throw new Error("Expected a prepared candidate");
    expect(result.nativeCandidate).toMatchObject({
      destination: "none",
      unchanged: {
        sourcePayloadRef: f.truth.payloadRef, resultPayloadRef: f.truth.payloadRef,
        sourceHash: f.truth.hash, resultHash: f.truth.hash,
        preservationEvidence: { state: "unchanged", basePayloadHash: f.truth.hash, resultPayloadHash: f.truth.hash },
      },
    });
    expect(io.upload).not.toHaveBeenCalled();
    expect(io.mutation).not.toHaveBeenCalled();
  });

  it.each(["docx", "xlsx"] as const)("does not turn missing %s bytes into a saved/deferred result", async format => {
    const f = await fixture(format, false);
    io.fetchNative.mockRejectedValue(new Error("NATIVE_PAYLOAD_UNAVAILABLE"));
    await expect(f.materialize(workId, f.content, options)).rejects.toThrow("NATIVE_PAYLOAD_UNAVAILABLE");
    expect(io.upload).not.toHaveBeenCalled();
    expect(io.mutation).not.toHaveBeenCalled();
  });

  it.each([materializeDocxArtifact, materializeOfficeArtifact])("requires executor identity before fetching preparation bytes", async materialize => {
    await expect(materialize(workId, {}, { prepareOnly: true })).rejects.toThrow("NATIVE_PROMOTION_IDENTITY_REQUIRED");
    expect(io.fetchNative).not.toHaveBeenCalled();
    expect(io.upload).not.toHaveBeenCalled();
    expect(io.mutation).not.toHaveBeenCalled();
  });
});
