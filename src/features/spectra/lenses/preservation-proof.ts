import { resolveRelationshipTarget } from "@ariadng/office/opc";
import { compareXml } from "@ariadng/office/preservation";
import { parseXml, type XmlElement } from "@ariadng/office/xml";
import { ZipReader } from "@ariadng/office/zip";
import { assertPreservationKept, type PreservationInput, type PreservationProof } from "../commands/office/preservation-guard";
import type { DocxOperation, DocxProjection, PptxOperation, PptxProjection, XlsxOperation, XlsxProjection } from "./projection-contracts";

const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PACKAGE_REL = "http://schemas.openxmlformats.org/package/2006/relationships";
const SML = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const name = (value: string) => value.startsWith("/") ? value : `/${value}`;
const zipName = (value: string) => value.replace(/^\//, "");

export type PreservationIntent =
  | { format: "docx"; projection: DocxProjection; operations: readonly DocxOperation[] }
  | { format: "pptx"; projection: PptxProjection; operations: readonly PptxOperation[] }
  | { format: "xlsx"; projection: XlsxProjection; operations: readonly XlsxOperation[] };

type RemovalRoot = { part: string; owner: string; relation: readonly string[]; references: number; slide?: boolean };
type Edge = { owner: string; target: string; id: string; type: string };

function relationKind(type: string) {
  if (type.startsWith(`${REL}/`)) return type.slice(REL.length + 1);
  if (type === "http://schemas.microsoft.com/office/2014/relationships/chartEx") return "chartEx";
  if (type === "http://schemas.microsoft.com/office/2007/relationships/media") return "media";
  return undefined;
}

function elements(root: XmlElement) {
  const result: XmlElement[] = [];
  const stack = [root];
  while (stack.length) {
    const node = stack.pop()!;
    result.push(node);
    stack.push(...[...node.elements()].reverse());
  }
  return result;
}

function ancestry(node: XmlElement) {
  const path: [string | null, string][] = [];
  for (let parent = node.parent; parent; parent = parent.parent) path.push([parent.namespaceUri(), parent.localName]);
  return JSON.stringify(path);
}

function images(block: DocxProjection["blocks"][number]) {
  const result: { partName: string; occurrenceId?: string }[] = [];
  const stack: unknown[] = [block];
  while (stack.length) {
    const item = stack.pop();
    if (!item || typeof item !== "object") continue;
    if (Array.isArray(item)) { stack.push(...item); continue; }
    const record = item as Record<string, unknown>;
    if (record.kind === "image" && typeof record.partName === "string") {
      result.push({ partName: record.partName, ...(typeof record.occurrenceId === "string" ? { occurrenceId: record.occurrenceId } : {}) });
    } else stack.push(...Object.values(record));
  }
  return result;
}

/** Resolve deletion intent against the original native projection, never absence in output. */
function removalRoots(intent: PreservationIntent): RemovalRoot[] {
  const roots: RemovalRoot[] = [];
  if (intent.format === "pptx") {
    for (const operation of intent.operations) {
      if (operation.kind !== "remove-slide") continue;
      const slide = intent.projection.slides.find((candidate) => candidate.id === operation.slideId);
      if (slide) roots.push({ part: slide.id.replace(/^pptx:slide:/, ""), owner: "/ppt/presentation.xml", relation: ["slide"], references: 1, slide: true });
    }
  } else if (intent.format === "xlsx") {
    for (const operation of intent.operations) {
      if (operation.kind !== "remove-sheet" && operation.kind !== "remove-chart" && operation.kind !== "remove-table") continue;
      const sheet = intent.projection.sheets.find((candidate) => candidate.id === operation.sheetId);
      if (!sheet?.partName) continue;
      if (operation.kind === "remove-sheet") roots.push({ part: sheet.partName, owner: "/xl/workbook.xml", relation: ["worksheet"], references: 1 });
      if (operation.kind === "remove-chart") {
        const chart = sheet.charts?.find((candidate) => candidate.id === operation.chartId || candidate.partName === operation.chartId);
        if (chart?.partName && chart.drawingPartName) roots.push({ part: chart.partName, owner: chart.drawingPartName, relation: ["chart", "chartEx"], references: 1 });
      }
      if (operation.kind === "remove-table") {
        const table = sheet.tables?.find((candidate) => candidate.id === operation.tableId || candidate.partName === operation.tableId || candidate.name === operation.tableId);
        if (table?.partName) roots.push({ part: table.partName, owner: sheet.partName, relation: ["table"], references: 1 });
      }
    }
  } else {
    const deletions = intent.operations.filter((operation) => operation.kind === "delete-image");
    for (const partName of new Set(deletions.map((operation) => operation.partName))) {
      const occurrences = intent.projection.blocks.flatMap((block) => images(block).filter((image) => image.partName === partName).map((image) => ({ ...image, regionId: block.id })));
      // A shared image can be released only if every original occurrence was
      // explicitly deleted. Ambiguous legacy occurrence IDs are not ownership.
      const selected = new Set<number>();
      for (const operation of deletions.filter((operation) => operation.partName === partName)) {
        const matches = occurrences.flatMap((image, index) => image.regionId === operation.regionId &&
          (!operation.occurrenceId || image.occurrenceId === operation.occurrenceId) ? [index] : []);
        if (matches.length === 1) selected.add(matches[0]!);
      }
      if (!occurrences.length || selected.size !== occurrences.length) continue;
      roots.push({ part: partName, owner: "/word/document.xml", relation: ["image"], references: occurrences.length });
    }
  }
  return roots;
}

function relationshipOwner(part: string) {
  if (part === "/_rels/.rels") return "/";
  const match = part.match(/^(.*)\/_rels\/([^/]+)\.rels$/);
  return match ? `${match[1]}/${match[2]}` : undefined;
}

function relationshipPart(owner: string) {
  const slash = owner.lastIndexOf("/");
  return `${owner.slice(0, slash)}/_rels/${owner.slice(slash + 1)}.rels`;
}

// These relationships own child content. Layouts, masters, themes, other slides,
// VBA projects and unknown relationship kinds are not deletion dependencies.
const OWNED_RELATIONS = new Set([
  "notesSlide", "chart", "chartEx", "chartUserShapes", "image", "audio", "video", "media",
  "oleObject", "package", "diagramData", "diagramLayout", "diagramQuickStyle", "diagramColors",
  "drawing", "table", "comments", "vmlDrawing",
]);

const INVALIDATES_CALC_CHAIN = new Set([
  "set-cell", "set-formula", "clear-cell", "rename-sheet", "reorder-sheets",
  "set-defined-names", "mutate-sheet-axis", "remove-sheet", "upsert-table",
]);

function isDerivedCalcChain(root: XmlElement) {
  const cacheAttributes = new Set(["r", "i", "s", "l", "t", "a"]);
  return root.namespaceUri() === SML && root.localName === "calcChain" &&
    elements(root).every((node) =>
      (node === root || node.parent === root && node.namespaceUri() === SML && node.localName === "c") &&
      node.attributes.every((attribute) => attribute.prefix === "xmlns" || attribute.prefix === null &&
        (attribute.localName === "xmlns" || node !== root && cacheAttributes.has(attribute.localName))) &&
      node.children.every((child) => child.kind === "element" ||
        (child.kind === "text" || child.kind === "cdata") && /^[\t\n\r ]*$/.test(child.text)),
    );
}

async function proveRemovals(before: ZipReader, after: ZipReader, intent?: PreservationIntent) {
  const removed = new Set(before.entries().filter((entry) => !entry.name.endsWith("/") && !after.has(entry.name)).map((entry) => name(entry.name)));
  if (!removed.size || !intent) return [];
  const roots = removalRoots(intent).filter((root) => removed.has(root.part));
  const invalidatesCalcChain = intent.format === "xlsx" && intent.operations.some((operation) => INVALIDATES_CALC_CHAIN.has(operation.kind));
  if (!roots.length && !invalidatesCalcChain) return [];
  const beforeXml = new Map<string, XmlElement>();
  const afterXml = new Map<string, XmlElement>();
  const xml = async (zip: ZipReader, cache: Map<string, XmlElement>, part: string) => {
    if (!cache.has(part)) cache.set(part, parseXml(await zip.read(zipName(part))).root);
    return cache.get(part)!;
  };
  const readEdges = async (zip: ZipReader) => {
    const result: Edge[] = [];
    for (const entry of zip.entries()) {
      const owner = relationshipOwner(name(entry.name));
      if (!owner) continue;
      const root = parseXml(await zip.read(entry.name)).root;
      if (root.namespaceUri() !== PACKAGE_REL || root.localName !== "Relationships") throw new Error("NATIVE_PRESERVATION_RELATIONSHIPS_INVALID");
      for (const relation of root.elements()) {
        if (relation.namespaceUri() !== PACKAGE_REL || relation.localName !== "Relationship") continue;
        if (relation.getAttribute("TargetMode") === "External") continue;
        const target = relation.getAttribute("Target"), id = relation.getAttribute("Id"), type = relation.getAttribute("Type");
        if (!target || !id || !type) throw new Error("NATIVE_PRESERVATION_RELATIONSHIPS_INVALID");
        result.push({ owner, id, target: resolveRelationshipTarget(owner, target), type });
      }
    }
    return result;
  };
  const originalEdges = await readEdges(before);
  const currentEdges = await readEdges(after);
  const incoming = new Map<string, Edge[]>(), outgoing = new Map<string, Edge[]>();
  for (const edge of originalEdges) {
    const targetEdges = incoming.get(edge.target) ?? [], ownerEdges = outgoing.get(edge.owner) ?? [];
    targetEdges.push(edge); ownerEdges.push(edge);
    incoming.set(edge.target, targetEdges); outgoing.set(edge.owner, ownerEdges);
  }
  if (invalidatesCalcChain) {
    const caches = (outgoing.get("/xl/workbook.xml") ?? []).filter((edge) => relationKind(edge.type) === "calcChain" && removed.has(edge.target));
    if (caches.length && after.has("xl/workbook.xml")) {
      const calcPr = (await xml(after, afterXml, "/xl/workbook.xml")).find(SML, "calcPr");
      let canRecalculate = ["1", "true"].includes(calcPr?.getAttribute("fullCalcOnLoad") ?? "") && ["1", "true"].includes(calcPr?.getAttribute("forceFullCalc") ?? "");
      if (!canRecalculate) {
        // Clearing the last formula also drops the chain, but needs no future
        // recalculation flag. Verify that case from the resulting worksheets.
        canRecalculate = true;
        for (const edge of currentEdges.filter((edge) => edge.owner === "/xl/workbook.xml" && relationKind(edge.type) === "worksheet")) {
          if (elements(await xml(after, afterXml, edge.target)).some((node) => node.namespaceUri() === SML && node.localName === "f")) { canRecalculate = false; break; }
        }
      }
      if (canRecalculate) for (const edge of caches) {
        // A standard chain is disposable derived order, not authored content.
        // Unknown XML or relationships make that assertion impossible.
        if (!before.has(zipName(relationshipPart(edge.target))) && isDerivedCalcChain(await xml(before, beforeXml, edge.target)))
          roots.push({ part: edge.target, owner: edge.owner, relation: ["calcChain"], references: 0 });
      }
    }
  }
  const currentTargets = new Set(currentEdges.map((edge) => edge.target));
  const beforeReferences = new Map<string, Map<string, number>>(), afterReferences = new Map<string, Map<string, number>>();
  const references = async (zip: ZipReader, cache: Map<string, XmlElement>, edge: Edge) => {
    if (!zip.has(zipName(edge.owner))) return 0;
    const counts = cache === beforeXml ? beforeReferences : afterReferences;
    if (!counts.has(edge.owner)) {
      const ids = new Map<string, number>();
      for (const node of elements(await xml(zip, cache, edge.owner))) for (const attribute of node.attributes) {
        if (attribute.prefix && node.resolvePrefix(attribute.prefix) === REL) ids.set(attribute.value, (ids.get(attribute.value) ?? 0) + 1);
      }
      counts.set(edge.owner, ids);
    }
    return counts.get(edge.owner)!.get(edge.id) ?? 0;
  };
  const detached = new Set<Edge>();
  const validRoots: RemovalRoot[] = [];
  for (const root of roots) {
    const ownership = (incoming.get(root.part) ?? []).filter((edge) => edge.owner === root.owner && root.relation.includes(relationKind(edge.type) ?? ""));
    let count = 0;
    for (const edge of ownership) count += await references(before, beforeXml, edge);
    if (!ownership.length || count !== root.references) continue;
    validRoots.push(root);
    for (const edge of ownership) detached.add(edge);
    // Removing a slide explicitly removes hyperlinks to it from surviving
    // slides. Its notes backlink is handled by the owned graph below.
    if (root.slide) for (const edge of incoming.get(root.part) ?? []) {
      if (edge.target === root.part && relationKind(edge.type) === "slide" && /^\/ppt\/slides\/[^/]+\.xml$/.test(edge.owner)) detached.add(edge);
    }
  }
  const candidates = new Set(validRoots.map((root) => root.part));
  const pending = [...candidates];
  while (pending.length) {
    const owner = pending.pop()!;
    for (const edge of outgoing.get(owner) ?? []) {
      if (!OWNED_RELATIONS.has(relationKind(edge.type) ?? "") || !removed.has(edge.target) || candidates.has(edge.target)) continue;
      candidates.add(edge.target);
      pending.push(edge.target);
    }
  }
  // Reject shared owners from the ORIGINAL graph even if a buggy writer also
  // erased their relationships. Iterate so an invalid root invalidates children.
  let changed = true;
  while (changed) {
    changed = false;
    for (const part of candidates) {
      let invalid = currentTargets.has(part);
      for (const edge of incoming.get(part) ?? []) {
        if (candidates.has(edge.owner)) continue;
        if (!detached.has(edge) || await references(after, afterXml, edge) > 0) { invalid = true; break; }
      }
      if (invalid) { candidates.delete(part); changed = true; }
    }
  }
  // A disconnected cycle cannot become proof after its authorized root failed.
  const reachable = new Set(validRoots.filter((root) => candidates.has(root.part)).map((root) => root.part));
  const visit = [...reachable];
  while (visit.length) {
    const owner = visit.pop()!;
    for (const edge of outgoing.get(owner) ?? []) if (OWNED_RELATIONS.has(relationKind(edge.type) ?? "") && candidates.has(edge.target) && !reachable.has(edge.target)) {
      reachable.add(edge.target); visit.push(edge.target);
    }
  }
  for (const part of [...reachable]) {
    const rels = relationshipPart(part);
    if (removed.has(rels)) reachable.add(rels);
  }
  // SDK writers may drop an empty .rels part after the final owned reference.
  // External/unknown relationships or a surviving XML consumer forbid that.
  for (const part of removed) {
    const owner = relationshipOwner(part);
    if (!owner || reachable.has(part)) continue;
    const relationships = parseXml(await before.read(zipName(part))).root.elements();
    const edges = outgoing.get(owner) ?? [];
    if (!edges.length || edges.length !== relationships.length || !edges.every((edge) => reachable.has(edge.target))) continue;
    let used = false;
    for (const edge of edges) if (await references(after, afterXml, edge) > 0) used = true;
    if (!used) reachable.add(part);
  }
  return [...reachable];
}

/**
 * Called only after both payloads passed bounded lens intake. Read only changed
 * scoped XML and, for deletions, relationship/owner XML; never inflate binary
 * media again. SDK compareXml compares attached subtrees with resolved namespaces
 * and inherited xml:space, independently of its diagnostic path traversal.
 * Scope preserves the feature sequence within a fixed structural owner. It is
 * not a record locator across same-tag repeated parents; production claims are
 * rooted at the unique slide or worksheet, not individual Word paragraphs.
 */
export async function nativePreservationProof(input: PreservationInput & {
  before: Uint8Array;
  after: Uint8Array;
  intent?: PreservationIntent;
}): Promise<PreservationProof> {
  const before = await ZipReader.open(input.before);
  const after = await ZipReader.open(input.after);
  const scopes: PreservationProof["scopes"][number][] = [];
  for (const part of input.parts) {
    if (part.verdict !== "different" || part.note === "only in expected package" || part.note === "only in actual package") continue;
    const claims = input.entries.filter((entry) => (entry.class === "PRESERVED" || entry.readOnly === true) && typeof entry.partName === "string" && name(entry.partName) === name(part.name) && typeof entry.pathPattern === "string" && entry.pathPattern);
    if (!claims.length) continue;
    const previous = parseXml(await before.read(zipName(part.name))).root;
    const current = parseXml(await after.read(zipName(part.name))).root;
    const previousNodes = elements(previous), currentNodes = elements(current);
    for (const claim of claims) {
      const pathPattern = claim.pathPattern as string;
      const namespaceUri = typeof claim.namespaceUri === "string" ? claim.namespaceUri : undefined;
      const matches = (node: XmlElement) => node.localName === pathPattern && (namespaceUri === undefined || node.namespaceUri() === namespaceUri);
      const expected = previousNodes.filter(matches), actual = currentNodes.filter(matches);
      scopes.push({ partName: name(part.name), pathPattern, ...(namespaceUri !== undefined ? { namespaceUri } : {}),
        unchanged: expected.length > 0 && expected.length === actual.length && expected.every((node, index) => ancestry(node) === ancestry(actual[index]!) && compareXml(node, actual[index]!).length === 0),
      });
    }
  }
  return { scopes, removedParts: await proveRemovals(before, after, input.intent) };
}

export async function assertNativePreservationKept(input: Parameters<typeof nativePreservationProof>[0]) {
  assertPreservationKept({ ...input, proof: await nativePreservationProof(input) });
}
