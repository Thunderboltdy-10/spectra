import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { unzipSync, zipSync } from "fflate";
import { pptxLens, pptxProjectionSemanticDigest } from "../lenses/pptx-lens";
import { sha256Payload } from "../lenses/docx-lens";
import { pptxArtifactContent, pptxProjectionUpdateFromContent } from "../lenses/office-content";
import type { PptxImageAsset } from "../lenses/projection-contracts";

const png = new Uint8Array(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"));
const fixture = async () => pptxLens.open(await readFile("fixtures/office/pptx/media-preservation.pptx"));
const asset = async (): Promise<PptxImageAsset> => ({ assetId: "durable-png", name: "A retained picture.png", mediaType: "image/png", sha256: await sha256Payload(png) });
const options = { resolveAsset: async () => png };

describe("native PPTX image authoring", () => {
  it("inserts a durable picture from complete content and verifies identity, geometry and actual embedded bytes", async () => {
    const opened = await fixture();
    const content = pptxArtifactContent(opened.projection);
    const slide = content.slides[0]!;
    const image = await asset();
    slide.objects.push({ id: "authored-picture", type: "image", x: 123.123, y: 81.5, width: 301.25, height: 201.25, rotation: 15, content: image, altText: "A retained picture", readingOrder: slide.objects.length });
    const update = pptxProjectionUpdateFromContent(content, opened.projection, { objectLists: "complete" });
    expect(update.operations).toContainEqual(expect.objectContaining({ kind: "insert-image", objectId: "authored-picture", image }));
    const bytes = await pptxLens.materialize({ carry: opened.preservedCarry, projection: update.projection, options });
    const reopened = await pptxLens.open(bytes);
    const picture = reopened.projection.slides[0]!.objects.find((object) => object.id === "authored-picture")!;
    expect(picture).toMatchObject({ type: "image", altText: "A retained picture", rotation: 15, content: image });
    const partName = (picture.content as { nativeMediaPart: string }).nativeMediaPart;
    expect(unzipSync(bytes)[partName.slice(1)]).toEqual(png);
    expect(await pptxProjectionSemanticDigest(update.projection)).toBe(reopened.projection.nativeBinding.semanticDigest);
    const before = unzipSync(opened.preservedCarry.payload);
    const after = unzipSync(bytes);
    for (const name of Object.keys(before).filter((name) => /^ppt\/(media|charts|notesSlides|slideMasters|slideLayouts)\//.test(name))) expect(after[name], name).toEqual(before[name]);
  });

  it("replaces one picture occurrence while retaining its identity, geometry, crop and original package media", async () => {
    const opened = await fixture();
    const content = pptxArtifactContent(opened.projection);
    const picture = content.slides.flatMap((slide) => slide.objects).find((object) => object.type === "image")!;
    const image = await asset();
    picture.content = { ...(picture.content as object), ...image };
    const update = pptxProjectionUpdateFromContent(content, opened.projection, { objectLists: "complete" });
    expect(update.operations.filter((operation) => operation.kind === "replace-image")).toHaveLength(1);
    const bytes = await pptxLens.materialize({ carry: opened.preservedCarry, projection: update.projection, options });
    const actual = await pptxLens.open(bytes);
    const saved = actual.projection.slides.flatMap((slide) => slide.objects).find((object) => object.id === picture.id)!;
    expect(saved).toMatchObject({ x: picture.x, y: picture.y, width: picture.width, height: picture.height, rotation: picture.rotation, content: image });
    expect(await pptxProjectionSemanticDigest(update.projection)).toBe(actual.projection.nativeBinding.semanticDigest);
    const beforeParts = unzipSync(opened.preservedCarry.payload);
    const afterParts = unzipSync(bytes);
    for (const name of Object.keys(beforeParts).filter((name) => name.startsWith("ppt/media/"))) expect(afterParts[name], name).toEqual(beforeParts[name]);
    const savedContent = pptxArtifactContent(actual.projection);
    expect(pptxProjectionUpdateFromContent(savedContent, actual.projection, { objectLists: "complete" }).operations).toEqual([]);
  });

  it("refuses missing, mismatched and incorrectly typed asset bytes", async () => {
    const opened = await fixture();
    const operation = { kind: "insert-image" as const, slideId: opened.projection.slides[0]!.id, objectId: "refused-picture", image: await asset(), x: 30, y: 40, width: 300, height: 200, rotation: 0 };
    await expect(pptxLens.mutate(opened.preservedCarry, operation)).rejects.toThrow(/unavailable/);
    await expect(pptxLens.mutate(opened.preservedCarry, { ...operation, image: { ...operation.image, sha256: "0".repeat(64) } }, options)).rejects.toThrow(/do not match/);
    await expect(pptxLens.mutate(opened.preservedCarry, { ...operation, image: { ...operation.image, mediaType: "image/jpeg" } }, options)).rejects.toThrow(/do not match/);
  });

  it("reads the physical media hash and still compares authored style and content", async () => {
    const opened = await fixture();
    const image = await asset();
    const bytes = await pptxLens.mutate(opened.preservedCarry, { kind: "insert-image", slideId: opened.projection.slides[0]!.id, objectId: "hash-checked-picture", image, x: 30, y: 40, width: 300, height: 200, rotation: 0 }, options);
    const actual = await pptxLens.open(bytes);
    const picture = actual.projection.slides[0]!.objects.find((object) => object.id === "hash-checked-picture")!;
    const parts = unzipSync(bytes);
    const partName = (picture.content as { nativeMediaPart: string }).nativeMediaPart.slice(1);
    parts[partName] = new Uint8Array([...parts[partName]!, 0]);
    const changed = await pptxLens.open(zipSync(parts));
    expect(changed.projection.nativeBinding.semanticDigest).not.toBe(actual.projection.nativeBinding.semanticDigest);
    for (const field of ["style", "unknownContent"]) {
      const desired = structuredClone(actual.projection);
      const target = desired.slides[0]!.objects.find((object) => object.id === picture.id)!;
      if (field === "style") target.style = { fill: "#FF0000" };
      else target.content = { ...(target.content as object), caption: "An unsaved authored field" };
      expect(await pptxProjectionSemanticDigest(desired)).not.toBe(actual.projection.nativeBinding.semanticDigest);
    }
  });
});
