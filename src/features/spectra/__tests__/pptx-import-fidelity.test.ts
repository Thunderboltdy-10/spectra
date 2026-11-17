import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { pptxLens, pptxProjectionSemanticDigest } from "../lenses/pptx-lens";
import { pptxArtifactContent, pptxProjectionUpdateFromContent } from "../lenses/office-content";
import { normalizePresentationContent, type PresentationObject } from "../presentation/model";
import { validateArtifactContent } from "../artifacts/registry";
import { workPreview } from "../artifacts/work-preview";
import { isHollowDefaultContent } from "../../../../convex/spectraShared";

const fixture = (name: string) => readFile(`fixtures/office/pptx/${name}.pptx`).then((buffer) => new Uint8Array(buffer));
const record = (value: unknown) => (value ?? {}) as Record<string, unknown>;
const editorDeck = (projection: Parameters<typeof pptxArtifactContent>[0]) =>
  normalizePresentationContent(pptxArtifactContent(projection) as never) as unknown as {
    slides: Array<{ id: string; objects: PresentationObject[] }>;
  };

describe("PowerPoint imports", () => {
  it("keeps shapes that run past the slide edge where the file has them", async () => {
    const opened = await pptxLens.open(await fixture("typical-preservation"));
    const content = pptxArtifactContent(opened.projection);
    expect(validateArtifactContent("presentation", content).success).toBe(true);
    const deck = editorDeck(opened.projection);
    // Nothing moved, so nothing is written back.
    expect(pptxProjectionUpdateFromContent(deck, opened.projection).operations).toEqual([]);
  });

  it("reads back a moved shape despite the file's EMU rounding", async () => {
    const opened = await pptxLens.open(await fixture("typical-preservation"));
    const deck = editorDeck(opened.projection);
    // A shape with its own transform (a placeholder may inherit its place).
    const target = deck.slides.flatMap((slide) => slide.objects).find((object) => object.type === "text" && record(object.content).nativeShapeKind === "shape" && !object.parentId)!;
    target.y += 1.234567;
    target.rotation = 12.3456789;
    const update = pptxProjectionUpdateFromContent(deck, opened.projection);
    expect(update.operations.some((operation) => operation.kind === "set-geometry")).toBe(true);
    const written = await pptxLens.mutate(opened.preservedCarry, { kind: "ai-edit", operations: update.operations });
    const readback = await pptxLens.open(written);
    expect(await pptxProjectionSemanticDigest(update.projection, opened.projection)).toBe(readback.projection.nativeBinding.semanticDigest);
  });

  it("keeps the slide's text mirror when a text box is edited", async () => {
    const opened = await pptxLens.open(await fixture("masters-media-preservation"));
    const deck = editorDeck(opened.projection);
    const box = deck.slides[0]!.objects.find((object) => record(object.content).text === "And More")!;
    box.content = { ...record(box.content), text: "And More Still", paragraphs: [{ runs: [{ text: "And More Still" }] }] };
    const update = pptxProjectionUpdateFromContent(deck, opened.projection);
    expect(update.projection.slides[0]!.text).toEqual(["Title", "And More Still"]);
    const written = await pptxLens.mutate(opened.preservedCarry, { kind: "ai-edit", operations: update.operations });
    const readback = await pptxLens.open(written);
    expect(await pptxProjectionSemanticDigest(update.projection, opened.projection)).toBe(readback.projection.nativeBinding.semanticDigest);
  });

  it("draws SmartArt from the diagram's own drawing", async () => {
    const opened = await pptxLens.open(await fixture("masters-media-preservation"));
    const smartArt = opened.projection.slides[1]!.objects.find((object) => record(record(object.content).nativeObject).kind === "smartArt")!;
    const drawing = record(record(smartArt.content).nativeObject).drawing as Array<Record<string, unknown>>;
    expect(drawing.length).toBeGreaterThan(1);
    for (const shape of drawing) {
      expect(shape.x).toBeGreaterThanOrEqual(-0.01);
      expect(Number(shape.x) + Number(shape.width)).toBeLessThanOrEqual(1.01);
    }
    expect(drawing.some((shape) => typeof shape.fill === "string")).toBe(true);
  });

  it("shows bullets a body placeholder inherits from its master", async () => {
    const opened = await pptxLens.open(await fixture("typical-preservation"));
    const body = opened.projection.slides[1]!.objects.find((object) => object.id.endsWith(":shape:110595"))!;
    const paragraphs = record(body.content).paragraphs as Array<Record<string, unknown>>;
    expect(paragraphs[0]!.bullet).toBe("bullet");
  });

  it("does not take a picture-only deck for an empty one", () => {
    const pictureSlide = { id: "s1", objects: [{ id: "p", type: "image", x: 0, y: 0, width: 1000, height: 562.5, content: {} }] };
    expect(isHollowDefaultContent("presentation", { slides: [pictureSlide] })).toBe(false);
    expect(isHollowDefaultContent("presentation", { slides: [{ id: "s1", objects: [] }], nativeBinding: { version: 1 } })).toBe(false);
  });

  it("gives the card the deck's first slide to draw", async () => {
    const opened = await pptxLens.open(await fixture("masters-media-preservation"));
    const preview = workPreview("presentation", pptxArtifactContent(opened.projection));
    expect(preview).toMatchObject({ kind: "slides", first: { slide: { id: opened.projection.slides[0]!.id } } });
  });
});
