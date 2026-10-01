import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { strFromU8, unzipSync } from "fflate";
import type { Id } from "../../../../convex/_generated/dataModel";
import { materializeOfficeArtifact } from "@/app/api/spectra/lenses/office/route";
import { xlsxLens, xlsxSemanticDigest, type XlsxProjection } from "../lenses/xlsx-lens";
import { sha256Payload } from "../lenses/docx-lens";
import { xlsxArtifactContent } from "../lenses/office-content";
import { canonicalJsonValue } from "../collaboration/artifact-yjs-model";
import { encodeArtifactContentForStorage, decodeSheetsContentFromStorage } from "../../../../shared/sheet-cells";

const io = vi.hoisted(() => ({ query: vi.fn(), mutation: vi.fn(), fetchNative: vi.fn(), upload: vi.fn() }));
vi.mock("@/lib/convex-server", () => ({ convexQuery: io.query, convexMutation: io.mutation, hydrateContentForWrite: vi.fn(), checkpointArtifactDurableContent: vi.fn() }));
vi.mock("../lenses/native-payload-server", () => ({ fetchVerifiedNativePayload: io.fetchNative, fetchStoredNativeBase: vi.fn(), uploadNativePayload: io.upload, ensureImportedNativePayload: vi.fn() }));
const workId = "xlsx-route-regression" as Id<"spectraArtifacts">;
const options = { prepareOnly: true, aiOperation: { runId: "run-xlsx", executionId: "attempt-xlsx", operationId: "operation-xlsx" } };

beforeEach(() => {
  vi.clearAllMocks();
  io.mutation.mockImplementation(async () => { throw new Error("UNEXPECTED_NATIVE_EFFECT"); });
  io.upload.mockResolvedValue({ payloadRef: "retained-xlsx-result", deduplicated: false });
});
afterEach(() => vi.restoreAllMocks());

async function fixture() {
  const payload = new Uint8Array(await readFile("fixtures/office/xlsx/complex-preservation.xlsx"));
  const opened = await xlsxLens.open(payload);
  const hash = await sha256Payload(payload);
  const truth = { replicaId: "cloud-source", payloadRef: "retained-source", hash, revision: hash, bytes: payload.byteLength, nativeFormat: "xlsx", replicaKind: "cloud", state: "current", compatibilityProfile: "strict-native", url: "https://example.invalid/unused" };
  io.fetchNative.mockResolvedValue({ truth, payload });
  io.query.mockResolvedValue({ replicas: [{ _id: "local-target", kind: "local", revision: hash, state: "current" }] });
  return { payload, opened, content: xlsxArtifactContent(opened.projection) };
}

describe("XLSX actual materialization route", () => {
  it.each([["B1", "Updated cell through Spectra"], ["B2", "Updated cell through Spectra"], ["B3", "Updated cell through Spectra"], ["A3", 999]] as const)("prepares a verified %s edit in a preserved complex workbook", async (ref, value) => {
    const { opened, content } = await fixture();
    const sheet = content.sheets[0]!;
    sheet.cells[ref] = { ...sheet.cells[ref], value, formula: undefined };
    const result = await materializeOfficeArtifact(workId, content, options);
    expect(result.state).toBe("prepared");
    if (result.state !== "prepared" || result.nativeCandidate.destination !== "bridge") throw new Error("Expected a prepared bridge candidate");
    expect(io.mutation).not.toHaveBeenCalled();
    expect(io.upload).toHaveBeenCalledTimes(1);
    const bytes = io.upload.mock.calls[0]![1] as Uint8Array;
    const readback = await xlsxLens.open(bytes);
    expect(readback.projection.sheets[0]!.cells.find(cell => cell.ref === ref)?.value).toBe(value);
    expect(readback.projection.sheets[0]!.charts?.[0]?.series).toEqual(opened.projection.sheets[0]!.charts?.[0]?.series);
    if (ref === "A3") {
      const chartPart = readback.projection.sheets[0]!.charts?.[0]?.partName;
      if (!chartPart) throw new Error("Expected the preserved native chart");
      expect(strFromU8(unzipSync(bytes)[chartPart.replace(/^\//, "")]!)).toContain("<c:v>999</c:v>");
    }
    expect(result.nativeCandidate.queue.nativeReceipt?.semantic.resultDigest).toBe(readback.projection.nativeBinding.semanticDigest);
    expect(result.nativeCandidate.queue.nativeReceipt?.semantic.readbackDigest).toBe(readback.projection.nativeBinding.semanticDigest);
  });

  it.each([["B3", "Saved cell edit"], ["B5", "Another saved cell edit"], ["A3", 10]] as const)("verifies persisted canonical %s edits regardless of nested field order", async (ref, value) => {
    const { content } = await fixture();
    content.sheets[0]!.cells[ref] = { ...content.sheets[0]!.cells[ref], value };
    const persisted = decodeSheetsContentFromStorage(canonicalJsonValue(encodeArtifactContentForStorage("sheets", content)));
    const result = await materializeOfficeArtifact(workId, persisted, options);
    expect(result.state).toBe("prepared");
    if (result.state !== "prepared" || result.nativeCandidate.destination !== "bridge") throw new Error("Expected a persisted workbook candidate");
    const actual = await xlsxLens.open(io.upload.mock.calls[0]![1] as Uint8Array);
    expect(actual.projection.sheets[0]!.cells.find(cell => cell.ref === ref)?.value).toBe(value);
    expect(result.nativeCandidate.queue.nativeReceipt?.semantic.resultDigest).toBe(actual.projection.nativeBinding.semanticDigest);
    expect(io.mutation).not.toHaveBeenCalled();
  });

  it.each(["value", "format", "chart-source", "cell-order"] as const)("keeps %s authoritative while ignoring object field insertion order", async field => {
    const { opened } = await fixture();
    const base = opened.projection;
    const reordered = canonicalJsonValue(base) as XlsxProjection;
    const originalDigest = await xlsxSemanticDigest(base);
    expect(await xlsxSemanticDigest(reordered)).toBe(originalDigest);
    const changed = structuredClone(reordered);
    const sheet = changed.sheets[0]!;
    if (field === "value") sheet.cells[0]!.value = "A different native value";
    if (field === "format") sheet.cells[0]!.format = { ...sheet.cells[0]!.format, bold: true };
    if (field === "chart-source") sheet.charts![0]!.sourceRange = "Sheet1!$A$1:$A$6";
    if (field === "cell-order") [sheet.cells[0], sheet.cells[1]] = [sheet.cells[1]!, sheet.cells[0]!];
    expect(await xlsxSemanticDigest(changed)).not.toBe(originalDigest);
  });

  it("uses freshly read native truth when an editor retains an older binding digest", async () => {
    const { payload, content } = await fixture();
    if (!content.nativeBinding) throw new Error("Expected an imported native binding");
    content.nativeBinding.semanticDigest = "0".repeat(64);
    content.sheets[0]!.cells.B3 = { ...content.sheets[0]!.cells.B3, value: "Edit with an older stored binding" };
    const result = await materializeOfficeArtifact(workId, canonicalJsonValue(content), options);
    if (result.state !== "prepared" || result.nativeCandidate.destination !== "bridge") throw new Error("Expected a candidate fenced by the native source");
    expect(result.nativeCandidate.queue.nativeReceipt?.basePayloadHash).toBe(await sha256Payload(payload));
    const actual = await xlsxLens.open(io.upload.mock.calls[0]![1] as Uint8Array);
    expect(result.nativeCandidate.queue.nativeReceipt?.semantic.readbackDigest).toBe(actual.projection.nativeBinding.semanticDigest);
    expect(io.mutation).not.toHaveBeenCalled();
  });

  it("rejects a writer that loses a requested cell edit before upload or admission", async () => {
    const { payload, content } = await fixture();
    content.sheets[0]!.cells.B3 = { ...content.sheets[0]!.cells.B3, value: "A change the writer must retain" };
    vi.spyOn(xlsxLens, "mutate").mockResolvedValueOnce(payload);
    await expect(materializeOfficeArtifact(workId, content, options)).rejects.toThrow("OFFICE_READBACK_MISMATCH");
    expect(io.upload).not.toHaveBeenCalled();
    expect(io.mutation).not.toHaveBeenCalled();
  });
});
