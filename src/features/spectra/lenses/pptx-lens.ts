import { Presentation, DRAWINGML_NAMESPACE, PML_NAMESPACE } from "@ariadng/office/pptx";
import { resolveRelationshipTarget } from "@ariadng/office/opc";
import { comparePackages } from "@ariadng/office/preservation";
import { XmlElement, XmlText } from "@ariadng/office/xml";
import type { PresentationObject } from "../presentation/model";
import { sha256Payload } from "./docx-lens";
import type { LensCapabilitySet, LensCompatibilityProfile, LensExternalDiff, LensFidelityEntry, LensFidelityMap, LensOpenResult, LensPreservedCarry, SpectraLens } from "./types";

export type PptxSlideProjection = { id: string; index: number; title: string; text: string[]; objects: PresentationObject[]; layoutPartName?: string; hasTransition: boolean; hasTiming: boolean; speakerNotes: string; notesPartName?: string };
export type PptxProjection = { slides: PptxSlideProjection[]; nativeBinding: { version: 1; format: "pptx" | "pptm" | "potx" | "potm" | "ppsx" | "ppsm" | "ppam"; profile: LensCompatibilityProfile; macroEnabled: boolean; semanticDigest: string } };
export type PptxSemanticDelta =
  | { kind: "set-title"; slideId: string; text: string }
  | { kind: "set-text"; slideId: string; paragraphIndex: number; text: string; shapeId?: string }
  | { kind: "add-text-box"; slideId: string; text: string }
  | { kind: "set-notes"; slideId: string; text: string }
  | { kind: "set-alt-text"; slideId: string; shapeId: string; text: string }
  | { kind: "set-geometry"; slideId: string; shapeId: string; x: number; y: number; width: number; height: number; rotation: number }
  /** A brand-new slide. `slideId` is the caller's own id for it, so later
   *  operations in the same delta can still name the slide before it has a
   *  part; the layout is an existing layout of this file, never an invented one. */
  | { kind: "add-slide"; slideId: string; layoutPartName?: string; title?: string; text?: string[] }
  | { kind: "remove-slide"; slideId: string }
  /** The final deck order, by slide id. Ids of slides added in the same delta
   *  are allowed, because the order a person sees includes them. */
  | { kind: "reorder-slides"; order: string[] }
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
    // `descr` is PowerPoint's own alt text, so reading it here is what lets a
    // Spectra description round-trip instead of being invented alongside one.
    const descr = firstDescendant(shape, PML_NAMESPACE, "cNvPr")?.getAttribute("descr")?.trim();
    return [{ id: `${slideId}:shape:${nativeShapeId}`, type, ...shapeGeometry(shape, layoutPlaceholders.get(placeholderKey(shape) ?? "")), content: { text: shapeText(shape), nativeShapeId, nativeParagraphIndex: 0 }, ...(descr ? { altText: descr } : {}), locked: isTitle, readingOrder: index } satisfies PresentationObject];
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
    const notesPartName = notesPartNameFor(deck, slide.partName);
    const speakerNotes = notesPartName ? notesText((await deck.office.xml(notesPartName)).root) : "";
    return { id, index, title: title ? firstText(title) : (slide.text()[0] ?? ""), text: [...slide.text()], objects: slideObjects(root, id, layoutRoot), ...(slide.layoutPartName ? { layoutPartName: slide.layoutPartName } : {}), hasTransition: Boolean(transition), hasTiming: Boolean(timing), speakerNotes, ...(notesPartName ? { notesPartName } : {}) };
  }));
  const partNames = deck.office.package.parts().map((part) => part.name);
  for (const [feature, pattern] of [["master", /\/slideMasters\//i], ["layout", /\/slideLayouts\//i], ["media", /\/media\//i], ["smartArt", /\/diagrams\//i], ["chart", /\/charts\//i], ["notes", /\/notesSlides\//i], ["unknown-extension", /unknown|future|extension/i]] as const) {
    const partName = partNames.find((name) => pattern.test(name));
    if (partName) entries.push({ regionId: `pptx:feature:${feature}`, feature, class: feature === "notes" ? "EQUIVALENT" : "PRESERVED", partName, ...(feature === "notes" ? {} : { readOnly: true }) });
  }
  const fidelityMap: LensFidelityMap = { version: 1, profile, entries };
  // A second pass, keyed the way the command registry keys its `touches`
  // declarations. The entries above are what the harness and the capability
  // report read; these are what decide whether a control in the bar is live, so
  // both have to exist and they have to agree.
  //
  // Every class here is one of the four the contract defines. There is no
  // UNSUPPORTED row: a fifth name would be dropped by every reader on the way
  // to the bar, so the reason would never be shown and the control would look
  // live. A deck with no notes page is EXTENSION — Spectra holds the note on its
  // own side, honestly, and `nativeCompatibility.speakerNotes` is what tells the
  // studio that writing it cannot reach the file.
  const hasNotesPage = slides.some((slide) => slide.notesPartName);
  const regionClasses: Array<[string, LensFidelityEntry["class"], string?]> = [
    ["slides", "NATIVE"],
    ["shapes", "NATIVE"],
    [
      "speakerNotes",
      hasNotesPage ? "EQUIVALENT" : "EXTENSION",
      hasNotesPage
        ? undefined
        : "This file has no notes page, so Spectra keeps speaker notes on its own side rather than writing them into the deck.",
    ],
    ["transitions", slides.some((slide) => slide.hasTransition) ? "PRESERVED" : "NATIVE", "PowerPoint saved these transitions and Spectra preserves them exactly."],
    ["animations", slides.some((slide) => slide.hasTiming) ? "PRESERVED" : "NATIVE", "PowerPoint animation timing is preserved exactly rather than approximated."],
    ["masters", partNames.some((name) => /\/slideMasters\//i.test(name)) ? "PRESERVED" : "NATIVE", "Slide masters are preserved exactly as PowerPoint saved them."],
    ["layouts", partNames.some((name) => /\/slideLayouts\//i.test(name)) ? "PRESERVED" : "NATIVE", "Slide layouts come from this file's own masters and are preserved."],
    ["media", partNames.some((name) => /\/media\//i.test(name)) ? "PRESERVED" : "NATIVE", "Media parts are copied through byte for byte."],
    ["images", partNames.some((name) => /\/media\//i.test(name)) ? "PRESERVED" : "NATIVE", "Pictures keep the bytes and cropping PowerPoint saved."],
    ["charts", partNames.some((name) => /\/charts\//i.test(name)) ? "PRESERVED" : "NATIVE", "Charts keep their own cached data and workbook."],
    ["tables", "PRESERVED", "Tables are preserved as the graphic frames PowerPoint wrote."],
    ["ole", partNames.some((name) => /\/embeddings\//i.test(name)) ? "PRESERVED" : "NATIVE", "Embedded objects are preserved untouched."],
    ["smartArt", partNames.some((name) => /\/diagrams\//i.test(name)) ? "PRESERVED" : "NATIVE", "SmartArt diagrams are preserved untouched."],
    ["equations", "PRESERVED", "Equations already in the file are preserved; Spectra does not author new ones."],
  ];
  for (const [feature, cls, reason] of regionClasses) {
    entries.push({ regionId: `pptx:region:${feature}`, feature, class: cls, ...(cls === "PRESERVED" ? { readOnly: true } : {}), ...(reason && cls !== "NATIVE" ? { reason } : {}) });
  }
  const semanticDigest = await sha256Payload(new TextEncoder().encode(JSON.stringify(slides.map(({ id, title, text, objects }) => ({ id, title, text, objects })))));
  const projection: PptxProjection = { slides, nativeBinding: { version: 1, format: deck.office.format.extension as PptxProjection["nativeBinding"]["format"], profile, macroEnabled: deck.office.format.macroEnabled, semanticDigest } };
  return { projection, fidelityMap };
}

function slideFor(deck: Presentation, slideId: string) { const partName = slideId.replace(/^pptx:slide:/, ""); const slide = deck.slides().find((candidate) => candidate.partName === partName); if (!slide) throw new PptxLensError("PPTX_SLIDE_MISSING", "The target PowerPoint slide no longer exists."); return slide; }

const NOTES_SLIDE_RELATIONSHIP = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide";

/**
 * The notes page a slide points at, resolved through its own relationship
 * rather than guessed from the slide number: PowerPoint numbers notes parts
 * independently, so `slide7.xml` does not always mean `notesSlide7.xml`.
 */
function notesPartNameFor(deck: Presentation, slidePartName: string) {
  const part = deck.office.package.getPart(slidePartName);
  const relationship = part?.relationships().byType(NOTES_SLIDE_RELATIONSHIP)[0];
  if (!relationship || relationship.targetMode === "External") return undefined;
  return resolveRelationshipTarget(slidePartName, relationship.target);
}

/** The body placeholder of a notes page, which is where the speaking goes. */
function notesBody(root: XmlElement) {
  return descendants(root).find((node) =>
    node.namespaceUri() === PML_NAMESPACE &&
    node.localName === "sp" &&
    descendants(node).some((child) => child.namespaceUri() === PML_NAMESPACE && child.localName === "ph" && (child.getAttribute("type") ?? "body") === "body"));
}

function notesText(root: XmlElement) {
  const body = notesBody(root);
  if (!body) return "";
  const txBody = firstDescendant(body, PML_NAMESPACE, "txBody");
  if (!txBody) return "";
  return txBody.elements()
    .filter((node) => node.namespaceUri() === DRAWINGML_NAMESPACE && node.localName === "p")
    .map((paragraph) => textNodes(paragraph).map((node) => node.text()).join(""))
    .join("\n")
    .trim();
}

/**
 * Writes speaker notes into the notes page, one DrawingML paragraph per line,
 * reusing the run properties PowerPoint already had so the notes keep the type
 * they were written in. Only the notes part is touched.
 */
function setNotesText(root: XmlElement, text: string) {
  const body = notesBody(root);
  if (!body) throw new PptxLensError("PPTX_NOTES_BODY_MISSING", "This slide's notes page has no body placeholder to write into.");
  const txBody = firstDescendant(body, PML_NAMESPACE, "txBody");
  if (!txBody) throw new PptxLensError("PPTX_NOTES_BODY_MISSING", "This slide's notes page has no notes text body.");
  const existing = txBody.elements().filter((node) => node.namespaceUri() === DRAWINGML_NAMESPACE && node.localName === "p");
  const templateRun = existing.length ? firstDescendant(existing[0]!, DRAWINGML_NAMESPACE, "r") : undefined;
  const templateProps = templateRun ? firstDescendant(templateRun, DRAWINGML_NAMESPACE, "rPr") : undefined;
  const templateParagraphProps = existing.length ? firstDescendant(existing[0]!, DRAWINGML_NAMESPACE, "pPr") : undefined;
  existing.forEach((paragraph) => txBody.removeChild(paragraph));
  for (const line of text.split(/\r?\n/)) {
    const p = new XmlElement("p", "a");
    if (templateParagraphProps) p.appendChild(templateParagraphProps.clone());
    const r = new XmlElement("r", "a");
    r.appendChild(templateProps ? templateProps.clone() : new XmlElement("rPr", "a"));
    const t = new XmlElement("t", "a");
    t.appendChild(new XmlText(line));
    r.appendChild(t);
    p.appendChild(r);
    txBody.appendChild(p);
  }
}

function shapeIn(root: XmlElement, id: string) {
  return descendants(root).find((node) => node.namespaceUri() === PML_NAMESPACE && ["sp", "pic", "graphicFrame"].includes(node.localName) && shapeId(node) === id);
}

/** PowerPoint's own alt text lives on `p:cNvPr/@descr`, so that is what moves. */
function setAltText(shape: XmlElement, text: string) {
  const cNvPr = firstDescendant(shape, PML_NAMESPACE, "cNvPr");
  if (!cNvPr) throw new PptxLensError("PPTX_SHAPE_PROPS_MISSING", "This shape has no non-visual properties to describe.");
  if (text.trim()) cNvPr.setAttribute("descr", text.trim().slice(0, 500));
  else cNvPr.removeAttribute("descr");
}

/**
 * Moves and resizes a shape by writing its own `a:xfrm`, in EMU, on the shape
 * rather than anywhere shared. A placeholder that inherited its geometry from a
 * layout gets an explicit `a:xfrm` the first time it is moved, which is exactly
 * what PowerPoint itself writes in that case.
 */
function setShapeGeometry(shape: XmlElement, geometry: { x: number; y: number; width: number; height: number; rotation: number }) {
  const container = shape.localName === "graphicFrame"
    ? firstDescendant(shape, PML_NAMESPACE, "xfrm") ?? shape
    : firstDescendant(shape, PML_NAMESPACE, "spPr") ?? firstDescendant(shape, PML_NAMESPACE, "grpSpPr");
  if (!container) throw new PptxLensError("PPTX_SHAPE_PROPS_MISSING", "This shape has no properties element to hold its position.");
  let xfrm = container.namespaceUri() === PML_NAMESPACE && container.localName === "xfrm"
    ? container
    : firstDescendant(container, DRAWINGML_NAMESPACE, "xfrm");
  if (!xfrm) {
    xfrm = new XmlElement("xfrm", "a");
    container.insertBefore(xfrm, container.elements()[0] ?? null);
  }
  let off = firstDescendant(xfrm, DRAWINGML_NAMESPACE, "off");
  if (!off) { off = new XmlElement("off", "a"); xfrm.insertBefore(off, xfrm.elements()[0] ?? null); }
  let ext = firstDescendant(xfrm, DRAWINGML_NAMESPACE, "ext");
  if (!ext) { ext = new XmlElement("ext", "a"); xfrm.appendChild(ext); }
  off.setAttribute("x", String(Math.round((geometry.x / 1000) * 12192000)));
  off.setAttribute("y", String(Math.round((geometry.y / 562.5) * 6858000)));
  ext.setAttribute("cx", String(Math.max(1, Math.round((geometry.width / 1000) * 12192000))));
  ext.setAttribute("cy", String(Math.max(1, Math.round((geometry.height / 562.5) * 6858000))));
  const rotation = Math.round(geometry.rotation * 60000);
  if (rotation) xfrm.setAttribute("rot", String(rotation));
  else xfrm.removeAttribute("rot");
}

/**
 * Put the deck in a given order by moving `p:sldId` entries inside
 * `p:sldIdLst`. Reordering is a presentation-level fact, so only
 * presentation.xml is touched: every slide part, with its transition, its
 * timing and its media, is still raw-copied at save.
 */
async function reorderSlides(deck: Presentation, partNames: string[]) {
  const refs = new Map(deck._slideRefs().map((ref) => [ref.partName, ref.el]));
  const wanted = partNames.map((partName) => refs.get(partName)).filter((element): element is XmlElement => Boolean(element));
  if (wanted.length !== refs.size) throw new PptxLensError("PPTX_REORDER_INCOMPLETE", "A slide order has to name every slide in the deck exactly once.");
  const presentation = await deck.office.xml("/ppt/presentation.xml");
  const list = firstDescendant(presentation.root, PML_NAMESPACE, "sldIdLst");
  if (!list) throw new PptxLensError("PPTX_SLDIDLST_MISSING", "This file has no slide list, so its order cannot be changed.");
  const current = list.elements().filter((node) => node.namespaceUri() === PML_NAMESPACE && node.localName === "sldId");
  if (current.length === wanted.length && current.every((node, index) => node === wanted[index])) return;
  for (const node of current) list.removeChild(node);
  for (const node of wanted) list.appendChild(node);
  deck.office.markDirty("/ppt/presentation.xml");
}

/**
 * Add a slide on an existing layout of this file. The layout is chosen from the
 * deck's own `layouts()` — Spectra never writes a new master or layout, which is
 * why masters stay preserved even when the deck grows.
 */
function addNativeSlide(deck: Presentation, layoutPartName: string | undefined, title: string | undefined, text: string[] | undefined) {
  const layouts = deck.layouts();
  const layoutIndex = layoutPartName ? layouts.indexOf(layoutPartName) : -1;
  const slide = deck.addSlide(layoutIndex >= 0 ? { layoutPartName } : layouts.length ? { layoutIndex: 0 } : {});
  if (title) {
    // A layout without a title placeholder is a real layout, so a missing title
    // becomes a text box rather than an error a person cannot act on.
    try {
      slide.setTitle(title);
    } catch {
      addTextBox(slide.root(), title);
      deck.office.markDirty(slide.partName);
    }
  }
  for (const line of text ?? []) if (line.trim()) { addTextBox(slide.root(), line); deck.office.markDirty(slide.partName); }
  return slide;
}

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
  // A slide added in this delta has no part until it exists, so its caller-side
  // id is mapped to the real one and every later operation in the same delta —
  // including the order — can still name it.
  const born = new Map<string, string>();
  const resolveSlideId = (slideId: string) => born.get(slideId) ?? slideId;
  for (const operation of operations) {
    if (operation.kind === "add-slide") {
      const slide = addNativeSlide(deck, operation.layoutPartName, operation.title, operation.text);
      born.set(operation.slideId, `pptx:slide:${slide.partName}`);
      continue;
    }
    if (operation.kind === "remove-slide") {
      const index = slideFor(deck, resolveSlideId(operation.slideId)).index;
      if (index < 0) throw new PptxLensError("PPTX_SLIDE_MISSING", "The slide being removed is no longer in this deck.");
      // The library deletes the slide part, its .rels, its content-type
      // override and its own notes page, and leaves shared targets — layouts,
      // masters, media — exactly where they were.
      deck.removeSlide(index);
      continue;
    }
    if (operation.kind === "reorder-slides") {
      await reorderSlides(deck, operation.order.map((id) => resolveSlideId(id).replace(/^pptx:slide:/, "")));
      continue;
    }
    const slide = slideFor(deck, resolveSlideId(operation.slideId));
    if (operation.kind === "set-title") slide.setTitle(operation.text);
    else if (operation.kind === "set-text") { const owner = operation.shapeId ? descendants(slide.root()).find((node) => node.namespaceUri() === PML_NAMESPACE && ["sp", "pic", "graphicFrame"].includes(node.localName) && shapeId(node) === operation.shapeId) : undefined; const nodes = owner ? textNodes(owner) : textNodes(slide.root()); const node = nodes[operation.paragraphIndex]; if (!node) throw new PptxLensError("PPTX_TEXT_MISSING", "The target PowerPoint text run no longer exists."); replaceNodeText(node, operation.text); deck.office.markDirty(slide.partName); }
    else if (operation.kind === "set-notes") {
      // Only the notes part is marked dirty, so the slide itself — with its
      // transition, its timing and everything Spectra does not model — is still
      // raw-copied at save.
      const notesPartName = notesPartNameFor(deck, slide.partName);
      if (!notesPartName) throw new PptxLensError("PPTX_NOTES_PART_MISSING", "This slide has no notes page in the file, and Spectra does not add one yet.");
      setNotesText((await deck.office.xml(notesPartName)).root, operation.text);
      deck.office.markDirty(notesPartName);
    }
    else if (operation.kind === "set-alt-text") {
      const shape = shapeIn(slide.root(), operation.shapeId);
      if (!shape) throw new PptxLensError("PPTX_SHAPE_MISSING", "The shape being described no longer exists on this slide.");
      setAltText(shape, operation.text);
      deck.office.markDirty(slide.partName);
    }
    else if (operation.kind === "set-geometry") {
      const shape = shapeIn(slide.root(), operation.shapeId);
      if (!shape) throw new PptxLensError("PPTX_SHAPE_MISSING", "The shape being moved no longer exists on this slide.");
      setShapeGeometry(shape, operation);
      deck.office.markDirty(slide.partName);
    }
    else { addTextBox(slide.root(), operation.text); deck.office.markDirty(slide.partName); }
  }
  return deck.save();
}

export const pptxLens: SpectraLens<PptxProjection, PptxSemanticDelta> = {
  format: "pptx",
  async open(payload, profile = "strict-native"): Promise<LensOpenResult<PptxProjection>> { let deck: Presentation; try { deck = await Presentation.open(payload); } catch (error) { throw new PptxLensError("PPTX_CORRUPT", `This PowerPoint package could not be opened safely.${error instanceof Error ? ` (${error.message})` : ""}`); } const { projection, fidelityMap } = await projectPresentation(deck, profile); return { projection, fidelityMap, preservedCarry: { version: 1, format: projection.nativeBinding.format, profile, basePayloadHash: await sha256Payload(payload), payload, projection }, capabilities: this.capabilities(profile, fidelityMap) }; },
  mutate: applyDelta,
  async materialize({ projection, carry }) { const previous = new Map(carry.projection.slides.map((slide) => [slide.id, slide])); const operations: Exclude<PptxSemanticDelta, { kind: "ai-edit" }>[] = [];
    // Slides the person deleted go first, so the adds and the final order are
    // computed against the deck that is actually left.
    const kept = new Set(projection.slides.map((slide) => slide.id));
    for (const old of carry.projection.slides) if (!kept.has(old.id)) operations.push({ kind: "remove-slide", slideId: old.id });
    /** The layout a new slide should inherit: the nearest existing slide above
     *  it, falling back to the deck's first layout. Spectra never writes a new
     *  layout or master, so a growing deck leaves both preserved. */
    const layoutForNewSlideAt = (index: number) => {
      for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
        const candidate = previous.get(projection.slides[cursor]!.id);
        if (candidate?.layoutPartName) return candidate.layoutPartName;
      }
      return carry.projection.slides.find((slide) => slide.layoutPartName)?.layoutPartName;
    };
    projection.slides.forEach((slide, slideIndex) => { const old = previous.get(slide.id);
      if (!old) {
        // A new slide carries its title and its text in one operation: the title
        // goes into the layout's own title placeholder, and the rest become text
        // boxes, so the slide a person gets back is the slide they built.
        const lines = slide.objects.filter((object) => object.type === "text").map((object) => { const value = object.content as { text?: unknown } | undefined; return typeof value?.text === "string" ? value.text : ""; }).filter((line) => line.trim() && line.trim() !== slide.title.trim());
        operations.push({ kind: "add-slide", slideId: slide.id, ...(layoutForNewSlideAt(slideIndex) ? { layoutPartName: layoutForNewSlideAt(slideIndex) } : {}), ...(slide.title ? { title: slide.title } : {}), ...(lines.length ? { text: lines } : {}) });
        return;
      }
      if (slide.title !== old.title) operations.push({ kind: "set-title", slideId: slide.id, text: slide.title });
    // Notes are written only when the file already has a notes page for this
    // slide. Spectra does not invent one, so a deck without notes pages keeps
    // its notes on the Spectra side instead of half-writing them.
    if (slide.speakerNotes !== old.speakerNotes && old.notesPartName) operations.push({ kind: "set-notes", slideId: slide.id, text: slide.speakerNotes });
    const oldObjects = new Map(old.objects.map((object) => [object.id, object])); slide.objects.forEach((object) => { const previousObject = oldObjects.get(object.id); const nextText = typeof (object.content as { text?: unknown })?.text === "string" ? String((object.content as { text: string }).text) : ""; if (!previousObject) { if (object.type === "text" && nextText) operations.push({ kind: "add-text-box", slideId: slide.id, text: nextText }); return; } const previousValue = previousObject.content as { text?: unknown } | undefined; const previousText = typeof previousValue?.text === "string" ? previousValue.text : ""; const nativeShapeId = typeof (object.content as { nativeShapeId?: unknown })?.nativeShapeId === "string" ? String((object.content as { nativeShapeId: string }).nativeShapeId) : undefined; if (nativeShapeId && nextText !== previousText && !object.locked) operations.push({ kind: "set-text", slideId: slide.id, paragraphIndex: 0, shapeId: nativeShapeId, text: nextText });
      if (!nativeShapeId) return;
      if ((object.altText ?? "") !== (previousObject.altText ?? "")) operations.push({ kind: "set-alt-text", slideId: slide.id, shapeId: nativeShapeId, text: object.altText ?? "" });
      // Geometry is compared on the logical canvas with a half-unit tolerance,
      // so reopening a deck and saving it does not rewrite every shape purely
      // from EMU rounding.
      const moved = ["x", "y", "width", "height", "rotation"].some((key) => Math.abs((object[key as "x"] ?? 0) - (previousObject[key as "x"] ?? 0)) > 0.5);
      if (moved && !object.locked) operations.push({ kind: "set-geometry", slideId: slide.id, shapeId: nativeShapeId, x: object.x, y: object.y, width: object.width, height: object.height, rotation: object.rotation });
    }); });
    // Order is a presentation-level fact, so it is settled once, at the end,
    // after the deck knows which slides exist. Only presentation.xml moves.
    const orderNow = carry.projection.slides.filter((slide) => kept.has(slide.id)).map((slide) => slide.id);
    const orderNext = projection.slides.map((slide) => slide.id);
    if (orderNext.length !== orderNow.length || orderNext.some((id, index) => id !== orderNow[index])) operations.push({ kind: "reorder-slides", order: orderNext });
    return operations.length ? applyDelta(carry, { kind: "ai-edit", operations }) : carry.payload; },
  async diffExternal(payloadA, payloadB): Promise<LensExternalDiff> { const [before, after, comparison] = await Promise.all([this.open(payloadA), this.open(payloadB), comparePackages(payloadA, payloadB)]); const previous = new Map(before.projection.slides.map((slide) => [slide.id, slide])); const changes: LensExternalDiff["changes"] = []; for (const slide of after.projection.slides) { const old = previous.get(slide.id); previous.delete(slide.id); if (!old) changes.push({ regionId: slide.id, kind: "insert", after: slide }); else if (JSON.stringify(old) !== JSON.stringify(slide)) changes.push({ regionId: slide.id, kind: "update", before: old, after: slide }); } for (const slide of previous.values()) changes.push({ regionId: slide.id, kind: "delete", before: slide }); const changedParts = comparison.parts.filter((part) => part.verdict !== "identical").map((part) => `/${part.name}`); const modeled = new Set(after.projection.slides.map((slide) => slide.id.replace(/^pptx:slide:/, ""))); const preservedPartChanges = changedParts.filter((part) => !modeled.has(part)); return { changes, changedParts, preservedPartChanges }; },
  capabilities(profile, fidelityMap): LensCapabilitySet { const strict = profile === "strict-native"; const hasTransition = fidelityMap.entries.some((entry) => entry.feature === "transition"); const notesEntry = fidelityMap.entries.find((entry) => entry.feature === "speakerNotes"); const hasNotes = notesEntry?.class === "EQUIVALENT"; return { profile, human: [{ id: "edit-slide-title", available: true }, { id: "edit-slide-text", available: true }, { id: "add-basic-text-box", available: true }, { id: "add-slide-on-existing-layout", available: true }, { id: "remove-slide", available: true }, { id: "reorder-slides", available: true },{ id: "edit-speaker-notes", available: hasNotes, ...(hasNotes ? {} : { reason: "This file has no notes page for its slides, and Spectra does not add one yet." }) }, { id: "describe-shape", available: true }, { id: "move-and-resize-shape", available: true }, { id: "edit-native-transition", available: hasTransition, reason: hasTransition ? "Only exact PowerPoint transition equivalents may replace the preserved transition." : "No native transition is present." }, strict ? { id: "apply-spectra-only-transition", available: false, reason: "This transition has no exact PowerPoint representation in strict native mode." } : { id: "apply-spectra-only-transition", available: true }], aiOperations: ["set_slide_title", "set_slide_text", "add_text_box", "write_speaker_notes", "set_alt_text", "move_object", "resize_object", "add_slide", "delete_slide", "reorder_slides"] }; },
};
