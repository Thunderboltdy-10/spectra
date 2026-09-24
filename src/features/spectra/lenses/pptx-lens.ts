import { Presentation, DRAWINGML_NAMESPACE, PML_NAMESPACE } from "@ariadng/office/pptx";
import { resolveRelationshipTarget, type OpcPart } from "@ariadng/office/opc";
import { comparePackages } from "@ariadng/office/preservation";
import { XmlElement, XmlText } from "@ariadng/office/xml";
import { Workbook } from "@ariadng/office/xlsx";
import { OFFICE_ARCHIVE_LIMITS, prepareBoundedArchiveBytes } from "../../../../shared/parser-limits";
import { normalizePresentationHyperlink, presentationObjectText } from "../presentation/model";
import type {
  PresentationChartContent,
  PresentationObject,
  PresentationParagraph,
  PresentationTableCell,
  PresentationHyperlink,
} from "../presentation/model";
import { sha256Payload } from "./docx-lens";
import { pptxOperationsBetween } from "./office-content";
import type { LensCapabilitySet, LensCompatibilityProfile, LensExternalDiff, LensFidelityEntry, LensFidelityMap, LensOpenResult, LensPreservedCarry, SpectraLens } from "./types";
import { pptxProjectionSchema, type PptxProjection, type PptxSemanticDelta } from "./projection-contracts";

export type { PptxProjection, PptxSemanticDelta, PptxSlideProjection } from "./projection-contracts";

export class PptxLensError extends Error { constructor(public readonly code: string, message: string) { super(message); this.name = "PptxLensError"; } }

function descendants(root: XmlElement): XmlElement[] { const result: XmlElement[] = []; const pending = [...root.elements()].reverse(); while (pending.length) { const child = pending.pop()!; result.push(child); const nested = child.elements(); for (let index = nested.length - 1; index >= 0; index -= 1) pending.push(nested[index]!); } return result; }
function semanticNode(root: XmlElement, localName: string) { return descendants(root).find((node) => node.namespaceUri() === PML_NAMESPACE && node.localName === localName); }
function firstText(root: XmlElement) { return descendants(root).find((node) => node.namespaceUri() === DRAWINGML_NAMESPACE && node.localName === "t")?.text() ?? ""; }
function textNodes(root: XmlElement) { return descendants(root).filter((node) => node.namespaceUri() === DRAWINGML_NAMESPACE && node.localName === "t"); }
function titleShape(root: XmlElement) { return descendants(root).find((node) => node.namespaceUri() === PML_NAMESPACE && node.localName === "sp" && descendants(node).some((child) => child.namespaceUri() === PML_NAMESPACE && child.localName === "ph" && ["title", "ctrTitle"].includes(child.getAttribute("type") ?? ""))); }
function firstDescendant(root: XmlElement, namespace: string, localName: string) { return descendants(root).find((node) => node.namespaceUri() === namespace && node.localName === localName); }
function shapeId(root: XmlElement) { return firstDescendant(root, PML_NAMESPACE, "cNvPr")?.getAttribute("id") ?? undefined; }
function shapeText(root: XmlElement) {
  return descendants(root)
    .filter((node) => node.namespaceUri() === DRAWINGML_NAMESPACE && node.localName === "p")
    .map((paragraph) => textNodes(paragraph).map((node) => node.text()).join(""))
    .filter((value) => value.length > 0)
    .join("\n")
    .trim();
}
function emu(value: string | undefined, fallback = 0) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; }
function placeholderKey(root: XmlElement) {
  const placeholder = firstDescendant(root, PML_NAMESPACE, "ph");
  if (!placeholder) return undefined;
  return `${placeholder.getAttribute("type") ?? "body"}:${placeholder.getAttribute("idx") ?? "0"}`;
}
function shapeGeometry(
  root: XmlElement,
  fallback?: XmlElement,
  canvas = { width: 12192000, height: 6858000 },
) {
  // Graphic frames store their transform as p:xfrm, while regular shapes
  // store a:xfrm under p:spPr. Read both namespaces before falling back to a
  // layout placeholder.
  const xfrm = firstDescendant(root, PML_NAMESPACE, "xfrm") ??
    firstDescendant(root, DRAWINGML_NAMESPACE, "xfrm");
  const source = xfrm ? root : fallback;
  const sourceXfrm = source
    ? firstDescendant(source, PML_NAMESPACE, "xfrm") ?? firstDescendant(source, DRAWINGML_NAMESPACE, "xfrm")
    : undefined;
  const off = sourceXfrm ? firstDescendant(sourceXfrm, DRAWINGML_NAMESPACE, "off") : undefined;
  const ext = sourceXfrm ? firstDescendant(sourceXfrm, DRAWINGML_NAMESPACE, "ext") : undefined;
  const canvasHeight = (canvas.height / canvas.width) * 1000;
  return {
    x: Math.max(0, Math.min(1000, (emu(off?.getAttribute("x")) / canvas.width) * 1000)),
    y: Math.max(0, Math.min(canvasHeight, (emu(off?.getAttribute("y")) / canvas.height) * canvasHeight)),
    width: Math.max(10, Math.min(1000, (emu(ext?.getAttribute("cx"), 914400) / canvas.width) * 1000)),
    height: Math.max(10, Math.min(canvasHeight, (emu(ext?.getAttribute("cy"), 457200) / canvas.height) * canvasHeight)),
    rotation: emu(sourceXfrm?.getAttribute("rot")) / 60000,
  };
}
function pictureMedia(
  deck: Presentation,
  slidePartName: string,
  shape: XmlElement,
) {
  const blip = firstDescendant(shape, DRAWINGML_NAMESPACE, "blip");
  if (!blip) return {};
  const relationshipId = blip.getAttributeNs(
    OFFICE_RELATIONSHIPS_NAMESPACE,
    "embed",
  );
  if (!relationshipId) return {};
  const slidePart = deck.office.package.getPart(slidePartName);
  if (!slidePart) return {};
  const part = deck.office.package.relatedPart(slidePart, relationshipId);
  if (!part || !/^\/ppt\/media\//i.test(part.name)) return {};
  return {
    nativeMediaPart: part.name,
    nativeMediaType: part.contentType.toLowerCase(),
  };
}

function runColor(runProperties: XmlElement | undefined) {
  const color = runProperties
    ? descendants(runProperties).find((node) => node.namespaceUri() === DRAWINGML_NAMESPACE && node.localName === "srgbClr")?.getAttribute("val")
    : undefined;
  return color ? `#${color}` : undefined;
}

function runFormat(runProperties: XmlElement | undefined) {
  if (!runProperties) return {};
  const latin = runProperties.elements().find((node) => node.namespaceUri() === DRAWINGML_NAMESPACE && node.localName === "latin");
  const size = Number(runProperties.getAttribute("sz"));
  const underline = runProperties.getAttribute("u");
  return {
    ...(latin?.getAttribute("typeface") ? { fontFamily: latin.getAttribute("typeface")! } : {}),
    ...(Number.isFinite(size) && size > 0 ? { fontSizePt: size / 100 } : {}),
    ...(runProperties.getAttribute("b") === "1" ? { bold: true } : {}),
    ...(runProperties.getAttribute("i") === "1" ? { italic: true } : {}),
    ...(underline && underline !== "none" ? { underline: true } : {}),
    ...(runProperties.getAttribute("strike") === "sngStrike" || runProperties.getAttribute("strike") === "dblStrike" ? { strike: true } : {}),
    ...(runColor(runProperties) ? { color: runColor(runProperties) } : {}),
  };
}

function richParagraphs(deck: Presentation, slidePartName: string, root: XmlElement): PresentationParagraph[] {
  return descendants(root)
    .filter((node) => node.namespaceUri() === DRAWINGML_NAMESPACE && node.localName === "p")
    .map((paragraph) => {
      const paragraphProperties = paragraph.elements().find((node) => node.namespaceUri() === DRAWINGML_NAMESPACE && node.localName === "pPr");
      const bullet = paragraphProperties?.elements().some((node) => node.namespaceUri() === DRAWINGML_NAMESPACE && ["buChar", "buAutoNum"].includes(node.localName))
        ? paragraphProperties?.elements().some((node) => node.localName === "buAutoNum") ? "numbered" : "bullet"
        : "none";
      const level = Number(paragraphProperties?.getAttribute("lvl"));
      const runs = descendants(paragraph)
        .filter((node) => node.namespaceUri() === DRAWINGML_NAMESPACE && ["r", "fld"].includes(node.localName))
        .flatMap((run) => {
          const textNode = descendants(run).find((node) => node.namespaceUri() === DRAWINGML_NAMESPACE && node.localName === "t");
          if (!textNode) return [];
          const properties = run.elements().find((node) => node.namespaceUri() === DRAWINGML_NAMESPACE && node.localName === "rPr");
          return [{
            text: textNode.text(),
            ...runFormat(properties),
            ...(hyperlinkFor(deck, slidePartName, properties) ? { hyperlink: hyperlinkFor(deck, slidePartName, properties) } : {}),
          }];
        });
      return {
        runs,
        ...(paragraphProperties?.getAttribute("algn") === "ctr" ? { alignment: "center" as const } : {}),
        ...(paragraphProperties?.getAttribute("algn") === "r" ? { alignment: "right" as const } : {}),
        ...(paragraphProperties?.getAttribute("algn") === "just" ? { alignment: "justify" as const } : {}),
        ...(Number.isFinite(level) && level >= 0 ? { level } : {}),
        ...(bullet !== "none" ? { bullet } : {}),
      } satisfies PresentationParagraph;
    })
    .filter((paragraph) => paragraph.runs.length > 0);
}

function cropFor(shape: XmlElement) {
  const source = descendants(shape).find((node) => node.namespaceUri() === DRAWINGML_NAMESPACE && node.localName === "srcRect");
  if (!source) return undefined;
  const number = (key: string) => {
    const value = Number(source.getAttribute(key));
    return Number.isFinite(value) ? value / 1000 : 0;
  };
  return { left: number("l"), top: number("t"), right: number("r"), bottom: number("b") };
}

function tableCells(deck: Presentation, slidePartName: string, shape: XmlElement): Array<Array<PresentationTableCell>> {
  return descendants(shape)
    .filter((node) => node.namespaceUri() === DRAWINGML_NAMESPACE && node.localName === "tr")
    .map((row) => descendants(row)
      .filter((node) => node.namespaceUri() === DRAWINGML_NAMESPACE && node.localName === "tc")
      .map((cell) => ({
        text: shapeText(cell),
        paragraphs: richParagraphs(deck, slidePartName, cell),
        style: (() => {
          const properties = child(cell, DRAWINGML_NAMESPACE, "tcPr");
          const fill = properties && child(properties, DRAWINGML_NAMESPACE, "solidFill")?.elements().find((node) => node.namespaceUri() === DRAWINGML_NAMESPACE && node.localName === "srgbClr")?.getAttribute("val");
          return fill ? { fill: `#${fill}` } : undefined;
        })(),
        ...(Number(cell.getAttribute("rowSpan")) > 1 ? { rowSpan: Number(cell.getAttribute("rowSpan")) } : {}),
        ...(Number(cell.getAttribute("gridSpan")) > 1 ? { colSpan: Number(cell.getAttribute("gridSpan")) } : {}),
      })));
}

const SPECTRA_CHART_SOURCE_NAMESPACE = "urn:spectra:office-bridge";

function chartText(root: XmlElement) {
  return descendants(root)
    .filter((node) => node.namespaceUri() === DRAWINGML_NAMESPACE && node.localName === "t")
    .map((node) => node.text())
    .join("")
    .trim();
}

function cachedValues(root: XmlElement, cacheName: "strCache" | "numCache") {
  const cache = descendants(root).find((node) => node.localName === cacheName) ??
    (cacheName === "strCache" ? descendants(root).find((node) => node.localName === "multiLvlStrCache") : undefined);
  if (!cache) return [];
  return descendants(cache)
    .filter((node) => node.localName === "pt")
    .sort((left, right) => Number(left.getAttribute("idx")) - Number(right.getAttribute("idx")))
    .map((point) => descendants(point).find((node) => node.localName === (cacheName === "numCache" ? "v" : "v"))?.text() ?? "")
    .filter((value) => value.length > 0);
}

async function chartFor(
  deck: Presentation,
  slidePartName: string,
  shape: XmlElement,
): Promise<PresentationChartContent & { nativeChartPart?: string }> {
  const chartReference = firstDescendant(shape, "http://schemas.openxmlformats.org/drawingml/2006/chart", "chart");
  const relationshipId = chartReference?.getAttributeNs(OFFICE_RELATIONSHIPS_NAMESPACE, "id");
  const slidePart = deck.office.package.getPart(slidePartName);
  const chartPart = relationshipId && slidePart ? deck.office.package.relatedPart(slidePart, relationshipId) : undefined;
  if (!chartPart) return { chartType: "bar", categories: [], series: [], showLegend: false };
  const chart = (await deck.office.xml(chartPart.name)).root;
  const series = descendants(chart)
    .filter((node) => node.localName === "ser")
    .map((ser, index) => {
      const tx = child(ser, "http://schemas.openxmlformats.org/drawingml/2006/chart", "tx");
      const nameCache = tx ? child(tx, "http://schemas.openxmlformats.org/drawingml/2006/chart", "strRef") : undefined;
      const name = nameCache ? cachedValues(nameCache, "strCache")[0] ?? `Series ${index + 1}` : `Series ${index + 1}`;
      // The series name also owns a c:strRef, so searching the whole series
      // would accidentally project the name cache as the category cache.
      const category = child(ser, "http://schemas.openxmlformats.org/drawingml/2006/chart", "cat");
      const value = child(ser, "http://schemas.openxmlformats.org/drawingml/2006/chart", "val");
      const categoryReference = category ? descendants(category).find((node) => ["strRef", "multiLvlStrRef"].includes(node.localName)) : undefined;
      const valueReference = value ? descendants(value).find((node) => node.localName === "numRef") : undefined;
      const categories = categoryReference ? cachedValues(categoryReference, "strCache") : [];
      const values = valueReference ? cachedValues(valueReference, "numCache").map(Number).filter(Number.isFinite) : [];
      return { name, categories, values, id: descendants(ser).find((node) => node.localName === "idx")?.getAttribute("val") ?? undefined };
    });
  const categories = series[0]?.categories ?? [];
  const chartType = descendants(chart).some((node) => node.localName === "lineChart") ? "line" : descendants(chart).some((node) => node.localName === "pieChart") ? "pie" : descendants(chart).some((node) => node.localName === "areaChart") ? "area" : descendants(chart).some((node) => node.localName === "barChart" && descendants(node).some((child) => child.localName === "barDir" && child.getAttribute("val") === "col")) ? "column" : "bar";
  const chartRoot = child(chart, "http://schemas.openxmlformats.org/drawingml/2006/chart", "chart");
  const title = chartRoot ? child(chartRoot, "http://schemas.openxmlformats.org/drawingml/2006/chart", "title") : undefined;
  const axisTitles = chartRoot
    ? descendants(chartRoot).filter((node) => (node.localName === "catAx" || node.localName === "valAx") && child(node, "http://schemas.openxmlformats.org/drawingml/2006/chart", "title")).map((node) => chartText(child(node, "http://schemas.openxmlformats.org/drawingml/2006/chart", "title")!))
    : [];
  const source = descendants(chart).find((node) => node.namespaceUri() === SPECTRA_CHART_SOURCE_NAMESPACE && node.localName === "source");
  return {
    chartType,
    ...(title ? { title: chartText(title) } : {}),
    categories,
    series,
    showLegend: descendants(chart).some((node) => node.localName === "legend"),
    ...(axisTitles[0] ? { axisTitle: axisTitles[0] } : {}),
    ...(axisTitles[1] ? { valueAxisTitle: axisTitles[1] } : {}),
    ...(source?.getAttribute("artifactId") ? { sourceArtifactId: source.getAttribute("artifactId")! } : {}),
    ...(source?.getAttribute("chartId") ? { sourceChartId: source.getAttribute("chartId")! } : {}),
    ...(source?.getAttribute("revision") ? { sourceRevision: source.getAttribute("revision")! } : {}),
    ...(source?.getAttribute("kind") === "sheets_range" ? { sourceKind: "sheets_range" as const } : {}),
    ...(source?.getAttribute("range") ? { sourceRange: source.getAttribute("range")! } : {}),
    ...(source?.getAttribute("live") === "1" ? { sourceLive: true } : source?.getAttribute("live") === "0" ? { sourceLive: false } : {}),
    nativeChartPart: chartPart.name,
  };
}

function sceneNodes(root: XmlElement) {
  const tree = descendants(root).find((node) => node.namespaceUri() === PML_NAMESPACE && node.localName === "spTree");
  if (!tree) return [] as Array<{ node: XmlElement; parentId?: string }>;
  const result: Array<{ node: XmlElement; parentId?: string }> = [];
  const walk = (parent: XmlElement, parentId?: string) => {
    for (const node of parent.elements()) {
      if (node.namespaceUri() !== PML_NAMESPACE) continue;
      if (["sp", "pic", "graphicFrame"].includes(node.localName)) result.push({ node, parentId });
      else if (node.localName === "grpSp") {
        result.push({ node, parentId });
        const groupId = shapeId(node);
        walk(node, groupId);
      }
    }
  };
  walk(tree);
  return result;
}

async function slideObjects(
  deck: Presentation,
  slidePartName: string,
  root: XmlElement,
  slideId: string,
  layoutRoot?: XmlElement,
  canvas?: { width: number; height: number },
): Promise<PresentationObject[]> {
  const layoutPlaceholders = new Map<string, XmlElement>();
  if (layoutRoot) descendants(layoutRoot).filter((node) => node.namespaceUri() === PML_NAMESPACE && node.localName === "sp").forEach((shape) => {
    const key = placeholderKey(shape);
    if (key) layoutPlaceholders.set(key, shape);
  });
  const objects: PresentationObject[] = [];
  const scenes = sceneNodes(root);
  for (const { node: shape, parentId } of scenes) {
    const nativeShapeId = shapeId(shape);
    if (!nativeShapeId) continue;
    if (shape.localName === "grpSp") {
      const childIds = scenes
        .filter((child) => child.parentId === nativeShapeId)
        .flatMap((child) => shapeId(child.node) ? [`${slideId}:shape:${shapeId(child.node)}`] : []);
      if (childIds.length < 2) continue;
      objects.push({
        id: `${slideId}:shape:${nativeShapeId}`,
        type: "group",
        ...shapeGeometry(shape, undefined, canvas),
        content: { nativeShapeId, childIds },
        parentId,
        readingOrder: objects.length,
      });
      continue;
    }
    const placeholder = firstDescendant(shape, PML_NAMESPACE, "ph");
    const isTitle = ["title", "ctrTitle"].includes(placeholder?.getAttribute("type") ?? "");
    const type = shape.localName === "pic" ? "image" : shape.localName === "graphicFrame" ? (descendants(shape).some((node) => node.localName === "chart") ? "chart" : "table") : "text";
    // `descr` is PowerPoint's own alt text, so reading it here is what lets a
    // Spectra description round-trip instead of being invented alongside one.
    const descr = firstDescendant(shape, PML_NAMESPACE, "cNvPr")?.getAttribute("descr")?.trim();
    const content = type === "chart"
      ? { ...(await chartFor(deck, slidePartName, shape)), nativeShapeId }
      : type === "table"
        ? { rows: tableCells(deck, slidePartName, shape), nativeTable: true, nativeShapeId }
        : {
            text: shapeText(shape),
            paragraphs: richParagraphs(deck, slidePartName, shape),
            nativeShapeId,
            nativeParagraphIndex: 0,
            nativeShapeKind: isTitle ? "placeholder" as const : "shape" as const,
            ...(type === "image" ? { ...pictureMedia(deck, slidePartName, shape), ...(cropFor(shape) ? { crop: cropFor(shape) } : {}) } : {}),
          };
    const nativeObjectLink = hyperlinkFor(deck, slidePartName, firstDescendant(shape, PML_NAMESPACE, "cNvPr"));
    const uniformTextLink = type === "text"
      ? (() => {
          const links = (content as { paragraphs?: PresentationParagraph[] }).paragraphs
            ?.flatMap((paragraph) => paragraph.runs.map((run) => normalizePresentationHyperlink(run.hyperlink)))
            .filter((link): link is PresentationHyperlink => Boolean(link)) ?? [];
          return links.length && links.every((link) => JSON.stringify(link) === JSON.stringify(links[0])) ? links[0] : undefined;
        })()
      : undefined;
    const chart = type === "chart" ? content as PresentationChartContent : undefined;
    const hiddenObject = ["1", "true", "on"].includes((firstDescendant(shape, PML_NAMESPACE, "cNvPr")?.getAttribute("hidden") ?? "").toLowerCase());
    objects.push({
      id: `${slideId}:shape:${nativeShapeId}`,
      type,
      ...shapeGeometry(shape, layoutPlaceholders.get(placeholderKey(shape) ?? ""), canvas),
      content,
      ...(chart?.sourceArtifactId ? {
        sourceBinding: {
          artifactId: chart.sourceArtifactId,
          kind: chart.sourceKind ?? "artifact",
          ...(chart.sourceRange ? { range: chart.sourceRange } : {}),
          ...(chart.sourceRevision ? { versionId: chart.sourceRevision } : {}),
          ...(chart.sourceLive !== undefined ? { live: chart.sourceLive } : {}),
        },
      } : {}),
      ...(hiddenObject ? { hidden: true } : {}),
      ...(descr ? { altText: descr } : {}),
      ...(nativeObjectLink ?? uniformTextLink
        ? { hyperlink: nativeObjectLink ?? uniformTextLink }
        : {}),
      ...(parentId ? { parentId: `${slideId}:shape:${parentId}` } : {}),
      locked: isTitle,
      readingOrder: objects.length,
    } satisfies PresentationObject);
  }
  return objects;
}

async function presentationThemeFonts(deck: Presentation) {
  const presentationPart = deck.office.package.getPart("/ppt/presentation.xml");
  const relationship = presentationPart?.relationships().byType(THEME_RELATIONSHIP)[0];
  const themePart = relationship && presentationPart
    ? deck.office.package.relatedPart(presentationPart, relationship.id)
    : undefined;
  if (!themePart) return undefined;
  const root = (await deck.office.xml(themePart.name)).root;
  const font = (slot: string) => {
    const element = descendants(root).find((node) => node.localName === slot);
    return element?.elements().find((child) => child.localName === "latin")?.getAttribute("typeface");
  };
  const heading = font("majorFont");
  const body = font("minorFont");
  return heading || body
    ? { ...(heading ? { heading } : {}), ...(body ? { body } : {}) }
    : undefined;
}

async function projectPresentation(deck: Presentation, profile: LensCompatibilityProfile) {
  const entries: LensFidelityEntry[] = [];
  const presentationXml = await deck.office.xml("/ppt/presentation.xml");
  const slideSize = firstDescendant(presentationXml.root, PML_NAMESPACE, "sldSz");
  const canvas = {
    width: emu(slideSize?.getAttribute("cx"), 12192000),
    height: emu(slideSize?.getAttribute("cy"), 6858000),
  };
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
    const hidden = ["0", "false", "off"].includes(
      (root.getAttribute("show") ?? "").toLowerCase(),
    );
    return { id, index, title: title ? firstText(title) : (slide.text()[0] ?? ""), text: [...slide.text()], objects: await slideObjects(deck, slide.partName, root, id, layoutRoot, canvas), ...(slide.layoutPartName ? { layoutPartName: slide.layoutPartName } : {}), hasTransition: Boolean(transition), hasTiming: Boolean(timing), ...(hidden ? { hidden: true } : {}), speakerNotes, ...(notesPartName ? { notesPartName } : {}) };
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
  // live. Speaker notes are EQUIVALENT for every conforming deck because an
  // absent notes page is created with its native master and relationships.
  const regionClasses: Array<[string, LensFidelityEntry["class"], string?]> = [
    ["slides", "NATIVE"],
    ["shapes", "NATIVE"],
    ["speakerNotes", "EQUIVALENT", "Speaker notes are written into native PowerPoint notes pages, creating the page and master when needed."],
    ["transitions", slides.some((slide) => slide.hasTransition) ? "PRESERVED" : "NATIVE", "PowerPoint saved these transitions and Spectra preserves them exactly."],
    ["animations", slides.some((slide) => slide.hasTiming) ? "PRESERVED" : "NATIVE", "PowerPoint animation timing is preserved exactly rather than approximated."],
    ["masters", partNames.some((name) => /\/slideMasters\//i.test(name)) ? "PRESERVED" : "NATIVE", "Slide masters are preserved exactly as PowerPoint saved them."],
    ["layouts", partNames.some((name) => /\/slideLayouts\//i.test(name)) ? "PRESERVED" : "NATIVE", "Slide layouts come from this file's own masters and are preserved."],
    ["media", partNames.some((name) => /\/media\//i.test(name)) ? "PRESERVED" : "NATIVE", "Media parts are copied through byte for byte."],
    ["images", "NATIVE", "Pictures keep their embedded bytes while crop and alt text edits write native DrawingML."],
    ["hyperlinks", "NATIVE", "External URLs and links to another slide are written as native PowerPoint relationships."],
    ["charts", "NATIVE", "Charts write native chart parts, caches, and embedded workbook values."],
    ["tables", "NATIVE", "Table cell text and formatting stay in the native DrawingML table."],
    ["ole", partNames.some((name) => /\/embeddings\//i.test(name)) ? "PRESERVED" : "NATIVE", "Embedded objects are preserved untouched."],
    ["smartArt", partNames.some((name) => /\/diagrams\//i.test(name)) ? "PRESERVED" : "NATIVE", "SmartArt diagrams are preserved untouched."],
    ["equations", "PRESERVED", "Equations already in the file are preserved; Spectra does not author new ones."],
  ];
  for (const [feature, cls, reason] of regionClasses) {
    entries.push({ regionId: `pptx:region:${feature}`, feature, class: cls, ...(cls === "PRESERVED" ? { readOnly: true } : {}), ...(reason && cls !== "NATIVE" ? { reason } : {}) });
  }
  const semanticDigest = await sha256Payload(new TextEncoder().encode(JSON.stringify(slides.map(({ id, title, text, objects, hidden, speakerNotes }) => ({ id, title, text, objects, hidden, speakerNotes })))));
  const themeFonts = await presentationThemeFonts(deck);
  const projection = pptxProjectionSchema.parse({ slides, nativeBinding: { version: 1, format: deck.office.format.extension as PptxProjection["nativeBinding"]["format"], profile, macroEnabled: deck.office.format.macroEnabled, semanticDigest, canvasWidthEmu: canvas.width, canvasHeightEmu: canvas.height, ...(themeFonts ? { themeFonts } : {}) } });
  return { projection, fidelityMap };
}

function slideFor(deck: Presentation, slideId: string) { const partName = slideId.replace(/^pptx:slide:/, ""); const slide = deck.slides().find((candidate) => candidate.partName === partName); if (!slide) throw new PptxLensError("PPTX_SLIDE_MISSING", "The target PowerPoint slide no longer exists."); return slide; }

const NOTES_SLIDE_RELATIONSHIP = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide";
const NOTES_MASTER_RELATIONSHIP = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesMaster";
const SLIDE_RELATIONSHIP = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide";
const HYPERLINK_RELATIONSHIP = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink";
const THEME_RELATIONSHIP = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme";
const OFFICE_RELATIONSHIPS_NAMESPACE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const NOTES_SLIDE_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml";
const NOTES_MASTER_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.presentationml.notesMaster+xml";

function hyperlinkClick(owner: XmlElement) {
  return owner.elements().find((node) =>
    node.namespaceUri() === DRAWINGML_NAMESPACE && node.localName === "hlinkClick",
  );
}

function hyperlinkFor(
  deck: Presentation,
  slidePartName: string,
  owner: XmlElement | undefined,
): PresentationHyperlink | undefined {
  const click = owner && hyperlinkClick(owner);
  const relationshipId = click?.getAttributeNs(OFFICE_RELATIONSHIPS_NAMESPACE, "id");
  const slidePart = deck.office.package.getPart(slidePartName);
  const relationship = relationshipId && slidePart?.relationships().byId(relationshipId);
  if (!relationship) return undefined;
  if (relationship.type === HYPERLINK_RELATIONSHIP && relationship.targetMode === "External")
    return { kind: "external", url: relationship.target };
  if (relationship.type === SLIDE_RELATIONSHIP && relationship.targetMode !== "External") {
    const target = deck.office.package.relatedPart(slidePart ?? null, relationship.id);
    return target ? { kind: "slide", slideId: `pptx:slide:${target.name}` } : undefined;
  }
  return undefined;
}

function externalHyperlink(value: PresentationHyperlink) {
  if (value.kind !== "external") return undefined;
  if (!/^(?:https?:|mailto:)/i.test(value.url))
    throw new PptxLensError("PPTX_HYPERLINK_INVALID", "PowerPoint external links must use http(s) or mailto URLs.");
  return value.url;
}

function setHyperlink(
  deck: Presentation,
  slidePartName: string,
  owner: XmlElement,
  value: PresentationHyperlink | null | undefined,
) {
  const slidePart = deck.office.package.getPart(slidePartName);
  if (!slidePart) throw new PptxLensError("PPTX_SLIDE_MISSING", "The slide owning this link no longer exists.");
  const old = hyperlinkClick(owner);
  if (old) owner.removeChild(old);
  if (value) {
    const click = new XmlElement("hlinkClick", "a");
    let relationship = value.kind === "external"
      ? slidePart.relationships().all().find((candidate) =>
          candidate.type === HYPERLINK_RELATIONSHIP &&
          candidate.targetMode === "External" &&
          candidate.target === externalHyperlink(value),
        )
      : (() => {
          const target = slideFor(deck, value.slideId);
          return slidePart.relationships().all().find((candidate) => {
            if (candidate.type !== SLIDE_RELATIONSHIP || candidate.targetMode === "External") return false;
            return deck.office.package.relatedPart(slidePart, candidate.id)?.name === target.partName;
          });
        })();
    if (!relationship) {
      relationship = value.kind === "external"
        ? slidePart.relationships().add({
            type: HYPERLINK_RELATIONSHIP,
            target: externalHyperlink(value)!,
            targetMode: "External",
          })
        : slidePart.relationships().add({
            type: SLIDE_RELATIONSHIP,
            target: relativePartTarget(slidePart.name, slideFor(deck, value.slideId).partName),
          });
    }
    click.setAttributeNs(OFFICE_RELATIONSHIPS_NAMESPACE, "id", relationship.id);
    if (value.kind === "slide") click.setAttribute("action", "ppaction://hlinksldjump");
    owner.appendChild(click);
  }
}

function cleanupSlideHyperlinkRelationships(deck: Presentation, slidePartName: string, root: XmlElement) {
  const slidePart = deck.office.package.getPart(slidePartName);
  if (!slidePart) return;
  const used = new Set(
    descendants(root)
      .filter((node) => node.localName === "hlinkClick")
      .map((node) => node.getAttributeNs(OFFICE_RELATIONSHIPS_NAMESPACE, "id"))
      .filter((id): id is string => Boolean(id)),
  );
  for (const relation of slidePart.relationships().all()) {
    if ((relation.type === HYPERLINK_RELATIONSHIP || relation.type === SLIDE_RELATIONSHIP) && !used.has(relation.id))
      slidePart.relationships().remove(relation.id);
  }
}

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

const MINIMAL_NOTES_SLIDE = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:notes xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr><p:sp><p:nvSpPr><p:cNvPr id="2" name="Notes Placeholder 1"/><p:cNvSpPr txBox="1"/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="en-US"/></a:p></p:txBody></p:sp></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>`;

const MINIMAL_NOTES_MASTER = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:notesMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld name=""><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr><p:sp><p:nvSpPr><p:cNvPr id="2" name="Notes Placeholder 1"/><p:cNvSpPr txBox="1"/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="en-US"/></a:p></p:txBody></p:sp></p:spTree></p:cSld><p:clrMap accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" bg1="lt1" bg2="lt2" folHlink="folHlink" hlink="hlink" tx1="dk1" tx2="dk2"/><p:hf hdr="1" ftr="1" dt="1" sldNum="1"/><p:notesStyle><a:lvl1pPr marL="0" algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:defRPr sz="1200" kern="1200"/></a:lvl1pPr></p:notesStyle></p:notesMaster>`;

function relativePartTarget(sourcePartName: string, targetPartName: string) {
  const source = sourcePartName.replace(/^\//, "").split("/");
  source.pop();
  const target = targetPartName.replace(/^\//, "").split("/");
  while (source.length && target.length && source[0] === target[0]) {
    source.shift();
    target.shift();
  }
  return `${"../".repeat(source.length)}${target.join("/")}`;
}

function relationshipsPartName(partName: string) {
  const separator = partName.lastIndexOf("/");
  return `${partName.slice(0, separator)}/_rels/${partName.slice(separator + 1)}.rels`;
}

function nextPartName(deck: Presentation, folder: string, stem: string) {
  const used = new Set(deck.office.package.parts().map((part) => part.name.toLocaleLowerCase()));
  let index = 1;
  while (used.has(`${folder}/${stem}${index}.xml`.toLocaleLowerCase())) index += 1;
  return `${folder}/${stem}${index}.xml`;
}

const PRESENTATION_CHILD_ORDER = [
  "sldMasterIdLst", "notesMasterIdLst", "handoutMasterIdLst", "sldIdLst", "sldSz",
  "notesSz", "smartTags", "embeddedFontLst", "custShowLst", "photoAlbum", "custDataLst",
  "kinsoku", "defaultTextStyle", "modifyVerifier", "extLst",
];

function insertPresentationChild(root: XmlElement, child: XmlElement) {
  const wanted = PRESENTATION_CHILD_ORDER.indexOf(child.localName);
  const reference = root.elements().find((candidate) => {
    const index = PRESENTATION_CHILD_ORDER.indexOf(candidate.localName);
    return index >= 0 && index > wanted;
  });
  root.insertBefore(child, reference ?? null);
}

async function ensureNotesMaster(deck: Presentation) {
  const pkg = deck.office.package;
  const presentationPart = pkg.getPart("/ppt/presentation.xml");
  if (!presentationPart)
    throw new PptxLensError("PPTX_PRESENTATION_PART_MISSING", "This deck has no presentation part to own speaker notes.");
  let relationship = presentationPart.relationships().byType(NOTES_MASTER_RELATIONSHIP)
    .find((candidate) => candidate.targetMode === "Internal");
  let masterPart = relationship ? pkg.relatedPart(presentationPart, relationship.id) : undefined;
  masterPart ??= pkg.parts().find((part) => /\/ppt\/notesMasters\/notesMaster\d+\.xml$/i.test(part.name));
  if (!masterPart) {
    const name = nextPartName(deck, "/ppt/notesMasters", "notesMaster");
    masterPart = pkg.addPart(name, NOTES_MASTER_CONTENT_TYPE, new TextEncoder().encode(MINIMAL_NOTES_MASTER));
  }
  if (!relationship || pkg.relatedPart(presentationPart, relationship.id)?.name !== masterPart.name) {
    relationship = presentationPart.relationships().add({
      type: NOTES_MASTER_RELATIONSHIP,
      target: relativePartTarget(presentationPart.name, masterPart.name),
    });
  }
  const presentation = await deck.office.xml(presentationPart.name);
  let presentationChanged = false;
  let list = firstDescendant(presentation.root, PML_NAMESPACE, "notesMasterIdLst");
  if (!list) {
    list = new XmlElement("notesMasterIdLst", presentation.root.lookupPrefix(PML_NAMESPACE) ?? null);
    insertPresentationChild(presentation.root, list);
    presentationChanged = true;
  }
  const existingIds = list.elements().filter((element) => element.namespaceUri() === PML_NAMESPACE && element.localName === "notesMasterId");
  if (!existingIds.some((element) => element.getAttributeNs(OFFICE_RELATIONSHIPS_NAMESPACE, "id") === relationship.id)) {
    if (existingIds.length)
      throw new PptxLensError("PPTX_NOTES_MASTER_AMBIGUOUS", "This deck has an unresolved notes-master reference, so Spectra will not add a competing one.");
    const id = new XmlElement("notesMasterId", presentation.root.lookupPrefix(PML_NAMESPACE) ?? null);
    id.setAttributeNs(OFFICE_RELATIONSHIPS_NAMESPACE, "id", relationship.id);
    list.appendChild(id);
    presentationChanged = true;
  }
  if (!firstDescendant(presentation.root, PML_NAMESPACE, "notesSz")) {
    const size = new XmlElement("notesSz", presentation.root.lookupPrefix(PML_NAMESPACE) ?? null);
    size.setAttribute("cx", "6858000");
    size.setAttribute("cy", "9144000");
    insertPresentationChild(presentation.root, size);
    presentationChanged = true;
  }
  if (presentationChanged) deck.office.markDirty(presentationPart.name);
  if (!masterPart.relationships().byType(THEME_RELATIONSHIP).length) {
    const theme = pkg.parts().find((part) => /\/ppt\/theme\/theme\d+\.xml$/i.test(part.name));
    if (!theme)
      throw new PptxLensError("PPTX_THEME_MISSING", "This deck has no theme for a native notes master.");
    masterPart.relationships().add({
      type: THEME_RELATIONSHIP,
      target: relativePartTarget(masterPart.name, theme.name),
    });
  }
  return masterPart;
}

async function ensureNotesPage(deck: Presentation, slidePartName: string) {
  const existing = notesPartNameFor(deck, slidePartName);
  if (existing) return existing;
  const pkg = deck.office.package;
  const slidePart = pkg.getPart(slidePartName);
  if (!slidePart)
    throw new PptxLensError("PPTX_SLIDE_MISSING", "The slide being annotated no longer exists.");
  const masterPart = await ensureNotesMaster(deck);
  const template = pkg.parts().find((part) => /\/ppt\/notesSlides\/notesSlide\d+\.xml$/i.test(part.name));
  const notesName = nextPartName(deck, "/ppt/notesSlides", "notesSlide");
  const notesPart = pkg.addPart(
    notesName,
    NOTES_SLIDE_CONTENT_TYPE,
    template ? await template.read() : new TextEncoder().encode(MINIMAL_NOTES_SLIDE),
  );
  notesPart.relationships().add({
    type: NOTES_MASTER_RELATIONSHIP,
    target: relativePartTarget(notesPart.name, masterPart.name),
  });
  notesPart.relationships().add({
    type: SLIDE_RELATIONSHIP,
    target: relativePartTarget(notesPart.name, slidePart.name),
  });
  slidePart.relationships().add({
    type: NOTES_SLIDE_RELATIONSHIP,
    target: relativePartTarget(slidePart.name, notesPart.name),
  });
  return notesPart.name;
}

function shapeIn(root: XmlElement, id: string) {
  return descendants(root).find((node) => node.namespaceUri() === PML_NAMESPACE && ["sp", "pic", "graphicFrame", "grpSp"].includes(node.localName) && shapeId(node) === id);
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
function setShapeGeometry(shape: XmlElement, geometry: { x: number; y: number; width: number; height: number; rotation: number }, canvas = { width: 12192000, height: 6858000 }) {
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
  const canvasHeight = (canvas.height / canvas.width) * 1000;
  off.setAttribute("x", String(Math.round((geometry.x / 1000) * canvas.width)));
  off.setAttribute("y", String(Math.round((geometry.y / canvasHeight) * canvas.height)));
  ext.setAttribute("cx", String(Math.max(1, Math.round((geometry.width / 1000) * canvas.width))));
  ext.setAttribute("cy", String(Math.max(1, Math.round((geometry.height / canvasHeight) * canvas.height))));
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
function addNativeSlide(deck: Presentation, layoutPartName: string | undefined, title: string | undefined, text: string[] | undefined, objects?: PresentationObject[]) {
  if (objects?.some((object) => object.type !== "text"))
    throw new PptxLensError(
      "PPTX_ADD_SLIDE_OBJECT_UNSUPPORTED",
      "This native slide writer can add text objects only. Remove unsupported objects from the request or add them with a supported slide operation.",
    );
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
  const addedText = new Set((text ?? []).map((line) => line.trim()).filter(Boolean));
  for (const line of text ?? []) if (line.trim()) { addTextBox(slide.root(), line); deck.office.markDirty(slide.partName); }
  for (const object of objects ?? []) {
    if (object.type !== "text") continue;
    const value = presentationObjectText(object);
    if (typeof value === "string" && value.trim() && value.trim() !== title?.trim() && !addedText.has(value.trim())) {
      const added = addTextBox(slide.root(), value);
      const paragraphs = object.content && typeof object.content === "object" ? (object.content as { paragraphs?: PresentationParagraph[] }).paragraphs : undefined;
      if (paragraphs?.length) setRichText(deck, slide.partName, added, paragraphs);
      const objectLink = normalizePresentationHyperlink(object.hyperlink);
      if (objectLink) {
        const owner = firstDescendant(added, PML_NAMESPACE, "cNvPr");
        if (owner) setHyperlink(deck, slide.partName, owner, objectLink);
      }
      addedText.add(value.trim());
      deck.office.markDirty(slide.partName);
    }
  }
  return slide;
}

async function removeHyperlinksToSlide(deck: Presentation, targetPartName: string) {
  for (const slide of deck.slides()) {
    if (slide.partName === targetPartName) continue;
    const slidePart = deck.office.package.getPart(slide.partName);
    if (!slidePart) continue;
    const root = (await deck.office.xml(slide.partName)).root;
    let changed = false;
    for (const click of descendants(root).filter((node) =>
      node.namespaceUri() === DRAWINGML_NAMESPACE && node.localName === "hlinkClick",
    )) {
      const relationshipId = click.getAttributeNs(OFFICE_RELATIONSHIPS_NAMESPACE, "id");
      const relationship = relationshipId && slidePart.relationships().byId(relationshipId);
      if (
        !relationship ||
        relationship.type !== SLIDE_RELATIONSHIP ||
        relationship.targetMode === "External" ||
        deck.office.package.relatedPart(slidePart, relationship.id)?.name !== targetPartName
      )
        continue;
      click.parent?.removeChild(click);
      changed = true;
    }
    if (!changed) continue;
    const stillUsed = new Set(
      descendants(root)
        .filter((node) => node.namespaceUri() === DRAWINGML_NAMESPACE && node.localName === "hlinkClick")
        .map((node) => node.getAttributeNs(OFFICE_RELATIONSHIPS_NAMESPACE, "id"))
        .filter((id): id is string => Boolean(id)),
    );
    for (const relationship of slidePart.relationships().all())
      if (
        relationship.type === SLIDE_RELATIONSHIP &&
        relationship.targetMode !== "External" &&
        deck.office.package.relatedPart(slidePart, relationship.id)?.name === targetPartName &&
        !stillUsed.has(relationship.id)
      )
        slidePart.relationships().remove(relationship.id);
    deck.office.markDirty(slide.partName);
  }
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
  return sp;
}

function replaceShapeText(shape: XmlElement, value: string) {
  const txBody = descendants(shape).find((node) => [PML_NAMESPACE, DRAWINGML_NAMESPACE].includes(node.namespaceUri() ?? "") && node.localName === "txBody");
  if (!txBody) throw new PptxLensError("PPTX_TEXT_MISSING", "The target PowerPoint object has no text body.");
  const paragraphs = txBody.elements().filter((node) => node.namespaceUri() === DRAWINGML_NAMESPACE && node.localName === "p");
  const lines = value.split(/\r?\n/);
  if (paragraphs.length === lines.length && paragraphs.length > 0) {
    paragraphs.forEach((paragraph, index) => {
      const textNodesInParagraph = textNodes(paragraph);
      if (textNodesInParagraph.length) {
        replaceNodeText(textNodesInParagraph[0]!, lines[index] ?? "");
        const redundantRuns = new Set<XmlElement>();
        textNodesInParagraph.slice(1).forEach((node) => {
          const parent = node.parent;
          if (parent?.localName === "r" && parent.parent === paragraph) redundantRuns.add(parent);
          else if (parent) parent.removeChild(node);
        });
        redundantRuns.forEach((run) => run.parent?.removeChild(run));
      } else {
        const run = new XmlElement("r", "a");
        run.appendChild(new XmlElement("rPr", "a"));
        const textNode = new XmlElement("t", "a");
        textNode.appendChild(new XmlText(lines[index] ?? ""));
        run.appendChild(textNode);
        paragraph.insertBefore(run, paragraph.elements()[0] ?? null);
      }
    });
    return;
  }
  paragraphs.forEach((paragraph) => txBody.removeChild(paragraph));
  const template = paragraphs[0];
  const templateParagraphProps = template?.elements().find((node) => node.namespaceUri() === DRAWINGML_NAMESPACE && node.localName === "pPr");
  const templateRun = template ? descendants(template).find((node) => node.namespaceUri() === DRAWINGML_NAMESPACE && node.localName === "r") : undefined;
  const templateRunProps = templateRun ? child(templateRun, DRAWINGML_NAMESPACE, "rPr") : undefined;
  for (const line of lines) {
    const paragraph = new XmlElement("p", "a");
    if (templateParagraphProps) paragraph.appendChild(templateParagraphProps.clone());
    const run = new XmlElement("r", "a");
    run.appendChild(templateRunProps?.clone() ?? new XmlElement("rPr", "a"));
    const textNode = new XmlElement("t", "a");
    textNode.appendChild(new XmlText(line));
    run.appendChild(textNode);
    paragraph.appendChild(run);
    paragraph.appendChild(new XmlElement("endParaRPr", "a"));
    txBody.appendChild(paragraph);
  }
}

function moveShapeToOrder(root: XmlElement, shapeIdValue: string, order: number) {
  const tree = descendants(root).find((node) => node.namespaceUri() === PML_NAMESPACE && node.localName === "spTree");
  const shape = tree?.elements().find((node) => ["sp", "pic", "graphicFrame", "grpSp"].includes(node.localName) && shapeId(node) === shapeIdValue);
  if (!tree || !shape) return;
  const objects = tree.elements().filter((node) => ["sp", "pic", "graphicFrame", "grpSp"].includes(node.localName));
  const bounded = Math.max(0, Math.min(objects.length - 1, order));
  const reference = objects[bounded] === shape ? objects[bounded + 1] ?? null : objects[bounded] ?? null;
  tree.removeChild(shape);
  tree.insertBefore(shape, reference === shape ? null : reference);
}

function removeShape(root: XmlElement, shapeIdValue: string) {
  const shape = shapeIn(root, shapeIdValue);
  if (!shape || !shape.parent) throw new PptxLensError("PPTX_SHAPE_MISSING", "The object being deleted no longer exists on this slide.");
  if (shape.localName === "grpSp") {
    // The editor's delete and ungroup affordances both remove the group node
    // while keeping its members. Moving the native children out first gives
    // those two actions the same semantics in PowerPoint and in Spectra.
    const parent = shape.parent;
    const children = shape.elements().filter((node) => ["sp", "pic", "graphicFrame", "grpSp"].includes(node.localName));
    const reference = shape;
    for (const childNode of children) {
      shape.removeChild(childNode);
      parent.insertBefore(childNode, reference);
    }
  }
  shape.parent.removeChild(shape);
}

function setObjectHidden(shape: XmlElement, hidden: boolean) {
  const properties = firstDescendant(shape, PML_NAMESPACE, "cNvPr");
  if (!properties) throw new PptxLensError("PPTX_SHAPE_PROPS_MISSING", "This PowerPoint object has no visibility properties.");
  if (hidden) properties.setAttribute("hidden", "1");
  else properties.removeAttribute("hidden");
}

function addNativeGroup(root: XmlElement, operation: {
  childShapeIds: string[];
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  readingOrder?: number;
}) {
  const tree = descendants(root).find((node) => node.namespaceUri() === PML_NAMESPACE && node.localName === "spTree");
  if (!tree) throw new PptxLensError("PPTX_SHAPE_TREE_MISSING", "The slide has no editable shape tree.");
  const children = operation.childShapeIds.map((id) => tree.elements().find((node) => ["sp", "pic", "graphicFrame", "grpSp"].includes(node.localName) && shapeId(node) === id));
  if (children.some((node) => !node)) throw new PptxLensError("PPTX_SHAPE_MISSING", "A grouped PowerPoint object no longer exists on this slide.");
  const ids = descendants(tree).filter((node) => node.localName === "cNvPr").map((node) => Number(node.getAttribute("id") ?? 0));
  const id = Math.max(1, ...ids) + 1;
  const group = new XmlElement("grpSp", "p");
  const nv = new XmlElement("nvGrpSpPr", "p");
  const cNvPr = new XmlElement("cNvPr", "p");
  cNvPr.setAttribute("id", String(id));
  cNvPr.setAttribute("name", `Spectra Group ${id}`);
  nv.appendChild(cNvPr);
  nv.appendChild(new XmlElement("cNvGrpSpPr", "p"));
  nv.appendChild(new XmlElement("nvPr", "p"));
  group.appendChild(nv);
  const grpSpPr = new XmlElement("grpSpPr", "p");
  const xfrm = new XmlElement("xfrm", "a");
  const off = new XmlElement("off", "a");
  off.setAttribute("x", "0"); off.setAttribute("y", "0");
  const ext = new XmlElement("ext", "a");
  ext.setAttribute("cx", "1"); ext.setAttribute("cy", "1");
  const childOff = new XmlElement("chOff", "a");
  childOff.setAttribute("x", "0"); childOff.setAttribute("y", "0");
  const childExt = new XmlElement("chExt", "a");
  childExt.setAttribute("cx", "1"); childExt.setAttribute("cy", "1");
  xfrm.appendChild(off); xfrm.appendChild(ext); xfrm.appendChild(childOff); xfrm.appendChild(childExt);
  grpSpPr.appendChild(xfrm);
  group.appendChild(grpSpPr);
  for (const childNode of children as XmlElement[]) {
    tree.removeChild(childNode);
    group.appendChild(childNode);
  }
  tree.appendChild(group);
  setShapeGeometry(group, operation);
  if (operation.readingOrder !== undefined) moveShapeToOrder(root, String(id), operation.readingOrder);
  return group;
}

async function setThemeFonts(deck: Presentation, fonts: { heading?: string; body?: string }) {
  const presentationPart = deck.office.package.getPart("/ppt/presentation.xml");
  const relationship = presentationPart?.relationships().byType(THEME_RELATIONSHIP)[0];
  const themePart = relationship && presentationPart ? deck.office.package.relatedPart(presentationPart, relationship.id) : undefined;
  if (!themePart) throw new PptxLensError("PPTX_THEME_MISSING", "This PowerPoint file has no theme part to update.");
  const root = (await deck.office.xml(themePart.name)).root;
  const update = (slot: string, value: string | undefined) => {
    if (!value) return;
    const family = descendants(root).find((node) => node.localName === slot)?.elements().find((node) => node.localName === "latin");
    if (family) family.setAttribute("typeface", value);
  };
  update("majorFont", fonts.heading);
  update("minorFont", fonts.body);
  deck.office.markDirty(themePart.name);
}

async function duplicateNativeSlide(deck: Presentation, sourceSlideId: string, title: string | undefined) {
  const source = slideFor(deck, sourceSlideId);
  const copy = deck.addSlide(source.layoutPartName ? { layoutPartName: source.layoutPartName } : {});
  const sourcePart = deck.office.package.getPart(source.partName);
  const copyPart = deck.office.package.getPart(copy.partName);
  if (!sourcePart || !copyPart) throw new PptxLensError("PPTX_SLIDE_MISSING", "The slide could not be duplicated safely.");
  copyPart.write(await sourcePart.read());
  const originalRelationships = sourcePart.relationships().all();
  copyPart.relationships().all().forEach((relation) => copyPart.relationships().remove(relation.id));
  const mapping = new Map<string, OpcPart>([[sourcePart.name.toLowerCase(), copyPart]]);
  for (const relation of originalRelationships) {
    const target = relation.targetMode === "External" ? undefined : deck.office.package.relatedPart(sourcePart, relation.id);
    if (relation.type === NOTES_SLIDE_RELATIONSHIP) {
      const sourceNotes = target;
      if (!sourceNotes) continue;
      const note = await cloneOwnedPartGraph(deck, sourceNotes, mapping, clonePartName(deck, sourceNotes.name));
      copyPart.relationships().add({ id: relation.id, type: relation.type, target: relativePartTarget(copy.partName, note.name) });
      continue;
    }
    if (relation.targetMode === "External") {
      copyPart.relationships().add({ id: relation.id, type: relation.type, target: relation.target, targetMode: "External" });
      continue;
    }
    const targetPart = target && relation.type !== SLIDE_RELATIONSHIP && !isSharedPptxPart(target)
      ? await cloneOwnedPartGraph(deck, target, mapping)
      : target;
    copyPart.relationships().add({
      id: relation.id,
      type: relation.type,
      target: targetPart ? relativePartTarget(copyPart.name, targetPart.name) : relation.target,
    });
  }
  if (title) {
    const copiedRoot = (await deck.office.xml(copy.partName)).root;
    const titleShapeRoot = titleShape(copiedRoot);
    if (titleShapeRoot) replaceShapeText(titleShapeRoot, title);
    else addTextBox(copiedRoot, title);
    deck.office.markDirty(copy.partName);
  }
  return copy;
}

function child(root: XmlElement, namespace: string, localName: string) {
  return root.elements().find((node) => node.namespaceUri() === namespace && node.localName === localName);
}

function ensureChild(root: XmlElement, namespace: string, prefix: string, localName: string) {
  return child(root, namespace, localName) ?? (() => {
    const element = new XmlElement(localName, prefix);
    root.appendChild(element);
    return element;
  })();
}

function clearChildren(root: XmlElement) {
  root.elements().slice().forEach((element) => root.removeChild(element));
  root.children
    .filter((node): node is XmlText => node.kind === "text")
    .slice()
    .forEach((node) => root.removeChild(node));
}

function setTextElement(root: XmlElement, value: string) {
  clearChildren(root);
  root.appendChild(new XmlText(value));
}

function nativeColor(value: unknown) {
  if (typeof value !== "string") return undefined;
  const tokens: Record<string, string> = {
    "var(--accent-mint)": "159B76",
    "var(--accent)": "6A4DE8",
    "var(--bg-elevated)": "FFFEFD",
    "var(--bg-primary)": "FBFAF8",
    "var(--bg-secondary)": "F6F4F0",
    "var(--text-primary)": "211F1C",
    "var(--text-secondary)": "65615B",
    "var(--border-strong)": "D4D0C8",
  };
  const raw = tokens[value.trim()] ?? value.trim();
  const match = raw.match(/^#?([0-9a-f]{6})$/i);
  return match?.[1]?.toUpperCase();
}

function ensureRunProperties(run: XmlElement) {
  return child(run, DRAWINGML_NAMESPACE, "rPr") ?? (() => {
    const properties = new XmlElement("rPr", "a");
    run.insertBefore(properties, run.elements()[0] ?? null);
    return properties;
  })();
}

function ensureColor(properties: XmlElement, color: string) {
  const fill = ensureChild(properties, DRAWINGML_NAMESPACE, "a", "solidFill");
  const rgb = ensureChild(fill, DRAWINGML_NAMESPACE, "a", "srgbClr");
  rgb.setAttribute("val", color);
  fill.elements()
    .filter((element) => element !== rgb && ["schemeClr", "scrgbClr", "hslClr", "sysClr", "prstClr"].includes(element.localName))
    .forEach((element) => fill.removeChild(element));
}

function setTextFormat(shape: XmlElement, format: {
  fontFamily?: string | null;
  fontSizePt?: number | null;
  bold?: boolean | null;
  italic?: boolean | null;
  underline?: boolean | null;
  strike?: boolean | null;
  color?: string | null;
  align?: "left" | "center" | "right" | "justify" | null;
  level?: number | null;
}) {
  const paragraphs = descendants(shape).filter((node) => node.namespaceUri() === DRAWINGML_NAMESPACE && node.localName === "p");
  if (!paragraphs.length) throw new PptxLensError("PPTX_TEXT_MISSING", "The target shape has no editable text paragraphs.");
  for (const paragraph of paragraphs) {
    const paragraphProperties = ensureChild(paragraph, DRAWINGML_NAMESPACE, "a", "pPr");
    if (format.align !== undefined) {
      if (format.align === null) paragraphProperties.removeAttribute("algn");
      else paragraphProperties.setAttribute("algn", format.align === "center" ? "ctr" : format.align === "right" ? "r" : format.align === "justify" ? "just" : "l");
    }
    if (format.level !== undefined) {
      if (format.level === null) paragraphProperties.removeAttribute("lvl");
      else paragraphProperties.setAttribute("lvl", String(format.level));
    }
    for (const run of descendants(paragraph).filter((node) => node.namespaceUri() === DRAWINGML_NAMESPACE && ["r", "fld"].includes(node.localName))) {
      const properties = ensureRunProperties(run);
      if (format.fontSizePt !== undefined) {
        if (format.fontSizePt === null) properties.removeAttribute("sz");
        else properties.setAttribute("sz", String(Math.round(format.fontSizePt * 100)));
      }
      if (format.bold !== undefined) {
        if (format.bold === null || !format.bold) properties.removeAttribute("b");
        else properties.setAttribute("b", "1");
      }
      if (format.italic !== undefined) {
        if (format.italic === null || !format.italic) properties.removeAttribute("i");
        else properties.setAttribute("i", "1");
      }
      if (format.underline !== undefined) {
        if (format.underline === null) properties.removeAttribute("u");
        else properties.setAttribute("u", format.underline ? "sng" : "none");
      }
      if (format.strike !== undefined) {
        if (format.strike === null) properties.removeAttribute("strike");
        else properties.setAttribute("strike", format.strike ? "sngStrike" : "noStrike");
      }
      if (format.fontFamily !== undefined && format.fontFamily !== null) {
        const latin = ensureChild(properties, DRAWINGML_NAMESPACE, "a", "latin");
        latin.setAttribute("typeface", format.fontFamily);
      } else if (format.fontFamily === null) {
        const latin = child(properties, DRAWINGML_NAMESPACE, "latin");
        if (latin) properties.removeChild(latin);
      }
      if (format.color !== undefined) {
        const color = nativeColor(format.color);
        if (color) ensureColor(properties, color);
        else if (format.color === null) {
          const fill = child(properties, DRAWINGML_NAMESPACE, "solidFill");
          if (fill) properties.removeChild(fill);
        }
      }
    }
    if (!paragraph.elements().some((node) => node.namespaceUri() === DRAWINGML_NAMESPACE && node.localName === "endParaRPr")) paragraph.appendChild(new XmlElement("endParaRPr", "a"));
  }
}

function setRichText(
  deck: Presentation,
  slidePartName: string,
  shape: XmlElement,
  paragraphs: PresentationParagraph[],
  resolveLinkSlideId?: (slideId: string) => string,
) {
  const txBody = descendants(shape).find((node) => [PML_NAMESPACE, DRAWINGML_NAMESPACE].includes(node.namespaceUri() ?? "") && node.localName === "txBody");
  if (!txBody) throw new PptxLensError("PPTX_TEXT_MISSING", "The target PowerPoint object has no editable text body.");
  txBody.elements()
    .filter((node) => node.namespaceUri() === DRAWINGML_NAMESPACE && node.localName === "p")
    .forEach((paragraph) => txBody.removeChild(paragraph));
  for (const input of paragraphs) {
    const paragraph = new XmlElement("p", "a");
    if (input.alignment || input.level !== undefined || input.bullet && input.bullet !== "none") {
      const properties = new XmlElement("pPr", "a");
      if (input.alignment) properties.setAttribute("algn", input.alignment === "center" ? "ctr" : input.alignment === "right" ? "r" : input.alignment === "justify" ? "just" : "l");
      if (input.level !== undefined) properties.setAttribute("lvl", String(input.level));
      if (input.bullet === "bullet") {
        const bullet = new XmlElement("buChar", "a");
        bullet.setAttribute("char", "•");
        properties.appendChild(bullet);
      } else if (input.bullet === "numbered") {
        const numbered = new XmlElement("buAutoNum", "a");
        numbered.setAttribute("type", "arabicPeriod");
        properties.appendChild(numbered);
      }
      paragraph.appendChild(properties);
    }
    for (const inputRun of input.runs) {
      const run = new XmlElement("r", "a");
      const properties = new XmlElement("rPr", "a");
      if (inputRun.fontSizePt !== undefined) properties.setAttribute("sz", String(Math.round(inputRun.fontSizePt * 100)));
      if (inputRun.bold !== undefined) properties.setAttribute("b", inputRun.bold ? "1" : "0");
      if (inputRun.italic !== undefined) properties.setAttribute("i", inputRun.italic ? "1" : "0");
      if (inputRun.underline !== undefined) properties.setAttribute("u", inputRun.underline ? "sng" : "none");
      if (inputRun.strike !== undefined) properties.setAttribute("strike", inputRun.strike ? "sngStrike" : "noStrike");
      if (inputRun.fontFamily) ensureChild(properties, DRAWINGML_NAMESPACE, "a", "latin").setAttribute("typeface", inputRun.fontFamily);
      const color = nativeColor(inputRun.color);
      if (color) ensureColor(properties, color);
      const requestedHyperlink = normalizePresentationHyperlink(inputRun.hyperlink);
      const hyperlink = requestedHyperlink?.kind === "slide"
        ? { kind: "slide" as const, slideId: resolveLinkSlideId?.(requestedHyperlink.slideId) ?? requestedHyperlink.slideId }
        : requestedHyperlink;
      if (hyperlink) setHyperlink(deck, slidePartName, properties, hyperlink);
      run.appendChild(properties);
      const text = new XmlElement("t", "a");
      text.appendChild(new XmlText(inputRun.text));
      run.appendChild(text);
      paragraph.appendChild(run);
    }
    paragraph.appendChild(new XmlElement("endParaRPr", "a"));
    txBody.appendChild(paragraph);
  }
}

function clonePartName(deck: Presentation, sourceName: string) {
  const slash = sourceName.lastIndexOf("/");
  const folder = sourceName.slice(0, slash);
  const file = sourceName.slice(slash + 1);
  const extension = file.includes(".") ? file.slice(file.lastIndexOf(".")) : "";
  const stem = extension ? file.slice(0, -extension.length) : file;
  const numeric = stem.match(/^(.*?)(\d+)$/);
  const prefix = numeric?.[1] ?? `${stem}-copy`;
  let index = numeric ? Number(numeric[2]) + 1 : 1;
  const used = new Set(deck.office.package.parts().map((part) => part.name.toLowerCase()));
  let candidate = `${folder}/${prefix}${index}${extension}`;
  while (used.has(candidate.toLowerCase())) {
    index += 1;
    candidate = `${folder}/${prefix}${index}${extension}`;
  }
  return candidate;
}

function isSharedPptxPart(part: OpcPart) {
  return (
    /\/ppt\/(?:slideLayouts|slideMasters|theme|media|notesMasters)\//i.test(part.name) ||
    /image\//i.test(part.contentType)
  );
}

async function cloneOwnedPartGraph(
  deck: Presentation,
  source: OpcPart,
  mapping: Map<string, OpcPart>,
  forcedName?: string,
): Promise<OpcPart> {
  const key = source.name.toLowerCase();
  const existing = mapping.get(key);
  if (existing) return existing;
  const copy = deck.office.package.addPart(
    forcedName ?? clonePartName(deck, source.name),
    source.contentType,
    await source.read(),
  );
  mapping.set(key, copy);
  for (const relation of source.relationships().all()) {
    if (relation.targetMode === "External") {
      copy.relationships().add({ id: relation.id, type: relation.type, target: relation.target, targetMode: "External" });
      continue;
    }
    const target = deck.office.package.relatedPart(source, relation.id);
    const mappedTarget = target && mapping.get(target.name.toLowerCase());
    const shouldClone = Boolean(target && relation.type !== SLIDE_RELATIONSHIP && !isSharedPptxPart(target));
    const targetPart = mappedTarget ?? (target && shouldClone
      ? await cloneOwnedPartGraph(deck, target, mapping)
      : target);
    copy.relationships().add({
      id: relation.id,
      type: relation.type,
      target: targetPart ? relativePartTarget(copy.name, targetPart.name) : relation.target,
      ...(relation.targetMode ? { targetMode: relation.targetMode } : {}),
    });
  }
  return copy;
}

function exclusiveDependencyRoots(deck: Presentation, part: OpcPart) {
  return part.relationships().all()
    .filter((relation) => relation.targetMode !== "External" && relation.type !== SLIDE_RELATIONSHIP && relation.type !== NOTES_SLIDE_RELATIONSHIP)
    .map((relation) => deck.office.package.relatedPart(part, relation.id))
    .filter((target): target is OpcPart => target !== undefined && !isSharedPptxPart(target));
}

function releaseUnreferencedOwnedParts(deck: Presentation, roots: OpcPart[]) {
  const packageParts = () => deck.office.package.parts();
  const referenced = (name: string) => packageParts().some((part) =>
    part.name !== name && part.relationships().all().some((relation) =>
      relation.targetMode !== "External" && resolveRelationshipTarget(part.name, relation.target).toLowerCase() === name.toLowerCase(),
    ),
  );
  const visited = new Set<string>();
  const visit = (part: OpcPart) => {
    const key = part.name.toLowerCase();
    if (visited.has(key) || isSharedPptxPart(part) || referenced(part.name)) return;
    visited.add(key);
    const children = exclusiveDependencyRoots(deck, part);
    deck.office.package.removePart(part.name);
    children.forEach(visit);
  };
  roots.forEach(visit);
}

function setShapeStyle(shape: XmlElement, style: Record<string, unknown>) {
  const properties = firstDescendant(shape, PML_NAMESPACE, "spPr");
  if (!properties) throw new PptxLensError("PPTX_SHAPE_PROPS_MISSING", "This PowerPoint object has no editable shape properties.");
  if (Object.prototype.hasOwnProperty.call(style, "fill")) {
    const fillColor = nativeColor(style.fill);
    const fill = child(properties, DRAWINGML_NAMESPACE, "solidFill");
    if (fillColor) ensureColor(properties, fillColor);
    else if (fill) properties.removeChild(fill);
  }
  const line = ensureChild(properties, DRAWINGML_NAMESPACE, "a", "ln");
  if (Object.prototype.hasOwnProperty.call(style, "stroke")) {
    const strokeColor = nativeColor(style.stroke);
    if (!strokeColor) {
      const lineFill = child(line, DRAWINGML_NAMESPACE, "solidFill");
      if (lineFill) line.removeChild(lineFill);
    } else {
    const lineFill = ensureChild(line, DRAWINGML_NAMESPACE, "a", "solidFill");
    const lineRgb = ensureChild(lineFill, DRAWINGML_NAMESPACE, "a", "srgbClr");
    lineRgb.setAttribute("val", strokeColor);
    }
  }
  if (typeof style.strokeWidth === "number") line.setAttribute("w", String(Math.max(0, Math.round(style.strokeWidth * 12700))));
  const radius = typeof style.cornerRadius === "number" ? style.cornerRadius : style.radius;
  if (typeof radius === "number") {
    const geometry = child(properties, DRAWINGML_NAMESPACE, "prstGeom");
    if (geometry) geometry.setAttribute("prst", radius > 0 ? "roundRect" : "rect");
  }
  if (typeof style.opacity === "number") {
    const alpha = Math.max(0, Math.min(100000, Math.round(style.opacity * 100000)));
    const fill = child(properties, DRAWINGML_NAMESPACE, "solidFill");
    const rgb = fill ? child(fill, DRAWINGML_NAMESPACE, "srgbClr") : undefined;
    if (rgb) ensureChild(rgb, DRAWINGML_NAMESPACE, "a", "alpha").setAttribute("val", String(alpha));
  }
}

function setImageCrop(shape: XmlElement, crop: { left: number; top: number; right: number; bottom: number }) {
  const blipFill = firstDescendant(shape, PML_NAMESPACE, "blipFill");
  if (!blipFill) throw new PptxLensError("PPTX_IMAGE_MISSING", "This picture has no editable fill to crop.");
  const source = ensureChild(blipFill, DRAWINGML_NAMESPACE, "a", "srcRect");
  for (const [key, value] of Object.entries({ l: crop.left, t: crop.top, r: crop.right, b: crop.bottom })) {
    const amount = Math.max(0, Math.min(100000, Math.round(value * 1000)));
    if (amount) source.setAttribute(key, String(amount));
    else source.removeAttribute(key);
  }
}

function setTableCellFormat(shape: XmlElement, rowIndex: number, columnIndex: number, format: Record<string, unknown>) {
  const row = descendants(shape).filter((node) => node.namespaceUri() === DRAWINGML_NAMESPACE && node.localName === "tr")[rowIndex];
  const cell = row ? descendants(row).filter((node) => node.namespaceUri() === DRAWINGML_NAMESPACE && node.localName === "tc")[columnIndex] : undefined;
  if (!cell) throw new PptxLensError("PPTX_TABLE_CELL_MISSING", "The target PowerPoint table cell no longer exists.");
  const properties = ensureChild(cell, DRAWINGML_NAMESPACE, "a", "tcPr");
  const fillColor = nativeColor(format.fill ?? format.fillColor);
  if (fillColor) ensureColor(properties, fillColor);
  setTextFormat(cell, {
    ...(typeof format.fontFamily === "string" ? { fontFamily: format.fontFamily } : {}),
    ...(typeof format.fontSizePt === "number" ? { fontSizePt: format.fontSizePt } : {}),
    ...(typeof format.bold === "boolean" ? { bold: format.bold } : {}),
    ...(typeof format.italic === "boolean" ? { italic: format.italic } : {}),
    ...(typeof format.underline === "boolean" ? { underline: format.underline } : {}),
    ...(typeof format.color === "string" ? { color: format.color } : {}),
  });
}

function setTableCellText(shape: XmlElement, rowIndex: number, columnIndex: number, value: string) {
  const row = descendants(shape).filter((node) => node.namespaceUri() === DRAWINGML_NAMESPACE && node.localName === "tr")[rowIndex];
  const cell = row ? descendants(row).filter((node) => node.namespaceUri() === DRAWINGML_NAMESPACE && node.localName === "tc")[columnIndex] : undefined;
  if (!cell) throw new PptxLensError("PPTX_TABLE_CELL_MISSING", "The target PowerPoint table cell no longer exists.");
  replaceShapeText(cell, value);
}

function updateCache(cache: XmlElement, values: Array<string | number>, numeric: boolean) {
  const points = cache.elements().filter((node) => node.localName === "pt");
  points.forEach((point) => cache.removeChild(point));
  if (numeric) {
    const format = child(cache, "http://schemas.openxmlformats.org/drawingml/2006/chart", "formatCode") ?? (() => {
      const created = new XmlElement("formatCode", "c");
      const before = cache.elements().find((node) => node.localName === "ptCount");
      cache.insertBefore(created, before ?? null);
      return created;
    })();
    setTextElement(format, "General");
  }
  const count = child(cache, "http://schemas.openxmlformats.org/drawingml/2006/chart", "ptCount") ?? (() => {
    const value = new XmlElement("ptCount", "c");
    cache.insertBefore(value, cache.elements()[0] ?? null);
    return value;
  })();
  count.setAttribute("val", String(values.length));
  values.forEach((value, index) => {
    const point = new XmlElement("pt", "c");
    point.setAttribute("idx", String(index));
    const text = new XmlElement("v", "c");
    text.appendChild(new XmlText(String(value)));
    point.appendChild(text);
    cache.appendChild(point);
  });
}

function formulaCells(formula: string) {
  const match = formula.match(/^(?:'([^']+)'|([^!]+))!\$?([A-Z]+)\$?(\d+)(?::\$?([A-Z]+)\$?(\d+))?$/i);
  if (!match) return [] as string[];
  const sheetName = match[1] ?? match[2];
  void sheetName;
  const startColumn = match[3]!.toUpperCase();
  const startRow = Number(match[4]);
  const endColumn = (match[5] ?? startColumn).toUpperCase();
  const endRow = Number(match[6] ?? startRow);
  const columnNumber = (value: string) => [...value].reduce((total, char) => total * 26 + char.charCodeAt(0) - 64, 0);
  const columnName = (value: number) => {
    let output = "";
    for (let current = value; current > 0; current = Math.floor((current - 1) / 26)) output = String.fromCharCode(65 + ((current - 1) % 26)) + output;
    return output;
  };
  const refs: string[] = [];
  for (let row = startRow; row <= endRow; row += 1) {
    for (let column = columnNumber(startColumn); column <= columnNumber(endColumn); column += 1) refs.push(`${columnName(column)}${row}`);
  }
  return refs;
}

function formulaShape(formula: string) {
  const match = formula.match(/^(?:'([^']+)'|([^!]+))!\$?([A-Z]+)\$?(\d+)(?::\$?([A-Z]+)\$?(\d+))?$/i);
  if (!match) return undefined;
  return {
    sheet: match[1] ?? match[2],
    startColumn: match[3]!.toUpperCase(),
    startRow: Number(match[4]),
    endColumn: (match[5] ?? match[3]).toUpperCase(),
    endRow: Number(match[6] ?? match[4]),
  };
}

function columnNumber(value: string) {
  return [...value].reduce((total, char) => total * 26 + char.charCodeAt(0) - 64, 0);
}

function columnName(value: number) {
  let output = "";
  for (let current = value; current > 0; current = Math.floor((current - 1) / 26))
    output = String.fromCharCode(65 + ((current - 1) % 26)) + output;
  return output;
}

function resizedFormula(formula: string | undefined, seriesIndex: number, count: number, columnBySeries: boolean) {
  const shape = formula && formulaShape(formula);
  if (!shape) return formula;
  const shift = columnBySeries ? seriesIndex : 0;
  const startColumn = columnName(columnNumber(shape.startColumn) + shift);
  const endColumn = columnName(columnNumber(shape.endColumn) + shift);
  const endRow = shape.startRow + Math.max(0, count - 1);
  const prefix = /'/.test(formula.slice(0, formula.indexOf("!"))) ? `'${shape.sheet}'` : shape.sheet;
  return `${prefix}!$${startColumn}$${shape.startRow}:$${endColumn}$${endRow}`;
}

async function updateEmbeddedWorkbook(
  deck: Presentation,
  chartPart: OpcPart,
  root: XmlElement,
  series: Array<{ name: string; categories: string[]; values: number[] }>,
) {
  const packageRelationship = chartPart.relationships().byType("http://schemas.openxmlformats.org/officeDocument/2006/relationships/package")[0];
  if (!packageRelationship || packageRelationship.targetMode === "External") return;
  const workbookPart = deck.office.package.relatedPart(chartPart, packageRelationship.id);
  if (!workbookPart) return;
  let workbook: Workbook;
  try { workbook = await Workbook.open(await workbookPart.read()); } catch { return; }
  const serNodes = descendants(root).filter((node) => node.localName === "ser");
  let changed = false;
  series.forEach((item, index) => {
    const ser = serNodes[index];
    if (!ser) return;
    const write = (referenceName: "tx" | "cat" | "val", values: Array<string | number>) => {
      const reference = descendants(ser).find((node) => node.localName === referenceName && descendants(node).some((child) => child.localName === "f"));
      const formula = reference ? descendants(reference).find((node) => node.localName === "f")?.text() : undefined;
      if (!formula) return;
      const sheetMatch = formula.match(/^(?:'([^']+)'|([^!]+))!/);
      const sheet = workbook.sheet(sheetMatch?.[1] ?? sheetMatch?.[2] ?? "");
      if (!sheet) return;
      formulaCells(formula).forEach((ref, valueIndex) => {
        if (values[valueIndex] !== undefined) sheet.setCell(ref, values[valueIndex] as string | number);
      });
      changed = true;
    };
    write("tx", [item.name]);
    write("cat", item.categories);
    write("val", item.values);
  });
  if (changed) workbookPart.write(await workbook.save());
}

function chartTextElement(root: XmlElement, value: string) {
  const chartNamespace = "http://schemas.openxmlformats.org/drawingml/2006/chart";
  const owner = root.localName === "catAx" || root.localName === "valAx"
    ? ensureChild(root, chartNamespace, "c", "title")
    : root;
  const tx = ensureChild(owner, chartNamespace, "c", "tx");
  const rich = ensureChild(tx, "http://schemas.openxmlformats.org/drawingml/2006/chart", "c", "rich");
  const bodyPr = child(rich, DRAWINGML_NAMESPACE, "bodyPr") ?? (() => {
    const created = new XmlElement("bodyPr", "a");
    rich.insertBefore(created, rich.elements()[0] ?? null);
    return created;
  })();
  const firstParagraph = rich.elements().find((node) => node.namespaceUri() === DRAWINGML_NAMESPACE && node.localName === "p");
  const lstStyle = child(rich, DRAWINGML_NAMESPACE, "lstStyle") ?? (() => {
    const created = new XmlElement("lstStyle", "a");
    rich.insertBefore(created, firstParagraph ?? null);
    return created;
  })();
  if (bodyPr.parent === rich && rich.elements()[0] !== bodyPr) {
    rich.removeChild(bodyPr); rich.insertBefore(bodyPr, rich.elements()[0] ?? null);
  }
  if (lstStyle.parent === rich && rich.elements().indexOf(lstStyle) > rich.elements().indexOf(firstParagraph ?? lstStyle)) {
    rich.removeChild(lstStyle); rich.insertBefore(lstStyle, firstParagraph ?? null);
  }
  const paragraph = ensureChild(rich, DRAWINGML_NAMESPACE, "a", "p");
  const run = ensureChild(paragraph, DRAWINGML_NAMESPACE, "a", "r");
  const text = ensureChild(run, DRAWINGML_NAMESPACE, "a", "t");
  setTextElement(text, value);
}

function setChartType(root: XmlElement, type: "bar" | "column" | "line" | "pie" | "area") {
  const chartNamespace = "http://schemas.openxmlformats.org/drawingml/2006/chart";
  const chartRoot = child(root, chartNamespace, "chart");
  const plotArea = chartRoot && child(chartRoot, chartNamespace, "plotArea");
  if (!plotArea) return;
  const localName = type === "line" ? "lineChart" : type === "pie" ? "pieChart" : type === "area" ? "areaChart" : "barChart";
  const existing = plotArea.elements().find((node) => ["barChart", "lineChart", "pieChart", "areaChart"].includes(node.localName));
  let chart = existing;
  if (existing && existing.localName !== localName) {
    const replacement = new XmlElement(localName, "c");
    for (const node of existing.elements().slice()) {
      existing.removeChild(node);
      replacement.appendChild(node);
    }
    plotArea.insertBefore(replacement, existing);
    plotArea.removeChild(existing);
    chart = replacement;
  }
  if (!chart) return;
  const barDirection = child(chart, chartNamespace, "barDir");
  if (localName === "barChart") {
    const direction = barDirection ?? new XmlElement("barDir", "c");
    direction.setAttribute("val", type === "column" ? "col" : "bar");
    if (!barDirection) chart.insertBefore(direction, chart.elements()[0] ?? null);
  } else if (barDirection) chart.removeChild(barDirection);
}

async function setChartContent(deck: Presentation, slidePartName: string, shapeIdValue: string, input: {
  chartType?: "bar" | "column" | "line" | "pie" | "area";
  title?: string | null;
  categories: string[];
  series: Array<{ id?: string; name: string; categories: string[]; values: number[] }>;
  showLegend?: boolean;
  axisTitle?: string | null;
  valueAxisTitle?: string | null;
  sourceArtifactId?: string;
  sourceChartId?: string;
  sourceRevision?: string;
  sourceKind?: "artifact" | "sheets_range";
  sourceRange?: string;
  sourceLive?: boolean;
}) {
  const slidePart = deck.office.package.getPart(slidePartName);
  const shape = slidePart ? shapeIn((await deck.office.xml(slidePartName)).root, shapeIdValue) : undefined;
  const chartRef = shape ? firstDescendant(shape, "http://schemas.openxmlformats.org/drawingml/2006/chart", "chart") : undefined;
  const rid = chartRef?.getAttributeNs(OFFICE_RELATIONSHIPS_NAMESPACE, "id");
  const chartPart = rid && slidePart ? deck.office.package.relatedPart(slidePart, rid) : undefined;
  if (!chartPart) throw new PptxLensError("PPTX_CHART_MISSING", "The chart has no native chart part to update.");
  const root = (await deck.office.xml(chartPart.name)).root;
  const chartNamespace = "http://schemas.openxmlformats.org/drawingml/2006/chart";
  if (input.chartType) setChartType(root, input.chartType);
  const chartRoot = child(root, chartNamespace, "chart") ?? root;
  const chartTitle = firstDescendant(chartRoot, chartNamespace, "title");
  if (input.title !== undefined) {
    if (input.title === null) {
      if (chartTitle) chartRoot.removeChild(chartTitle);
    } else {
      const title = chartTitle ?? (() => {
        const created = new XmlElement("title", "c");
        const before = chartRoot.elements().find((node) => ["plotArea", "legend", "plotVisOnly", "dispBlanksAs", "showDLbls", "extLst"].includes(node.localName));
        chartRoot.insertBefore(created, before ?? null);
        return created;
      })();
      chartTextElement(title, input.title);
    }
  }
  if (!input.series.length) throw new PptxLensError("PPTX_CHART_EMPTY", "A native PowerPoint chart needs at least one series.");
  const initialSeriesNodes = descendants(root).filter((node) => node.localName === "ser");
  const template = initialSeriesNodes[0];
  const plotChart = template?.parent ?? descendants(root).find((node) => ["barChart", "lineChart", "pieChart", "areaChart"].includes(node.localName));
  if (!plotChart) throw new PptxLensError("PPTX_CHART_SERIES_MISSING", "The native chart has no editable series container.");
  const seriesNodes = initialSeriesNodes.slice();
  while (seriesNodes.length < input.series.length) {
    const copy = (seriesNodes[seriesNodes.length - 1] ?? template)?.clone();
    if (!copy) throw new PptxLensError("PPTX_CHART_SERIES_MISSING", "The native chart has no series template for the requested data.");
    plotChart.appendChild(copy);
    seriesNodes.push(copy);
  }
  const firstTxFormula = template && descendants(template).find((node) => node.localName === "tx")
    ? descendants(descendants(template).find((node) => node.localName === "tx")!).find((node) => node.localName === "f")?.text()
    : undefined;
  const firstCategoryFormula = template && descendants(template).find((node) => node.localName === "cat")
    ? descendants(descendants(template).find((node) => node.localName === "cat")!).find((node) => node.localName === "f")?.text()
    : undefined;
  const firstValueFormula = template && descendants(template).find((node) => node.localName === "val")
    ? descendants(descendants(template).find((node) => node.localName === "val")!).find((node) => node.localName === "f")?.text()
    : undefined;
  input.series.forEach((series, index) => {
    const node = seriesNodes[index]!;
    const idx = ensureChild(node, chartNamespace, "c", "idx");
    const order = ensureChild(node, chartNamespace, "c", "order");
    idx.setAttribute("val", String(index));
    order.setAttribute("val", String(index));
    const tx = ensureChild(node, chartNamespace, "c", "tx");
    const txRef = ensureChild(tx, chartNamespace, "c", "strRef");
    const txFormula = descendants(node).find((candidate) => candidate.localName === "tx") === tx
      ? descendants(txRef).find((candidate) => candidate.localName === "f")?.text() ?? firstTxFormula
      : firstTxFormula;
    const txF = ensureChild(txRef, chartNamespace, "c", "f");
    setTextElement(txF, resizedFormula(txFormula, index, 1, true) ?? `'Sheet1'!$B$1`);
    updateCache(ensureChild(txRef, chartNamespace, "c", "strCache"), [series.name], false);
    const categories = series.categories.length ? series.categories : input.categories;
    const category = ensureChild(ensureChild(node, chartNamespace, "c", "cat"), chartNamespace, "c", "strRef");
    const categoryF = ensureChild(category, chartNamespace, "c", "f");
    setTextElement(categoryF, resizedFormula(descendants(category).find((candidate) => candidate.localName === "f")?.text() ?? firstCategoryFormula, index, categories.length, false) ?? `'Sheet1'!$A$2:$A$${Math.max(2, categories.length + 1)}`);
    updateCache(ensureChild(category, chartNamespace, "c", "strCache"), categories, false);
    const value = ensureChild(ensureChild(node, chartNamespace, "c", "val"), chartNamespace, "c", "numRef");
    const valueF = ensureChild(value, chartNamespace, "c", "f");
    setTextElement(valueF, resizedFormula(descendants(value).find((candidate) => candidate.localName === "f")?.text() ?? firstValueFormula, index, series.values.length, true) ?? `'Sheet1'!$B$2:$B$${Math.max(2, series.values.length + 1)}`);
    updateCache(ensureChild(value, chartNamespace, "c", "numCache"), series.values, true);
  });
  seriesNodes.slice(input.series.length).forEach((node) => node.parent?.removeChild(node));
  const legend = child(firstDescendant(root, chartNamespace, "chart") ?? root, chartNamespace, "legend");
  if (input.showLegend === false && legend) chartRoot.removeChild(legend);
  if (input.showLegend === true && !legend) {
    const created = new XmlElement("legend", "c");
    const before = chartRoot.elements().find((node) => ["plotVisOnly", "dispBlanksAs", "showDLbls", "extLst"].includes(node.localName));
    chartRoot.insertBefore(created, before ?? null);
  }
  const axes = descendants(root).filter((node) => node.localName === "catAx" || node.localName === "valAx");
  if (input.axisTitle !== undefined) {
    const axis = axes.find((node) => node.localName === "catAx");
    if (axis) {
      const title = child(axis, chartNamespace, "title");
      if (input.axisTitle === null) { if (title) axis.removeChild(title); }
      else chartTextElement(axis, input.axisTitle);
    }
  }
  if (input.valueAxisTitle !== undefined) {
    const axis = axes.find((node) => node.localName === "valAx");
    if (axis) {
      const title = child(axis, chartNamespace, "title");
      if (input.valueAxisTitle === null) { if (title) axis.removeChild(title); }
      else chartTextElement(axis, input.valueAxisTitle);
    }
  }
  const extensionList = ensureChild(root, chartNamespace, "c", "extLst");
  const extension = extensionList.elements().find((node) => node.namespaceUri() === chartNamespace && node.localName === "ext" && node.getAttribute("uri") === "{7C2F2D16-5F5B-4D07-9EA9-SPECTRA-BRIDGE}") ?? (() => {
    const created = new XmlElement("ext", "c");
    created.setAttribute("uri", "{7C2F2D16-5F5B-4D07-9EA9-SPECTRA-BRIDGE}");
    extensionList.appendChild(created);
    return created;
  })();
  const sourcePrefix = extension.ensurePrefix(SPECTRA_CHART_SOURCE_NAMESPACE, "spectra");
  const source = extension.elements().find((node) => node.namespaceUri() === SPECTRA_CHART_SOURCE_NAMESPACE && node.localName === "source") ?? (() => {
    const created = new XmlElement("source", sourcePrefix);
    extension.appendChild(created);
    return created;
  })();
  for (const [attribute, value] of [["artifactId", input.sourceArtifactId], ["chartId", input.sourceChartId], ["revision", input.sourceRevision], ["kind", input.sourceKind], ["range", input.sourceRange], ["live", input.sourceLive === undefined ? undefined : input.sourceLive ? "1" : "0"]] as const) {
    if (value !== undefined) source.setAttribute(attribute, value);
    else source.removeAttribute(attribute);
  }
  // Do not leave stale bridge metadata behind after a chart is unbound.
  if (!input.sourceArtifactId && !input.sourceChartId && !input.sourceRevision && !input.sourceKind && !input.sourceRange && input.sourceLive === undefined) extension.removeChild(source);
  deck.office.markDirty(chartPart.name);
  await updateEmbeddedWorkbook(deck, chartPart, root, input.series);
}

async function applyDelta(carry: LensPreservedCarry<PptxProjection>, delta: PptxSemanticDelta) {
  const deck = await Presentation.open(carry.safePayload ?? carry.payload); const operations = delta.kind === "ai-edit" ? delta.operations : [delta];
  // A slide added in this delta has no part until it exists, so its caller-side
  // id is mapped to the real one and every later operation in the same delta —
  // including the order — can still name it.
  const born = new Map<string, string>();
  const resolveSlideId = (slideId: string) => born.get(slideId) ?? slideId;
  for (const operation of operations) {
    if (operation.kind === "set-theme-fonts") {
      await setThemeFonts(deck, operation);
      continue;
    }
    if (operation.kind === "add-slide") {
      const slide = addNativeSlide(deck, operation.layoutPartName, operation.title, operation.text, operation.objects);
      born.set(operation.slideId, `pptx:slide:${slide.partName}`);
      continue;
    }
    if (operation.kind === "duplicate-slide") {
      const slide = await duplicateNativeSlide(deck, resolveSlideId(operation.slideId), operation.title);
      born.set(operation.newSlideId, `pptx:slide:${slide.partName}`);
      continue;
    }
    if (operation.kind === "remove-slide") {
      const doomed = slideFor(deck, resolveSlideId(operation.slideId));
      const doomedPart = deck.office.package.getPart(doomed.partName);
      const ownedDependencies = doomedPart ? exclusiveDependencyRoots(deck, doomedPart) : [];
      const index = doomed.index;
      if (index < 0) throw new PptxLensError("PPTX_SLIDE_MISSING", "The slide being removed is no longer in this deck.");
      await removeHyperlinksToSlide(deck, doomed.partName);
      // The library deletes the slide part, its .rels, its content-type
      // override and its own notes page, and leaves shared targets — layouts,
      // masters, media — exactly where they were.
      deck.removeSlide(index);
      releaseUnreferencedOwnedParts(deck, ownedDependencies);
      continue;
    }
    if (operation.kind === "reorder-slides") {
      await reorderSlides(deck, operation.order.map((id) => resolveSlideId(id).replace(/^pptx:slide:/, "")));
      continue;
    }
    const slide = slideFor(deck, resolveSlideId(operation.slideId));
    if (operation.kind === "add-text-box") {
      const added = addTextBox(slide.root(), operation.text);
      const link = normalizePresentationHyperlink(operation.hyperlink);
      if (link) {
        const owner = firstDescendant(added, PML_NAMESPACE, "cNvPr");
        if (owner) setHyperlink(deck, slide.partName, owner, link);
      }
      deck.office.markDirty(slide.partName);
    }
    else if (operation.kind === "group-objects") {
      addNativeGroup((await deck.office.xml(slide.partName)).root, operation);
      deck.office.markDirty(slide.partName);
    }
    else if (operation.kind === "set-title") {
      try {
        slide.setTitle(operation.text);
      } catch {
        // Picture-only layouts have no title placeholder. A text box is the
        // same native write add-slide already uses, so the title does not
        // surface as an uncoded library exception.
        addTextBox(slide.root(), operation.text);
        deck.office.markDirty(slide.partName);
      }
    }
    else if (operation.kind === "set-text") {
      const owner = operation.shapeId ? shapeIn(slide.root(), operation.shapeId) : undefined;
      if (owner) replaceShapeText(owner, operation.text);
      else {
        const node = textNodes(slide.root())[operation.paragraphIndex];
        if (!node) throw new PptxLensError("PPTX_TEXT_MISSING", "The target PowerPoint text run no longer exists.");
        replaceNodeText(node, operation.text);
      }
      deck.office.markDirty(slide.partName);
    }
    else if (operation.kind === "set-notes") {
      // Only the notes part is marked dirty, so the slide itself — with its
      // transition, its timing and everything Spectra does not model — is still
      // raw-copied at save.
      const notesPartName = await ensureNotesPage(deck, slide.partName);
      setNotesText((await deck.office.xml(notesPartName)).root, operation.text);
      deck.office.markDirty(notesPartName);
    }
    else if (operation.kind === "set-slide-hidden") {
      // PowerPoint stores this on the slide root. Omitting `show` means shown;
      // the explicit false value is the native hidden-slide representation.
      if (operation.hidden) slide.root().setAttribute("show", "0");
      else slide.root().removeAttribute("show");
      deck.office.markDirty(slide.partName);
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
        setShapeGeometry(shape, operation, {
          width: carry.projection.nativeBinding.canvasWidthEmu ?? 12192000,
          height: carry.projection.nativeBinding.canvasHeightEmu ?? 6858000,
        });
      deck.office.markDirty(slide.partName);
    }
    else if (operation.kind === "format-text") {
      const shape = shapeIn(slide.root(), operation.shapeId);
      if (!shape) throw new PptxLensError("PPTX_SHAPE_MISSING", "The text object being formatted no longer exists on this slide.");
      setTextFormat(shape, operation.format);
      deck.office.markDirty(slide.partName);
    }
    else if (operation.kind === "format-rich-text") {
      const shape = shapeIn(slide.root(), operation.shapeId);
      if (!shape) throw new PptxLensError("PPTX_TEXT_MISSING", "The text object being formatted no longer exists on this slide.");
      setRichText(deck, slide.partName, shape, operation.paragraphs, (id) => born.get(id) ?? id);
      cleanupSlideHyperlinkRelationships(deck, slide.partName, (await deck.office.xml(slide.partName)).root);
      deck.office.markDirty(slide.partName);
    }
    else if (operation.kind === "set-object-link") {
      const shape = shapeIn(slide.root(), operation.shapeId);
      const owner = shape && firstDescendant(shape, PML_NAMESPACE, "cNvPr");
      if (!owner) throw new PptxLensError("PPTX_SHAPE_MISSING", "The object receiving the link no longer exists on this slide.");
      const requestedLink = normalizePresentationHyperlink(operation.hyperlink);
      const nativeLink = requestedLink?.kind === "slide"
        ? { kind: "slide" as const, slideId: born.get(requestedLink.slideId) ?? requestedLink.slideId }
        : requestedLink;
      setHyperlink(deck, slide.partName, owner, nativeLink);
      cleanupSlideHyperlinkRelationships(deck, slide.partName, (await deck.office.xml(slide.partName)).root);
      deck.office.markDirty(slide.partName);
    }
    else if (operation.kind === "set-shape-style") {
      const shape = shapeIn(slide.root(), operation.shapeId);
      if (!shape) throw new PptxLensError("PPTX_SHAPE_MISSING", "The shape being formatted no longer exists on this slide.");
      setShapeStyle(shape, operation.style);
      deck.office.markDirty(slide.partName);
    }
    else if (operation.kind === "set-image-crop") {
      const shape = shapeIn(slide.root(), operation.shapeId);
      if (!shape) throw new PptxLensError("PPTX_IMAGE_MISSING", "The picture being cropped no longer exists on this slide.");
      setImageCrop(shape, operation.crop);
      deck.office.markDirty(slide.partName);
    }
    else if (operation.kind === "set-table-cell-format") {
      const shape = shapeIn(slide.root(), operation.shapeId);
      if (!shape) throw new PptxLensError("PPTX_TABLE_MISSING", "The table being formatted no longer exists on this slide.");
      setTableCellFormat(shape, operation.row, operation.column, operation.format);
      deck.office.markDirty(slide.partName);
    }
    else if (operation.kind === "set-table-cell-text") {
      const shape = shapeIn(slide.root(), operation.shapeId);
      if (!shape) throw new PptxLensError("PPTX_TABLE_MISSING", "The table being edited no longer exists on this slide.");
      setTableCellText(shape, operation.row, operation.column, operation.text);
      deck.office.markDirty(slide.partName);
    }
    else if (operation.kind === "set-chart") {
      await setChartContent(deck, slide.partName, operation.shapeId, operation);
    }
    else if (operation.kind === "set-object-state") {
      if (operation.readingOrder !== undefined) moveShapeToOrder(slide.root(), operation.shapeId, operation.readingOrder);
      const shape = shapeIn(slide.root(), operation.shapeId);
      if (shape && operation.hidden !== undefined) setObjectHidden(shape, operation.hidden);
      deck.office.markDirty(slide.partName);
    }
    else if (operation.kind === "remove-object") {
      removeShape(slide.root(), operation.shapeId);
      cleanupSlideHyperlinkRelationships(deck, slide.partName, slide.root());
      deck.office.markDirty(slide.partName);
    }
    else { throw new PptxLensError("PPTX_OPERATION_UNSUPPORTED", `Unsupported PowerPoint operation ${(operation as { kind: string }).kind}.`); }
  }
  return deck.save();
}

export const pptxLens: SpectraLens<PptxProjection, PptxSemanticDelta> = {
  format: "pptx",
  async open(payload, profile = "strict-native"): Promise<LensOpenResult<PptxProjection>> { let deck: Presentation; let safePayload: Uint8Array; try { safePayload = await prepareBoundedArchiveBytes(payload, OFFICE_ARCHIVE_LIMITS); deck = await Presentation.open(safePayload); } catch (error) { throw new PptxLensError("PPTX_CORRUPT", `This PowerPoint package could not be opened safely.${error instanceof Error ? ` (${error.message})` : ""}`); } const { projection, fidelityMap } = await projectPresentation(deck, profile); return { projection, fidelityMap, preservedCarry: { version: 1, format: projection.nativeBinding.format, profile, basePayloadHash: await sha256Payload(payload), payload, safePayload, projection }, capabilities: this.capabilities(profile, fidelityMap) }; },
  mutate: applyDelta,
  async materialize({ projection, carry }) {
    const operations = pptxOperationsBetween(carry.projection, projection);
    return operations.length ? applyDelta(carry, { kind: "ai-edit", operations }) : carry.payload; },
  async diffExternal(payloadA, payloadB): Promise<LensExternalDiff> { const [before, after, comparison] = await Promise.all([this.open(payloadA), this.open(payloadB), comparePackages(payloadA, payloadB)]); const previous = new Map(before.projection.slides.map((slide) => [slide.id, slide])); const changes: LensExternalDiff["changes"] = []; for (const slide of after.projection.slides) { const old = previous.get(slide.id); previous.delete(slide.id); if (!old) changes.push({ regionId: slide.id, kind: "insert", after: slide }); else if (JSON.stringify(old) !== JSON.stringify(slide)) changes.push({ regionId: slide.id, kind: "update", before: old, after: slide }); } for (const slide of previous.values()) changes.push({ regionId: slide.id, kind: "delete", before: slide }); const changedParts = comparison.parts.filter((part) => part.verdict !== "identical").map((part) => `/${part.name}`); const semanticParts = ["/ppt/presentation.xml", ...after.projection.slides.flatMap((slide) => [slide.id.replace(/^pptx:slide:/, ""), ...(slide.notesPartName ? [slide.notesPartName] : [])])]; const modeled = new Set([...semanticParts, ...semanticParts.map(relationshipsPartName)]); const preservedPartChanges = changedParts.filter((part) => !modeled.has(part) && !/^\/ppt\/notesMasters\//i.test(part)); return { changes, changedParts, preservedPartChanges }; },
  capabilities(profile, fidelityMap): LensCapabilitySet { const strict = profile === "strict-native"; const hasTransition = fidelityMap.entries.some((entry) => entry.feature === "transition"); return { profile, human: [{ id: "edit-slide-title", available: true }, { id: "edit-slide-text", available: true }, { id: "format-rich-text", available: true }, { id: "set-object-link", available: true }, { id: "format-shape", available: true }, { id: "format-table-cell", available: true }, { id: "edit-native-chart", available: true }, { id: "crop-image", available: true }, { id: "add-basic-text-box", available: true }, { id: "add-slide-on-existing-layout", available: true }, { id: "duplicate-slide", available: true }, { id: "remove-slide", available: true }, { id: "reorder-slides", available: true }, { id: "remove-object", available: true }, { id: "set-slide-hidden", available: true }, { id: "edit-speaker-notes", available: true }, { id: "describe-shape", available: true }, { id: "move-and-resize-shape", available: true }, { id: "edit-native-transition", available: hasTransition, reason: hasTransition ? "Only exact PowerPoint transition equivalents may replace the preserved transition." : "No native transition is present." }, strict ? { id: "apply-spectra-only-transition", available: false, reason: "This transition has no exact PowerPoint representation in strict native mode." } : { id: "apply-spectra-only-transition", available: true }], aiOperations: ["set_slide_title", "set_slide_text", "format_rich_text", "set_object_link", "set_shape_style", "set_table_cell_format", "set_chart", "crop_image", "add_text_box", "write_speaker_notes", "set_slide_hidden", "set_alt_text", "move_object", "resize_object", "add_slide", "duplicate_slide", "delete_slide", "delete_object", "reorder_slides"] }; },
};
