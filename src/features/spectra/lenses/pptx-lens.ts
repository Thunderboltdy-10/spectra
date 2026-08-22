import { Presentation, DRAWINGML_NAMESPACE, PML_NAMESPACE } from "@ariadng/office/pptx";
import { comparePackages } from "@ariadng/office/preservation";
import { XmlElement, XmlText } from "@ariadng/office/xml";
import type { PresentationObject } from "../presentation/model";
import { sha256Payload } from "./docx-lens";
import type { LensCapabilitySet, LensCompatibilityProfile, LensExternalDiff, LensFidelityEntry, LensFidelityMap, LensOpenResult, LensPreservedCarry, SpectraLens } from "./types";

export type PptxSlideProjection = { id: string; index: number; title: string; text: string[]; objects: PresentationObject[]; layoutPartName?: string; hasTransition: boolean; hasTiming: boolean };
export type PptxProjection = { slides: PptxSlideProjection[]; nativeBinding: { version: 1; format: "pptx" | "pptm" | "potx" | "potm" | "ppsx" | "ppsm" | "ppam"; profile: LensCompatibilityProfile; macroEnabled: boolean; semanticDigest: string } };
export type PptxSemanticDelta =
  | { kind: "set-title"; slideId: string; text: string }
  | { kind: "set-text"; slideId: string; paragraphIndex: number; text: string; shapeId?: string }
  | { kind: "add-text-box"; slideId: string; text: string }
  | { kind: "ai-edit"; operations: Exclude<PptxSemanticDelta, { kind: "ai-edit" }>[] };

export class PptxLensError extends Error { constructor(public readonly code: string, message: string) { super(message); this.name = "PptxLensError"; } }

function descendants(root: XmlElement): XmlElement[] { const result: XmlElement[] = []; const pending = [...root.elements()].reverse(); while (pending.length) { const child = pending.pop()!; result.push(child); const nested = child.elements(); for (let index = nested.length - 1; index >= 0; index -= 1) pending.push(nested[index]!); } return result; }
function semanticNode(root: XmlElement, localName: string) { return descendants(root).find((node) => node.namespaceUri() === PML_NAMESPACE && node.localName === localName); }
function firstText(root: XmlElement) { return descendants(root).find((node) => node.namespaceUri() === DRAWINGML_NAMESPACE && node.localName === "t")?.text() ?? ""; }
function textNodes(root: XmlElement) { return descendants(root).filter((node) => node.namespaceUri() === DRAWINGML_NAMESPACE && node.localName === "t"); }
function titleShape(root: XmlElement) { return descendants(root).find((node) => node.namespaceUri() === PML_NAMESPACE && node.localName === "sp" && descendants(node).some((child) => child.namespaceUri() === PML_NAMESPACE && child.localName === "ph" && ["title", "ctrTitle"].includes(child.getAttribute("type") ?? ""))); }
function firstDescendant(root: XmlElement, namespace: string, localName: string) { return descendants(root).find((node) => node.namespaceUri() === namespace && node.localName === localName); }
function shapeId(root: XmlElement) { return firstDescendant(root, PML_NAMESPACE, "cNvPr")?.getAttribute("id") ?? undefined; }
function shapeText(root: XmlElement) { return textNodes(root).map((node) => node.text()).join(" ").trim(); }
function emu(value: string | undefined, fallback = 0) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; }
function placeholderKey(root: XmlElement) {
  const placeholder = firstDescendant(root, PML_NAMESPACE, "ph");
  if (!placeholder) return undefined;
  return `${placeholder.getAttribute("type") ?? "body"}:${placeholder.getAttribute("idx") ?? "0"}`;
}
function shapeGeometry(root: XmlElement, fallback?: XmlElement) {
  const xfrm = firstDescendant(root, DRAWINGML_NAMESPACE, "xfrm");
  const source = xfrm ? root : fallback;
  const sourceXfrm = source ? firstDescendant(source, DRAWINGML_NAMESPACE, "xfrm") : undefined;
  const off = sourceXfrm ? firstDescendant(sourceXfrm, DRAWINGML_NAMESPACE, "off") : undefined;
  const ext = sourceXfrm ? firstDescendant(sourceXfrm, DRAWINGML_NAMESPACE, "ext") : undefined;
  return {
    x: Math.max(0, Math.min(1000, (emu(off?.getAttribute("x")) / 12192000) * 1000)),
    y: Math.max(0, Math.min(562.5, (emu(off?.getAttribute("y")) / 6858000) * 562.5)),
    width: Math.max(10, Math.min(1000, (emu(ext?.getAttribute("cx"), 914400) / 12192000) * 1000)),
    height: Math.max(10, Math.min(562.5, (emu(ext?.getAttribute("cy"), 457200) / 6858000) * 562.5)),
    rotation: emu(sourceXfrm?.getAttribute("rot")) / 60000,
  };
}
function slideObjects(root: XmlElement, slideId: string, layoutRoot?: XmlElement): PresentationObject[] {
  const layoutPlaceholders = new Map<string, XmlElement>();
  if (layoutRoot) descendants(layoutRoot).filter((node) => node.namespaceUri() === PML_NAMESPACE && node.localName === "sp").forEach((shape) => {
    const key = placeholderKey(shape);
    if (key) layoutPlaceholders.set(key, shape);
  });
  return descendants(root).filter((node) => node.namespaceUri() === PML_NAMESPACE && ["sp", "pic", "graphicFrame"].includes(node.localName)).flatMap((shape, index) => {
    const nativeShapeId = shapeId(shape);
    if (!nativeShapeId) return [];
    const placeholder = firstDescendant(shape, PML_NAMESPACE, "ph");
    const isTitle = ["title", "ctrTitle"].includes(placeholder?.getAttribute("type") ?? "");
    const type = shape.localName === "pic" ? "image" : shape.localName === "graphicFrame" ? (descendants(shape).some((node) => node.localName === "chart") ? "chart" : "table") : "text";
    return [{ id: `${slideId}:shape:${nativeShapeId}`, type, ...shapeGeometry(shape, layoutPlaceholders.get(placeholderKey(shape) ?? "")), content: { text: shapeText(shape), nativeShapeId, nativeParagraphIndex: 0 }, locked: isTitle, readingOrder: index } satisfies PresentationObject];
  });
}

async function projectPresentation(deck: Presentation, profile: LensCompatibilityProfile) {
  const entries: LensFidelityEntry[] = [];
  const slides = await Promise.all(deck.slides().map(async (slide, index) => {
    const root = slide.root();
    const transition = semanticNode(root, "transition");
    const timing = semanticNode(root, "timing");
    const title = titleShape(root);
    const id = `pptx:slide:${slide.partName}`;
    entries.push({ regionId: id, feature: "slide", class: "NATIVE", partName: slide.partName });
    if (transition) entries.push({ regionId: `${id}:transition`, feature: "transition", class: "PRESERVED", partName: slide.partName, readOnly: true, reason: "This PowerPoint transition is preserved. Editing it requires an exact native equivalent." });
    if (timing) entries.push({ regionId: `${id}:animation`, feature: "animation", class: "PRESERVED", partName: slide.partName, readOnly: true });
    const layoutRoot = slide.layoutPartName ? (await deck.office.xml(slide.layoutPartName)).root : undefined;
    return { id, index, title: title ? firstText(title) : (slide.text()[0] ?? ""), text: [...slide.text()], objects: slideObjects(root, id, layoutRoot), ...(slide.layoutPartName ? { layoutPartName: slide.layoutPartName } : {}), hasTransition: Boolean(transition), hasTiming: Boolean(timing) };
  }));
  const partNames = deck.office.package.parts().map((part) => part.name);
  for (const [feature, pattern] of [["master", /\/slideMasters\//i], ["layout", /\/slideLayouts\//i], ["media", /\/media\//i], ["smartArt", /\/diagrams\//i], ["chart", /\/charts\//i], ["notes", /\/notesSlides\//i], ["unknown-extension", /unknown|future|extension/i]] as const) {
    const partName = partNames.find((name) => pattern.test(name));
    if (partName) entries.push({ regionId: `pptx:feature:${feature}`, feature, class: feature === "notes" ? "EQUIVALENT" : "PRESERVED", partName, ...(feature === "notes" ? {} : { readOnly: true }) });
  }
  const fidelityMap: LensFidelityMap = { version: 1, profile, entries };
  const semanticDigest = await sha256Payload(new TextEncoder().encode(JSON.stringify(slides.map(({ id, title, text, objects }) => ({ id, title, text, objects })))));
  const projection: PptxProjection = { slides, nativeBinding: { version: 1, format: deck.office.format.extension as PptxProjection["nativeBinding"]["format"], profile, macroEnabled: deck.office.format.macroEnabled, semanticDigest } };
  return { projection, fidelityMap };
}

function slideFor(deck: Presentation, slideId: string) { const partName = slideId.replace(/^pptx:slide:/, ""); const slide = deck.slides().find((candidate) => candidate.partName === partName); if (!slide) throw new PptxLensError("PPTX_SLIDE_MISSING", "The target PowerPoint slide no longer exists."); return slide; }
function replaceNodeText(node: XmlElement, text: string) { node._children.slice().forEach((child) => node.removeChild(child)); node.appendChild(new XmlText(text)); }
function addTextBox(root: XmlElement, text: string) {
  const spTree = descendants(root).find((node) => node.namespaceUri() === PML_NAMESPACE && node.localName === "spTree");
  if (!spTree) throw new PptxLensError("PPTX_SHAPE_TREE_MISSING", "The slide has no editable shape tree.");
  const ids = descendants(spTree).filter((node) => node.localName === "cNvPr").map((node) => Number(node.getAttribute("id") ?? 0));
  const id = Math.max(1, ...ids) + 1;
  const sp = new XmlElement("sp", "p");
  const nvSpPr = new XmlElement("nvSpPr", "p"); const cNvPr = new XmlElement("cNvPr", "p"); cNvPr.setAttribute("id", String(id)); cNvPr.setAttribute("name", `Spectra Text ${id}`); nvSpPr.appendChild(cNvPr); nvSpPr.appendChild(new XmlElement("cNvSpPr", "p")); nvSpPr.appendChild(new XmlElement("nvPr", "p"));
  const spPr = new XmlElement("spPr", "p"); const xfrm = new XmlElement("xfrm", "a"); const off = new XmlElement("off", "a"); off.setAttribute("x", "914400"); off.setAttribute("y", "4572000"); const ext = new XmlElement("ext", "a"); ext.setAttribute("cx", "7315200"); ext.setAttribute("cy", "685800"); xfrm.appendChild(off); xfrm.appendChild(ext); spPr.appendChild(xfrm); const geom = new XmlElement("prstGeom", "a"); geom.setAttribute("prst", "rect"); geom.appendChild(new XmlElement("avLst", "a")); spPr.appendChild(geom); sp.appendChild(nvSpPr); sp.appendChild(spPr);
  const txBody = new XmlElement("txBody", "p"); txBody.appendChild(new XmlElement("bodyPr", "a")); txBody.appendChild(new XmlElement("lstStyle", "a")); const p = new XmlElement("p", "a"); const r = new XmlElement("r", "a"); r.appendChild(new XmlElement("rPr", "a")); const t = new XmlElement("t", "a"); t.appendChild(new XmlText(text)); r.appendChild(t); p.appendChild(r); p.appendChild(new XmlElement("endParaRPr", "a")); txBody.appendChild(p); sp.appendChild(txBody); spTree.appendChild(sp);
}

async function applyDelta(carry: LensPreservedCarry<PptxProjection>, delta: PptxSemanticDelta) {
  const deck = await Presentation.open(carry.payload); const operations = delta.kind === "ai-edit" ? delta.operations : [delta];
  for (const operation of operations) { const slide = slideFor(deck, operation.slideId);
    if (operation.kind === "set-title") slide.setTitle(operation.text);
    else if (operation.kind === "set-text") { const owner = operation.shapeId ? descendants(slide.root()).find((node) => node.namespaceUri() === PML_NAMESPACE && ["sp", "pic", "graphicFrame"].includes(node.localName) && shapeId(node) === operation.shapeId) : undefined; const nodes = owner ? textNodes(owner) : textNodes(slide.root()); const node = nodes[operation.paragraphIndex]; if (!node) throw new PptxLensError("PPTX_TEXT_MISSING", "The target PowerPoint text run no longer exists."); replaceNodeText(node, operation.text); deck.office.markDirty(slide.partName); }
    else { addTextBox(slide.root(), operation.text); deck.office.markDirty(slide.partName); }
  }
  return deck.save();
}

export const pptxLens: SpectraLens<PptxProjection, PptxSemanticDelta> = {
  format: "pptx",
  async open(payload, profile = "strict-native"): Promise<LensOpenResult<PptxProjection>> { let deck: Presentation; try { deck = await Presentation.open(payload); } catch (error) { throw new PptxLensError("PPTX_CORRUPT", `This PowerPoint package could not be opened safely.${error instanceof Error ? ` (${error.message})` : ""}`); } const { projection, fidelityMap } = await projectPresentation(deck, profile); return { projection, fidelityMap, preservedCarry: { version: 1, format: projection.nativeBinding.format, profile, basePayloadHash: await sha256Payload(payload), payload, projection }, capabilities: this.capabilities(profile, fidelityMap) }; },
  mutate: applyDelta,
  async materialize({ projection, carry }) { const previous = new Map(carry.projection.slides.map((slide) => [slide.id, slide])); const operations: Exclude<PptxSemanticDelta, { kind: "ai-edit" }>[] = []; for (const slide of projection.slides) { const old = previous.get(slide.id); if (!old) throw new PptxLensError("PPTX_SLIDE_ADD_REQUIRES_LAYOUT", "Adding a mounted PowerPoint slide requires an explicit existing layout selection."); if (slide.title !== old.title) operations.push({ kind: "set-title", slideId: slide.id, text: slide.title }); const oldObjects = new Map(old.objects.map((object) => [object.id, object])); slide.objects.forEach((object) => { const previousObject = oldObjects.get(object.id); const nextText = typeof (object.content as { text?: unknown })?.text === "string" ? String((object.content as { text: string }).text) : ""; if (!previousObject) { if (object.type === "text" && nextText) operations.push({ kind: "add-text-box", slideId: slide.id, text: nextText }); return; } const previousValue = previousObject.content as { text?: unknown } | undefined; const previousText = typeof previousValue?.text === "string" ? previousValue.text : ""; const nativeShapeId = typeof (object.content as { nativeShapeId?: unknown })?.nativeShapeId === "string" ? String((object.content as { nativeShapeId: string }).nativeShapeId) : undefined; if (nativeShapeId && nextText !== previousText && !object.locked) operations.push({ kind: "set-text", slideId: slide.id, paragraphIndex: 0, shapeId: nativeShapeId, text: nextText }); }); } return operations.length ? applyDelta(carry, { kind: "ai-edit", operations }) : carry.payload; },
  async diffExternal(payloadA, payloadB): Promise<LensExternalDiff> { const [before, after, comparison] = await Promise.all([this.open(payloadA), this.open(payloadB), comparePackages(payloadA, payloadB)]); const previous = new Map(before.projection.slides.map((slide) => [slide.id, slide])); const changes: LensExternalDiff["changes"] = []; for (const slide of after.projection.slides) { const old = previous.get(slide.id); previous.delete(slide.id); if (!old) changes.push({ regionId: slide.id, kind: "insert", after: slide }); else if (JSON.stringify(old) !== JSON.stringify(slide)) changes.push({ regionId: slide.id, kind: "update", before: old, after: slide }); } for (const slide of previous.values()) changes.push({ regionId: slide.id, kind: "delete", before: slide }); const changedParts = comparison.parts.filter((part) => part.verdict !== "identical").map((part) => `/${part.name}`); const modeled = new Set(after.projection.slides.map((slide) => slide.id.replace(/^pptx:slide:/, ""))); const preservedPartChanges = changedParts.filter((part) => !modeled.has(part)); return { changes, changedParts, preservedPartChanges }; },
  capabilities(profile, fidelityMap): LensCapabilitySet { const strict = profile === "strict-native"; const hasTransition = fidelityMap.entries.some((entry) => entry.feature === "transition"); return { profile, human: [{ id: "edit-slide-title", available: true }, { id: "edit-slide-text", available: true }, { id: "add-basic-text-box", available: true }, { id: "edit-native-transition", available: hasTransition, reason: hasTransition ? "Only exact PowerPoint transition equivalents may replace the preserved transition." : "No native transition is present." }, strict ? { id: "apply-spectra-only-transition", available: false, reason: "This transition has no exact PowerPoint representation in strict native mode." } : { id: "apply-spectra-only-transition", available: true }], aiOperations: ["set_slide_title", "set_slide_text", "add_text_box"] }; },
};
