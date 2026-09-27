import type { PptxProjection, PptxSlideProjection } from "./projection-contracts";
import type { PresentationObject } from "../presentation/model";
import { pptxImageReadbackObject } from "./pptx-media-readback";

const equal = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

function paragraphs(value: unknown): string[] {
  const content = record(value);
  if (Array.isArray(content.paragraphs)) return content.paragraphs.flatMap((paragraph) => {
    const runs = record(paragraph).runs;
    if (!Array.isArray(runs)) return [];
    const text = runs.map((run) => String(record(run).text ?? "")).join("");
    return text.length ? [text] : [];
  });
  const text = typeof value === "string" ? value : typeof content.text === "string" ? content.text : "";
  return text.split(/\r?\n/).filter((line) => line.length);
}

/** Mirrors Slide.text's paragraph order only where the imported model proves
 * complete coverage. Groups are flat scene parents; their children occur later
 * in the list and must not be counted twice. Chart text is in a separate part. */
export function pptxTextFromObjects(objects: readonly PresentationObject[]): string[] {
  return objects.flatMap((object) => {
    if (object.type === "group" || object.type === "chart") return [];
    if (object.type !== "table") return paragraphs(object.content);
    const rows = record(object.content).rows;
    return Array.isArray(rows) ? rows.flatMap((row) => Array.isArray(row) ? row.flatMap(paragraphs) : []) : [];
  });
}

export function pptxTitleFromObjects(objects: readonly PresentationObject[], text = pptxTextFromObjects(objects)): string {
  const title = objects.find((object) => record(object.content).nativeShapeKind === "placeholder");
  if (!title) return text[0] ?? "";
  const firstParagraph = record(title.content).paragraphs;
  const runs = Array.isArray(firstParagraph) ? record(firstParagraph[0]).runs : undefined;
  // projectPresentation reads the first native a:t for a title placeholder.
  return Array.isArray(runs) ? String(record(runs[0]).text ?? "") : paragraphs(title.content)[0] ?? "";
}

function refuse(code: string, message: string): never {
  throw Object.assign(new Error(message), { code });
}

/** Resolve only proven derived mirrors. Every object, table cell, run, style,
 * array order and native-only property remains in the digest. An independent
 * title/text/order request that has no matching primary model is refused rather
 * than normalized away. Unknown native text coverage is also refused on change. */
export function normalizePptxProjectionForReadback(requested: PptxProjection, before: PptxProjection): PptxProjection {
  const previousById = new Map(before.slides.map((slide) => [slide.id, slide]));
  return { ...requested, slides: requested.slides.map((slide) => {
    const previous = previousById.get(slide.id);
    if (!previous) return slide;
    const previousObjects = new Map(previous.objects.map((object) => [object.id, object]));
    const previousText = pptxTextFromObjects(previous.objects);
    const nextText = pptxTextFromObjects(slide.objects);
    const topologyChanged = !equal(previous.objects.map((object) => object.id), slide.objects.map((object) => object.id));
    const textChanged = !equal(previousText, nextText);
    const coversText = equal(previousText, previous.text);
    if (!coversText && (topologyChanged || textChanged))
      refuse("PPTX_TEXT_PROJECTION_INCOMPLETE", "This slide contains native text outside the modeled object paragraphs. Its object or text changes need a complete native mapping.");
    if (coversText && !equal(slide.text, previous.text) && !equal(slide.text, nextText))
      refuse("PPTX_TEXT_INTENT_UNMODELED", "The slide text change does not match its authored object paragraphs.");
    const previousTitle = pptxTitleFromObjects(previous.objects, previousText);
    const nextTitle = pptxTitleFromObjects(slide.objects, nextText);
    const coversTitle = previousTitle === previous.title;
    if (coversTitle && slide.title !== previous.title && slide.title !== nextTitle)
      refuse("PPTX_TITLE_INTENT_UNMODELED", "Edit the title object's text to save this native slide title.");
    if (!coversTitle && topologyChanged)
      refuse("PPTX_TITLE_PROJECTION_INCOMPLETE", "This slide's native title is not represented by a modeled title object.");
    const objects = slide.objects.map((object, index) => {
      const original = previousObjects.get(object.id);
      if (!original) return object;
      if (object.readingOrder !== undefined && object.readingOrder !== original.readingOrder && object.readingOrder !== index)
        refuse("PPTX_OBJECT_ORDER_INTENT_UNMODELED", "The requested native reading order must match the authored object list order.");
      return original.readingOrder === undefined ? object : { ...object, readingOrder: index };
    });
    return { ...slide, objects, text: coversText ? nextText : slide.text, title: coversTitle ? nextTitle : slide.title };
  }) };
}

/** Shared native readback content; transition is a primary authored field. */
export function pptxSemanticContent(projection: Pick<PptxProjection, "slides"> & Partial<Pick<PptxProjection, "nativeBinding">>) {
  return projection.slides.map(({ id, title, text, objects, hidden, speakerNotes, transition }: PptxSlideProjection) => ({ id, title, text, objects: projection.nativeBinding ? objects.map((object, index) => pptxImageReadbackObject(object, index, projection.nativeBinding!)) : objects, hidden, speakerNotes, ...(transition ? { transition } : {}) }));
}
