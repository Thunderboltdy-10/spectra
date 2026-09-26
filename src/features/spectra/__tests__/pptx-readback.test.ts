import { describe, expect, it } from "vitest";
import { normalizePptxProjectionForReadback, pptxTextFromObjects, pptxTitleFromObjects, pptxSemanticContent } from "../lenses/pptx-readback";
import type { PptxProjection } from "../lenses/projection-contracts";
import type { PresentationObject } from "../presentation/model";

const content = (text: string) => ({ text, paragraphs: [{ runs: [{ text, bold: true }] }] });
const object = (id: string, type: PresentationObject["type"], value: unknown, readingOrder: number): PresentationObject => ({ id, type, x: 10, y: 20, width: 300, height: 80, rotation: 0, content: value, readingOrder });
function fixture(): PptxProjection {
  const objects = [
    object("title", "text", { ...content("Native title"), nativeShapeKind: "placeholder", nativeShapeId: "1" }, 0),
    object("group", "group", { nativeShapeId: "2", childIds: ["body"] }, 1),
    { ...object("body", "text", { ...content("Grouped body"), nativeShapeId: "3" }, 2), parentId: "group" },
    object("table", "table", { nativeShapeId: "4", rows: [[content("Cell A"), content("Cell B")]] }, 3),
  ];
  return {
    slides: [{ id: "slide", index: 0, title: "Native title", text: ["Native title", "Grouped body", "Cell A", "Cell B"], objects, hasTransition: false, hasTiming: false, speakerNotes: "Notes" }],
    nativeBinding: { version: 1, format: "pptx", profile: "strict-native", macroEnabled: false, semanticDigest: "0".repeat(64) },
  };
}
const signature = (projection: PptxProjection) => JSON.stringify(pptxSemanticContent(projection));

describe("PPTX readback checks", () => {
  it("derives all table/group paragraphs and keeps the actual primary object graph", () => {
    const base = fixture();
    expect(pptxTextFromObjects(base.slides[0]!.objects)).toEqual(base.slides[0]!.text);
    expect(pptxTitleFromObjects(base.slides[0]!.objects)).toBe("Native title");
    expect(normalizePptxProjectionForReadback(base, base)).toEqual(base);
    const requested = structuredClone(base);
    requested.slides[0]!.objects = requested.slides[0]!.objects.filter((item) => item.id !== "title");
    const normalized = normalizePptxProjectionForReadback(requested, base);
    expect(normalized.slides[0]!.text).toEqual(["Grouped body", "Cell A", "Cell B"]);
    expect(normalized.slides[0]!.title).toBe("Grouped body");
    expect(normalized.slides[0]!.objects.map((item) => item.readingOrder)).toEqual([0, 1, 2]);
    expect(normalized.slides[0]!.objects[2]!.content).toEqual(base.slides[0]!.objects[3]!.content);
    expect(signature(normalized)).not.toBe(signature(base));
  });

  it.each(["title", "text", "readingOrder"] as const)("refuses an unmodeled independent %s edit before comparing native output", (field) => {
    const base = fixture();
    const requested = structuredClone(base);
    if (field === "title") requested.slides[0]!.title = "Not in title object";
    if (field === "text") requested.slides[0]!.text = ["Not in any native object"];
    if (field === "readingOrder") requested.slides[0]!.objects[0]!.readingOrder = 3;
    expect(() => normalizePptxProjectionForReadback(requested, base)).toThrow(/native|authored|title object/);
  });

  it.each(["title", "body", "table", "style", "order"] as const)("still detects a real %s change that the native writer failed to save", (field) => {
    const base = fixture();
    const requested = structuredClone(base);
    const slide = requested.slides[0]!;
    if (field === "title") slide.objects[0]!.content = { ...content("Changed title"), nativeShapeKind: "placeholder", nativeShapeId: "1" };
    if (field === "body") slide.objects[2]!.content = { ...content("Changed body"), nativeShapeId: "3" };
    if (field === "table") slide.objects[3]!.content = { nativeShapeId: "4", rows: [[content("Changed cell"), content("Cell B")]] };
    if (field === "style") slide.objects[0]!.style = { color: "#FF0000" };
    if (field === "order") slide.objects = [slide.objects[3]!, ...slide.objects.slice(0, 3)];
    const desired = normalizePptxProjectionForReadback(requested, base);
    expect(signature(desired)).not.toBe(signature(base));
  });

  it("refuses topology edits when native text is not fully represented, while preserving unrelated changes", () => {
    const base = fixture();
    base.slides[0]!.text.push("Unknown native paragraph");
    const desired = structuredClone(base);
    desired.slides[0]!.objects.pop();
    expect(() => normalizePptxProjectionForReadback(desired, base)).toThrow(/outside the modeled/);
    const style = structuredClone(base);
    style.slides[0]!.objects[0]!.style = { fill: "#FF0000" };
    expect(normalizePptxProjectionForReadback(style, base).slides[0]!.text).toEqual(base.slides[0]!.text);
  });
});
