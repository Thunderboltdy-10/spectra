import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import type { Id } from "../../../../convex/_generated/dataModel";
import { materializeOfficeArtifact } from "@/app/api/spectra/lenses/office/route";
import { pptxLens } from "../lenses/pptx-lens";
import { sha256Payload } from "../lenses/docx-lens";
import { pptxArtifactContent } from "../lenses/office-content";
import { normalizePresentationContent, presentationObjectText, withPresentationObjectText } from "../presentation/model";

const io = vi.hoisted(() => ({ query: vi.fn(), mutation: vi.fn(), fetchNative: vi.fn(), upload: vi.fn(), resolveAsset: vi.fn() }));
vi.mock("@/lib/convex-server", () => ({ convexQuery: io.query, convexMutation: io.mutation, hydrateContentForWrite: vi.fn(), checkpointArtifactDurableContent: vi.fn() }));
vi.mock("../lenses/native-payload-server", () => ({ fetchVerifiedNativePayload: io.fetchNative, fetchStoredNativeBase: vi.fn(), uploadNativePayload: io.upload, ensureImportedNativePayload: vi.fn() }));
vi.mock("../lenses/asset-resolver-server", () => ({ resolveArtifactAssetBytes: io.resolveAsset }));
const workId = "s11-pptx-route" as Id<"spectraArtifacts">;
const options = { prepareOnly: true, aiOperation: { runId: "run-s11-pptx", executionId: "attempt-s11-pptx", operationId: "operation-s11-pptx" } };

beforeEach(() => {
  vi.clearAllMocks();
  io.mutation.mockImplementation(async () => { throw new Error("UNEXPECTED_NATIVE_EFFECT"); });
  io.upload.mockResolvedValue({ payloadRef: "retained-pptx-result", deduplicated: false });
  io.resolveAsset.mockRejectedValue(new Error("ASSET_NOT_AUTHORIZED"));
});
afterEach(() => vi.restoreAllMocks());

async function fixture(input?: Uint8Array) {
  const payload = input ?? new Uint8Array(await readFile("fixtures/office/pptx/typical-preservation.pptx"));
  const opened = await pptxLens.open(payload);
  const hash = await sha256Payload(payload);
  const truth = { replicaId: "cloud-source", payloadRef: "retained-source", hash, revision: hash, bytes: payload.byteLength, nativeFormat: "pptx", replicaKind: "cloud", state: "current", compatibilityProfile: "strict-native", url: "https://example.invalid/unused" };
  io.fetchNative.mockResolvedValue({ truth, payload });
  io.query.mockResolvedValue({ replicas: [{ _id: "local-target", kind: "local", revision: hash, state: "current" }] });
  return { truth, payload, opened, content: pptxArtifactContent(opened.projection) };
}

describe("PPTX actual materialization route", () => {
  it.each(["\n", "\n\n", "\nSecond line\n"])("prepares a native body edit retaining authored paragraphs %j", async suffix => {
    const { truth, content: imported } = await fixture(new Uint8Array(await readFile("fixtures/office/pptx/transition-law.pptx")));
    const content = normalizePresentationContent(imported);
    const slide = content.slides[0]!;
    const body = slide.objects.filter(object => object.type === "text").at(-1)!;
    const marker = `Body edited through the native presentation studio${suffix}`;
    const editedBody = withPresentationObjectText(body, marker);
    slide.objects = slide.objects.map(object => object.id === body.id ? editedBody : object);
    const result = await materializeOfficeArtifact(workId, content, options);
    expect(result.state).toBe("prepared");
    if (result.state !== "prepared" || result.nativeCandidate.destination !== "bridge") throw new Error("Expected a prepared PPTX bridge candidate");
    expect(io.mutation).not.toHaveBeenCalled();
    expect(io.upload).toHaveBeenCalledTimes(1);
    const actual = await pptxLens.open(io.upload.mock.calls[0]![1] as Uint8Array);
    const actualBody = actual.projection.slides[0]!.objects.find(object => object.id === body.id)!;
    expect(presentationObjectText(actualBody)).toBe(marker.trim());
    expect((actualBody.content as { paragraphs: unknown }).paragraphs).toEqual((editedBody.content as { paragraphs: unknown }).paragraphs);
    expect(result.nativeCandidate.queue.nativeReceipt?.semantic.resultDigest).toBe(actual.projection.nativeBinding.semanticDigest);
    // Retry after the same native paragraphs already landed must be unchanged,
    // even when the editor's redundant display string retains a final newline.
    const writtenBytes = io.upload.mock.calls[0]![1] as Uint8Array;
    const writtenHash = await sha256Payload(writtenBytes);
    io.fetchNative.mockResolvedValue({ truth: { ...truth, hash: writtenHash, revision: writtenHash }, payload: writtenBytes });
    io.upload.mockClear();
    const repeated = await materializeOfficeArtifact(workId, content, options);
    expect(repeated.state).toBe("prepared");
    if (repeated.state !== "prepared") throw new Error("Expected the unchanged native candidate");
    expect(repeated.nativeCandidate.destination).toBe("none");
    expect(io.upload).not.toHaveBeenCalled();
    expect(io.mutation).not.toHaveBeenCalled();
  });

  it.each(["insert", "replace"] as const)("resolves durable bytes and prepares a verified native image %s", async (change) => {
    const { content } = await fixture(new Uint8Array(await readFile("fixtures/office/pptx/media-preservation.pptx")));
    const png = new Uint8Array(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"));
    const image = { assetId: "route-image-asset", name: "route-image.png", mediaType: "image/png", sha256: await sha256Payload(png) };
    io.resolveAsset.mockResolvedValue({ ...image, bytes: png });
    const slide = content.slides[0]!;
    let objectId: string;
    if (change === "insert") {
      objectId = "route-new-picture";
      slide.objects.push({ id: objectId, type: "image", x: 90, y: 100, width: 300, height: 180, rotation: 0, content: image, readingOrder: slide.objects.length });
    } else {
      const picture = content.slides.flatMap((item) => item.objects).find((object) => object.type === "image")!;
      objectId = picture.id;
      picture.content = { ...(picture.content as object), ...image };
    }
    const result = await materializeOfficeArtifact(workId, content, options);
    expect(result.state).toBe("prepared");
    if (result.state !== "prepared" || result.nativeCandidate.destination !== "bridge") throw new Error("Expected a prepared bridge candidate");
    expect(io.resolveAsset).toHaveBeenCalledWith(image.assetId);
    expect(io.mutation).not.toHaveBeenCalled();
    const actual = await pptxLens.open(io.upload.mock.calls[0]![1] as Uint8Array);
    expect(actual.projection.slides.flatMap((item) => item.objects).find((object) => object.id === objectId)!.content).toMatchObject(image);
    expect(result.nativeCandidate.queue.nativeReceipt?.semantic.resultDigest).toBe(actual.projection.nativeBinding.semanticDigest);
  });

  it("stops an inaccessible durable image before upload or effect", async () => {
    const { content } = await fixture();
    content.slides[0]!.objects.push({ id: "inaccessible-image", type: "image", x: 90, y: 100, width: 300, height: 180, rotation: 0, content: { assetId: "denied", mediaType: "image/png", sha256: "0".repeat(64) } });
    await expect(materializeOfficeArtifact(workId, content, options)).rejects.toThrow("ASSET_NOT_AUTHORIZED");
    expect(io.upload).not.toHaveBeenCalled();
    expect(io.mutation).not.toHaveBeenCalled();
  });

  it.each(["remove", "reorder", "title"] as const)("prepares a verified native %s with complete list authority and no early effect", async (change) => {
    const { content } = await fixture();
    const slide = content.slides.find((item) => item.objects.length > 1)!;
    if (change === "remove") slide.objects = slide.objects.slice(1);
    else if (change === "reorder") slide.objects = [...slide.objects].reverse();
    else slide.title = "An independently edited native title";
    const expectedIds = slide.objects.map((object) => object.id);
    const result = await materializeOfficeArtifact(workId, content, options);
    expect(result.state).toBe("prepared");
    if (result.state !== "prepared") throw new Error("Expected a prepared PPTX candidate");
    expect(io.mutation).not.toHaveBeenCalled();
    expect(io.upload).toHaveBeenCalledTimes(1);
    const bytes = io.upload.mock.calls[0]![1] as Uint8Array;
    const readback = await pptxLens.open(bytes);
    if (change === "title") expect(readback.projection.slides.find((item) => item.id === slide.id)!.title).toBe(slide.title);
    expect(readback.projection.slides.find((item) => item.id === slide.id)!.objects.map((object) => object.id)).toEqual(expectedIds);
    expect(result.nativeCandidate.destination).toBe("bridge");
    if (result.nativeCandidate.destination !== "bridge") throw new Error("Expected a bridge candidate");
    const receipt = result.nativeCandidate.queue.nativeReceipt;
    expect(receipt?.semantic.resultDigest).toBe(readback.projection.nativeBinding.semanticDigest);
    expect(receipt?.semantic.readbackDigest).toBe(readback.projection.nativeBinding.semanticDigest);
  });

  it.each(["fade", "push", "dissolve", "none"] as const)("prepares and verifies a native %s transition through the preservation guard", async (kind) => {
    const initial = await fixture();
    const seed = await pptxLens.mutate(initial.opened.preservedCarry, { kind: "set-transition", slideId: initial.content.slides[0]!.id, transition: { kind: "fade", durationMs: 300 } });
    const { content } = await fixture(seed);
    if (kind === "none") delete content.slides[0]!.transition;
    else content.slides[0]!.transition = { kind, durationMs: 550 };
    const result = await materializeOfficeArtifact(workId, content, options);
    expect(result.state).toBe("prepared");
    if (result.state !== "prepared" || result.nativeCandidate.destination !== "bridge") throw new Error("Expected a prepared bridge candidate");
    expect(io.mutation).not.toHaveBeenCalled();
    expect(io.upload).toHaveBeenCalledTimes(1);
    const readback = await pptxLens.open(io.upload.mock.calls[0]![1] as Uint8Array);
    expect(readback.projection.slides[0]!.transition).toEqual(kind === "none" ? { kind } : { kind, durationMs: 550 });
    expect(result.nativeCandidate.queue.nativeReceipt?.semantic.resultDigest).toBe(readback.projection.nativeBinding.semanticDigest);
  });

  it.each(["text", "transition"] as const)("rejects an actual writer fault that drops requested %s before any candidate upload or effect", async (field) => {
    const { payload, content } = await fixture();
    if (field === "transition") content.slides[0]!.transition = { kind: "fade", durationMs: 550 };
    else {
      const object = content.slides.flatMap((slide) => slide.objects).find((item) => item.type === "text" && !(item.content as { nativeShapeKind?: string }).nativeShapeKind?.includes("placeholder"))!;
      const original = object.content as Record<string, unknown>;
      object.content = { ...original, text: "Requested text that must be saved", paragraphs: [{ runs: [{ text: "Requested text that must be saved" }] }] };
    }
    // Positive cases use the real writer. This deliberate single-call fault
    // returns the original package to prove the route rejects a lost effect.
    vi.spyOn(pptxLens, "mutate").mockResolvedValueOnce(payload);
    await expect(materializeOfficeArtifact(workId, content, options)).rejects.toThrow("OFFICE_READBACK_MISMATCH");
    expect(io.upload).not.toHaveBeenCalled();
    expect(io.mutation).not.toHaveBeenCalled();
  });
});
