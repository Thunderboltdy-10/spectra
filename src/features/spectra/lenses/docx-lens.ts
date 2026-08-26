import { Document, Paragraph, type Run, WML_NAMESPACE } from "@ariadng/office/docx";
import { comparePackages } from "@ariadng/office/preservation";
import { XmlElement, XmlText } from "@ariadng/office/xml";
import type {
  LensCapabilitySet,
  LensCompatibilityProfile,
  LensExternalDiff,
  LensFidelityEntry,
  LensFidelityMap,
  LensOpenResult,
  LensPreservedCarry,
  SpectraLens,
} from "./types";
import {
  docxProjectionSchema,
  type DocxParagraphFormat,
  type DocxProjection,
  type DocxProjectionBlock,
  type DocxRunFormat,
  type DocxSemanticDelta,
} from "./projection-contracts";

const W14_NAMESPACE =
  "http://schemas.microsoft.com/office/word/2010/wordml";

export type DocxNativePlaceholder = {
  id: string;
  label: string;
  detail: string;
  feature: string;
};

export type { DocxParagraphFormat, DocxProjection, DocxProjectionBlock, DocxRunFormat, DocxSemanticDelta } from "./projection-contracts";

export class DocxLensError extends Error {
  constructor(
    public readonly code:
      | "DOCX_PASSWORD_PROTECTED"
      | "DOCX_CORRUPT"
      | "DOCX_REGION_READ_ONLY"
      | "DOCX_UNSUPPORTED_EDIT"
      | "DOCX_TABLE_WRITE_UNSUPPORTED",
    message: string,
  ) {
    super(message);
    this.name = "DocxLensError";
  }
}

function isElement(value: { kind: string }): value is XmlElement {
  return value.kind === "element";
}

function descendants(element: XmlElement): XmlElement[] {
  const found: XmlElement[] = [];
  for (const child of element.children) {
    if (!isElement(child)) continue;
    found.push(child, ...descendants(child));
  }
  return found;
}

function hasWml(element: XmlElement, ...names: string[]) {
  const wanted = new Set(names);
  return [element, ...descendants(element)].some(
    (candidate) =>
      candidate.namespaceUri() === WML_NAMESPACE &&
      wanted.has(candidate.localName),
  );
}

function bytesLookEncrypted(payload: Uint8Array) {
  const compoundFileHeader = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
  return compoundFileHeader.every((byte, index) => payload[index] === byte);
}

export async function sha256Payload(payload: Uint8Array) {
  const stable = Uint8Array.from(payload);
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", stable.buffer)),
  )
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function stableHex(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0").toUpperCase();
}

function prospectiveParagraphId(paragraph: Paragraph, path: string) {
  const nativeId = paragraph.element.getAttributeNs(W14_NAMESPACE, "paraId");
  return nativeId?.toUpperCase() ?? stableHex(`spectra-docx:${path}`);
}

function paragraphRegionId(paragraph: Paragraph, path: string) {
  const nativeId = paragraph.element.getAttributeNs(W14_NAMESPACE, "paraId");
  return nativeId
    ? `docx:paragraph:${nativeId.toLowerCase()}`
    : `docx:paragraph:${prospectiveParagraphId(paragraph, path).toLowerCase()}`;
}

type NativeTableCell = {
  text(): string;
  setText(text: string): void;
  paragraphElements(): readonly XmlElement[];
};
type NativeTableRow = { cells(): readonly NativeTableCell[] };
type NativeTable = {
  element: XmlElement;
  depth: number;
  rows(): readonly NativeTableRow[];
  rowCount(): number;
  columnCount(): number;
};
type FlowEntry = { element: XmlElement; carrier: XmlElement; path: string };

function shallowWmlChildren(root: XmlElement, name: string) {
  const found: XmlElement[] = [];
  const visit = (element: XmlElement) => {
    for (const child of element.elements()) {
      if (child.namespaceUri() === WML_NAMESPACE && child.localName === name) {
        found.push(child);
        continue;
      }
      if (child.namespaceUri() === WML_NAMESPACE && ["p", "tbl"].includes(child.localName)) continue;
      visit(child);
    }
  };
  visit(root);
  return found;
}

function wrappedTable(element: XmlElement): NativeTable {
  const rows = () => shallowWmlChildren(element, "tr").map((row) => ({
    cells: () => shallowWmlChildren(row, "tc").map((cell) => ({
      paragraphElements: () => shallowWmlChildren(cell, "p"),
      text: () => shallowWmlChildren(cell, "p")
        .flatMap((paragraph) => shallowWmlChildren(paragraph, "r"))
        .flatMap((run) => run.children.filter((child) => child.kind === "text").map((child) => child.text))
        .join(""),
      setText: (text: string) => {
        const preserved = cell.children.filter(
          (child) => child.kind === "element" && child.namespaceUri() === WML_NAMESPACE && child.localName === "tcPr",
        );
        for (const child of [...cell.children]) cell.removeChild(child);
        for (const child of preserved) cell.appendChild(child);
        const paragraph = new XmlElement("p", "w");
        const run = new XmlElement("r", "w");
        const value = new XmlElement("t", "w");
        value.appendChild(new XmlText(text));
        run.appendChild(value);
        paragraph.appendChild(run);
        cell.appendChild(paragraph);
      },
    })),
  }));
  return {
    element,
    depth: 0,
    rows,
    rowCount: () => rows().length,
    columnCount: () => Math.max(0, ...rows().map((row) => row.cells().length)),
  };
}

function topLevelFlow(root: XmlElement): FlowEntry[] {
  const entries: FlowEntry[] = [];
  const visit = (element: XmlElement, carrier: XmlElement, path: string) => {
    if (element.namespaceUri() === WML_NAMESPACE && ["p", "tbl"].includes(element.localName)) {
      entries.push({ element, carrier, path });
      return;
    }
    const children = element.elements();
    if (element.namespaceUri() === WML_NAMESPACE && element.localName === "sdtContent") {
      children.forEach((child, index) => visit(child, carrier, `${path}/${child.localName}[${index}]`));
      return;
    }
    if (element.localName === "AlternateContent") {
      const branch = children.find((child) => child.localName === "Choice") ??
        children.find((child) => child.localName === "Fallback");
      if (branch) visit(branch, carrier, `${path}/branch`);
      return;
    }
    children.forEach((child, index) =>
      visit(child, carrier, `${path}/${child.localName}[${index}]`),
    );
  };
  root.elements().forEach((child, index) =>
    visit(child, child, `/body/${child.localName}[${index}]`),
  );
  return entries;
}

function tableAnchor(table: NativeTable) {
  return table
    .rows()
    .flatMap((row) => row.cells())
    .flatMap((cell) => cell.paragraphElements())[0];
}

function tableRegionId(table: NativeTable, path: string) {
  const anchor = tableAnchor(table);
  const anchorId =
    anchor?.getAttributeNs(W14_NAMESPACE, "paraId")?.toUpperCase() ??
    stableHex(`spectra-docx-table:${path}`);
  return `docx:table:${anchorId.toLowerCase()}`;
}

type NativeRegion = FlowEntry & {
  id: string;
  paragraph?: Paragraph;
  table?: NativeTable;
};

function nativeRegions(document: Document): NativeRegion[] {
  const tables = new Map(
    document
      .tables()
      .filter((table) => table.depth === 0)
      .map((table) => [table.element, table] as const),
  );
  const regions: NativeRegion[] = [];
  for (const entry of topLevelFlow(document.body())) {
    if (entry.element.localName === "p") {
      const paragraph = Paragraph._wrap(document, entry.element);
      regions.push({
        ...entry,
        id: paragraphRegionId(paragraph, entry.path),
        paragraph,
      });
      continue;
    }
    const table = tables.get(entry.element) ?? wrappedTable(entry.element);
    if (table)
      regions.push({ ...entry, id: tableRegionId(table, entry.path), table });
  }
  return regions;
}

function ensureStableRegionIds(document: Document) {
  const aliases = new Map<string, string>();
  let changed = false;
  for (const region of nativeRegions(document)) {
    const id = region.id.split(":").at(-1)?.toUpperCase();
    const anchor = region.paragraph?.element ?? (region.table ? tableAnchor(region.table) : undefined);
    if (!anchor) continue;
    const existing = anchor.getAttributeNs(W14_NAMESPACE, "paraId");
    if (existing) {
      aliases.set(region.id, region.id.replace(/[^:]+$/, existing.toLowerCase()));
      continue;
    }
    if (!id || !/^[0-9A-F]{8}$/.test(id)) continue;
    anchor.setAttributeNs(W14_NAMESPACE, "paraId", id);
    aliases.set(region.id, region.id.replace(/[^:]+$/, id.toLowerCase()));
    changed = true;
  }
  if (changed) document._markMainDirty();
  return aliases;
}

function uniqueRegionById(document: Document, regionId: string) {
  const matches = nativeRegions(document).filter((region) => region.id === regionId);
  if (matches.length !== 1)
    throw new DocxLensError(
      "DOCX_UNSUPPORTED_EDIT",
      matches.length
        ? `The Word region ${regionId} is not uniquely identifiable.`
        : `The Word region ${regionId} no longer exists.`,
    );
  return matches[0]!;
}

function movableCarrier(document: Document, region: NativeRegion) {
  const body = document.body();
  const sharing = nativeRegions(document).filter(
    (candidate) => candidate.carrier === region.carrier,
  );
  if (region.carrier.parent !== body || sharing.length !== 1)
    throw new DocxLensError(
      "DOCX_UNSUPPORTED_EDIT",
      "This Word region shares a native wrapper with other content and cannot be moved or deleted safely.",
    );
  return region.carrier;
}

function insertedParagraphId(regionId: string | undefined) {
  const native = regionId?.match(/^docx:paragraph:([a-f0-9]{8})$/i)?.[1];
  return (native ?? stableHex(`spectra-docx-insert:${regionId ?? crypto.randomUUID()}`)).toUpperCase();
}

function insertParagraph(
  document: Document,
  operation: Extract<DocxSemanticDelta, { kind: "insert-paragraph" }>,
) {
  const body = document.body();
  const paragraph = document.addParagraph(operation.text, {
    ...(operation.style ? { style: safeStyleId(operation.style) } : {}),
  });
  const paraId = insertedParagraphId(operation.regionId);
  paragraph.element.setAttributeNs(W14_NAMESPACE, "paraId", paraId);
  const afterRegionId = operation.afterRegionId;
  if (afterRegionId === undefined) return `docx:paragraph:${paraId.toLowerCase()}`;
  const reference = afterRegionId === null
    ? nativeRegions(document).find((region) => region.element !== paragraph.element)?.carrier
    : (() => {
        const after = uniqueRegionById(document, afterRegionId);
        const carrier = movableCarrier(document, after);
        const position = body.children.indexOf(carrier);
        return body.children[position + 1] ?? null;
      })();
  if (reference !== paragraph.element)
    body.insertBefore(paragraph.element, reference ?? null);
  document._markMainDirty();
  return `docx:paragraph:${paraId.toLowerCase()}`;
}

function safeStyleId(value: string) {
  if (!/^[A-Za-z0-9_.-]{1,120}$/.test(value))
    throw new DocxLensError(
      "DOCX_UNSUPPORTED_EDIT",
      "That Word style identifier cannot be represented safely.",
    );
  return value;
}

function setParagraphStyle(document: Document, paragraph: Paragraph, style: string) {
  const styleId = safeStyleId(style);
  let properties = paragraph.element.find(WML_NAMESPACE, "pPr");
  if (!properties) {
    properties = new XmlElement("pPr", "w");
    paragraph.element.insertBefore(properties, paragraph.element.children[0] ?? null);
  }
  let styleElement = properties.find(WML_NAMESPACE, "pStyle");
  if (!styleElement) {
    styleElement = new XmlElement("pStyle", "w");
    properties.insertBefore(styleElement, properties.children[0] ?? null);
  }
  styleElement.setAttributeNs(WML_NAMESPACE, "val", styleId);
  document._markMainDirty();
}

/**
 * Run children Spectra is able to write back.
 *
 * Everything a run may hold that is not in this set — a VML text box, a
 * DrawingML picture or chart, an embedded OLE object, an OMML equation, a
 * symbol glyph, a footnote reference — is content this lens does not model. It
 * lives inside `w:r`, so `setText` on that run would delete it: the paragraph
 * looks like text in the projection and is a picture in the file.
 */
const WRITABLE_RUN_CHILDREN = new Set([
  "rPr", "t", "br", "tab", "cr", "noBreakHyphen", "softHyphen", "lastRenderedPageBreak",
]);

/**
 * True when every child of this run is text Spectra can reproduce.
 *
 * A `false` answer is a preservation guarantee, not a limitation to work
 * around: the run is left exactly as Word wrote it, and new text goes into a
 * new run beside it.
 */
function writableRun(run: Run) {
  return run.element
    .elements()
    .every(
      (child) =>
        child.namespaceUri() === WML_NAMESPACE &&
        WRITABLE_RUN_CHILDREN.has(child.localName),
    );
}

function replaceParagraphText(document: Document, paragraph: Paragraph, text: string) {
  const runs = paragraph.runs().filter(writableRun);
  if (runs.length) {
    runs[0]!.setText(text);
    for (const run of runs.slice(1)) run.setText("");
    return;
  }
  const run = new XmlElement("r", "w");
  const textElement = new XmlElement("t", "w");
  if (/^\s|\s$/.test(text))
    textElement.setAttribute("xml:space", "preserve");
  textElement.appendChild(new XmlText(text));
  run.appendChild(textElement);
  paragraph.element.appendChild(run);
  document._markMainDirty();
}

/**
 * Word's `w:pPr` and `w:rPr` children are a *sequence*, not a set: a property
 * written in the wrong position produces a document.xml that Word repairs on
 * open, and a repaired file is a lost file. These are the ECMA-376 orders, and
 * `orderedChild` is the only way this module creates a property element.
 */
const PPR_ORDER: readonly string[] = [
  "pStyle", "keepNext", "keepLines", "pageBreakBefore", "framePr", "widowControl",
  "numPr", "suppressLineNumbers", "pBdr", "shd", "tabs", "suppressAutoHyphens",
  "kinsoku", "wordWrap", "overflowPunct", "topLinePunct", "autoSpaceDE",
  "autoSpaceDN", "bidi", "adjustRightInd", "snapToGrid", "spacing", "ind",
  "contextualSpacing", "mirrorIndents", "suppressOverlap", "jc", "textDirection",
  "textAlignment", "textboxTightWrap", "outlineLvl", "divId", "cnfStyle", "rPr",
  "sectPr", "pPrChange",
];

const RPR_ORDER: readonly string[] = [
  "rStyle", "rFonts", "b", "bCs", "i", "iCs", "caps", "smallCaps", "strike",
  "dstrike", "outline", "shadow", "emboss", "imprint", "noProof", "snapToGrid",
  "vanish", "webHidden", "color", "spacing", "w", "kern", "position", "sz",
  "szCs", "highlight", "u", "effect", "bdr", "shd", "fitText", "vertAlign",
  "rtl", "cs", "em", "lang", "eastAsianLayout", "specVanish", "oMath",
];

const WORD_HIGHLIGHTS = new Set([
  "yellow", "green", "cyan", "magenta", "blue", "red", "darkBlue", "darkCyan",
  "darkGreen", "darkMagenta", "darkRed", "darkYellow", "darkGray", "lightGray",
  "black", "white", "none",
]);

function orderedChild(parent: XmlElement, localName: string, order: readonly string[]) {
  const existing = parent.find(WML_NAMESPACE, localName);
  if (existing) return existing;
  const created = new XmlElement(localName, "w");
  const rank = order.indexOf(localName);
  const reference =
    parent.elements().find((child) => {
      if (child.namespaceUri() !== WML_NAMESPACE) return false;
      const childRank = order.indexOf(child.localName);
      return childRank >= 0 && childRank > rank;
    }) ?? null;
  parent.insertBefore(created, reference);
  return created;
}

function dropChild(parent: XmlElement, localName: string) {
  const existing = parent.find(WML_NAMESPACE, localName);
  if (existing) parent.removeChild(existing);
}

/**
 * A toggle written as Word writes it. Turning one *off* has to be an explicit
 * `w:val="0"`, not a missing element: a paragraph style may already be bold, and
 * deleting the direct property would leave the text bold after the writer asked
 * for it not to be (§17.7.3 — only direct formatting can force a toggle off).
 */
function setToggle(properties: XmlElement, localName: string, on: boolean) {
  const element = orderedChild(properties, localName, RPR_ORDER);
  if (on) element.removeAttributeNs(WML_NAMESPACE, "val");
  else element.setAttributeNs(WML_NAMESPACE, "val", "0");
}

function safeFontName(value: string) {
  if (!/^[\w .+&'-]{1,64}$/.test(value))
    throw new DocxLensError(
      "DOCX_UNSUPPORTED_EDIT",
      "That font name cannot be written safely into a Word file.",
    );
  return value;
}

function safeHexColor(value: string) {
  const hex = value.replace(/^#/, "");
  if (!/^[0-9A-Fa-f]{6}$/.test(hex))
    throw new DocxLensError(
      "DOCX_UNSUPPORTED_EDIT",
      "Word colours must be six hexadecimal digits.",
    );
  return hex.toUpperCase();
}

function runProperties(run: XmlElement) {
  const existing = run.find(WML_NAMESPACE, "rPr");
  if (existing) return existing;
  const created = new XmlElement("rPr", "w");
  run.insertBefore(created, run.children[0] ?? null);
  return created;
}

function paragraphProperties(paragraph: Paragraph) {
  const existing = paragraph.element.find(WML_NAMESPACE, "pPr");
  if (existing) return existing;
  const created = new XmlElement("pPr", "w");
  paragraph.element.insertBefore(created, paragraph.element.children[0] ?? null);
  return created;
}

/**
 * Applies one set of run properties to every run in the paragraph.
 *
 * Spectra's editor formats a selection; Word stores formatting per run. The
 * lens deliberately writes the paragraph's runs uniformly rather than splitting
 * them: splitting a run is how a round-trip loses a comment anchor or a bookmark
 * that sits between two halves of a sentence. So the projection only reports a
 * run property when every run agrees on it, and a write only happens when the
 * writer changed that agreed value.
 */
function applyRunFormat(document: Document, paragraph: Paragraph, format: DocxRunFormat) {
  // Character formatting reaches the text runs only. A run holding a picture or
  // a text box is skipped rather than styled: the anchor is not text a person
  // selected, and its `w:rPr` carries positioning Word wrote for the drawing.
  const runs = paragraph.runs().filter(writableRun);
  if (!runs.length) return;
  for (const run of runs) {
    const properties = runProperties(run.element);
    if (format.bold !== undefined) setToggle(properties, "b", format.bold);
    if (format.italic !== undefined) setToggle(properties, "i", format.italic);
    if (format.strike !== undefined) setToggle(properties, "strike", format.strike);
    if (format.underline !== undefined) {
      orderedChild(properties, "u", RPR_ORDER).setAttributeNs(
        WML_NAMESPACE,
        "val",
        format.underline ? "single" : "none",
      );
    }
    if (format.fontFamily !== undefined) {
      if (!format.fontFamily) dropChild(properties, "rFonts");
      else {
        const fonts = orderedChild(properties, "rFonts", RPR_ORDER);
        const name = safeFontName(format.fontFamily);
        for (const slot of ["ascii", "hAnsi", "cs"])
          fonts.setAttributeNs(WML_NAMESPACE, slot, name);
        // A literal name and a theme reference in the same element would let
        // Word prefer the theme font and silently ignore the choice.
        for (const slot of ["asciiTheme", "hAnsiTheme", "cstheme", "csTheme"])
          fonts.removeAttributeNs(WML_NAMESPACE, slot);
      }
    }
    if (format.fontSizePoints !== undefined) {
      if (!format.fontSizePoints) {
        dropChild(properties, "sz");
        dropChild(properties, "szCs");
      } else {
        const halfPoints = String(
          Math.round(Math.min(400, Math.max(4, format.fontSizePoints)) * 2),
        );
        orderedChild(properties, "sz", RPR_ORDER).setAttributeNs(WML_NAMESPACE, "val", halfPoints);
        orderedChild(properties, "szCs", RPR_ORDER).setAttributeNs(WML_NAMESPACE, "val", halfPoints);
      }
    }
    if (format.color !== undefined) {
      if (!format.color) dropChild(properties, "color");
      else {
        const color = orderedChild(properties, "color", RPR_ORDER);
        color.setAttributeNs(WML_NAMESPACE, "val", safeHexColor(format.color));
        color.removeAttributeNs(WML_NAMESPACE, "themeColor");
      }
    }
    if (format.highlight !== undefined) {
      if (!format.highlight || format.highlight === "none")
        dropChild(properties, "highlight");
      else {
        if (!WORD_HIGHLIGHTS.has(format.highlight))
          throw new DocxLensError(
            "DOCX_UNSUPPORTED_EDIT",
            "Word highlights are a fixed set of named colours; this one has no Word equivalent.",
          );
        orderedChild(properties, "highlight", RPR_ORDER).setAttributeNs(
          WML_NAMESPACE,
          "val",
          format.highlight,
        );
      }
    }
    if (format.shading !== undefined) {
      if (!format.shading) dropChild(properties, "shd");
      else {
        const shading = orderedChild(properties, "shd", RPR_ORDER);
        shading.setAttributeNs(WML_NAMESPACE, "val", "clear");
        shading.setAttributeNs(WML_NAMESPACE, "color", "auto");
        shading.setAttributeNs(WML_NAMESPACE, "fill", safeHexColor(format.shading));
      }
    }
  }
  document._markMainDirty();
}

function applyParagraphFormat(
  document: Document,
  paragraph: Paragraph,
  format: DocxParagraphFormat,
) {
  const properties = paragraphProperties(paragraph);
  if (format.alignment !== undefined) {
    if (!format.alignment || format.alignment === "left") dropChild(properties, "jc");
    else
      orderedChild(properties, "jc", PPR_ORDER).setAttributeNs(
        WML_NAMESPACE,
        "val",
        format.alignment === "justify" ? "both" : format.alignment,
      );
  }
  if (format.lineSpacing !== undefined || format.spacingAfterPoints !== undefined) {
    const spacing = orderedChild(properties, "spacing", PPR_ORDER);
    if (format.lineSpacing !== undefined) {
      if (!format.lineSpacing || format.lineSpacing === 1) {
        spacing.removeAttributeNs(WML_NAMESPACE, "line");
        spacing.removeAttributeNs(WML_NAMESPACE, "lineRule");
      } else {
        // `w:line` counts 240ths of a line under the 'auto' rule, which is how
        // Word stores "1.5" and "double" rather than as a multiplier.
        spacing.setAttributeNs(
          WML_NAMESPACE,
          "line",
          String(Math.round(Math.min(6, Math.max(0.5, format.lineSpacing)) * 240)),
        );
        spacing.setAttributeNs(WML_NAMESPACE, "lineRule", "auto");
      }
    }
    if (format.spacingAfterPoints !== undefined) {
      if (!format.spacingAfterPoints) spacing.removeAttributeNs(WML_NAMESPACE, "after");
      else
        spacing.setAttributeNs(
          WML_NAMESPACE,
          "after",
          String(Math.round(Math.min(600, Math.max(0, format.spacingAfterPoints)) * 20)),
        );
    }
    if (!spacing.attributes.length) dropChild(properties, "spacing");
  }
  if (format.indentLevel !== undefined) {
    // One editor step is half an inch, the Word default tab: 720 twips. The step
    // is applied *relative* to the indent the file already resolves to, not as
    // `level × 720`, because a Word style may outdent a heading by an amount
    // that is not a multiple of 720 — `ProductHead` in the Microsoft test asset
    // sits at -3254. Writing the absolute grid value would snap that heading
    // onto Spectra's grid and move text on the printed page, which is a silent
    // change the person never asked for. Word steps the same way.
    const existing = paragraph.format().indentLeftTwips ?? 0;
    const steps = Math.round(format.indentLevel ?? 0) - Math.round(existing / 720);
    const indent = properties.find(WML_NAMESPACE, "ind");
    // A level that did not move writes nothing: re-stating a style's indent as a
    // direct property would turn inherited formatting into local formatting.
    if (steps !== 0) {
      const next = Math.min(31680, Math.max(-31680, existing + steps * 720));
      if (!next) {
        if (indent) {
          indent.removeAttributeNs(WML_NAMESPACE, "left");
          indent.removeAttributeNs(WML_NAMESPACE, "start");
          if (!indent.attributes.length) properties.removeChild(indent);
        }
      } else {
        const element = orderedChild(properties, "ind", PPR_ORDER);
        // Mirror the attribute the file already uses; `w:start` is the strict
        // spelling of `w:left` and the two must never both be present.
        const attribute =
          element.getAttributeNs(WML_NAMESPACE, "start") !== undefined &&
          element.getAttributeNs(WML_NAMESPACE, "left") === undefined
            ? "start"
            : "left";
        element.setAttributeNs(WML_NAMESPACE, attribute, String(next));
      }
    }
  }
  if (format.border !== undefined) {
    if (!format.border || format.border === "none") dropChild(properties, "pBdr");
    else {
      const borders = orderedChild(properties, "pBdr", PPR_ORDER);
      const sides =
        format.border === "all"
          ? ["top", "left", "bottom", "right"]
          : ["top", "bottom", "left", "right"].includes(format.border)
            ? [format.border]
            : [];
      if (!sides.length)
        throw new DocxLensError(
          "DOCX_UNSUPPORTED_EDIT",
          "That paragraph border has no Word equivalent.",
        );
      for (const child of [...borders.elements()]) borders.removeChild(child);
      // Word's border sequence is top, left, bottom, right, between, bar.
      for (const side of ["top", "left", "bottom", "right"]) {
        if (!sides.includes(side)) continue;
        const edge = new XmlElement(side, "w");
        edge.setAttributeNs(WML_NAMESPACE, "val", "single");
        edge.setAttributeNs(WML_NAMESPACE, "sz", "4");
        edge.setAttributeNs(WML_NAMESPACE, "space", "4");
        edge.setAttributeNs(WML_NAMESPACE, "color", "auto");
        borders.appendChild(edge);
      }
    }
  }
  if (format.shading !== undefined) {
    if (!format.shading) dropChild(properties, "shd");
    else {
      const shading = orderedChild(properties, "shd", PPR_ORDER);
      shading.setAttributeNs(WML_NAMESPACE, "val", "clear");
      shading.setAttributeNs(WML_NAMESPACE, "color", "auto");
      shading.setAttributeNs(WML_NAMESPACE, "fill", safeHexColor(format.shading));
    }
  }
  if (!properties.elements().length) paragraph.element.removeChild(properties);
  document._markMainDirty();
}

/** What every run in the paragraph agrees on. Disagreement reports nothing. */
function uniformRunFormat(paragraph: Paragraph): DocxRunFormat | undefined {
  const runs = paragraph.runs().filter((run) => run.text().length > 0);
  if (!runs.length) return undefined;
  const first = runs[0]!.format();
  const agreed = <T>(read: (format: ReturnType<Run["format"]>) => T) => {
    const value = read(first);
    return runs.every((run) => read(run.format()) === value) ? value : undefined;
  };
  const bold = agreed((format) => format.bold);
  const italic = agreed((format) => format.italic);
  const strike = agreed((format) => format.strike);
  const underline = agreed((format) => format.underline !== null);
  const fontFamily = agreed((format) => format.font);
  const fontSizePoints = agreed((format) => format.sizePt);
  const color = agreed((format) => format.color);
  const highlight = agreed((format) => format.highlight);
  const shadingFills = runs.map(
    (run) =>
      run.element
        .find(WML_NAMESPACE, "rPr")
        ?.find(WML_NAMESPACE, "shd")
        ?.getAttributeNs(WML_NAMESPACE, "fill")
        ?.toUpperCase() ?? null,
  );
  const shading = shadingFills.every((fill) => fill === shadingFills[0])
    ? (shadingFills[0] === "AUTO" ? null : shadingFills[0])
    : undefined;
  const format: DocxRunFormat = {
    ...(bold !== undefined ? { bold } : {}),
    ...(italic !== undefined ? { italic } : {}),
    ...(strike !== undefined ? { strike } : {}),
    ...(underline !== undefined ? { underline } : {}),
    ...(fontFamily !== undefined ? { fontFamily } : {}),
    ...(fontSizePoints !== undefined ? { fontSizePoints } : {}),
    ...(color !== undefined ? { color } : {}),
    ...(highlight !== undefined ? { highlight } : {}),
    ...(shading !== undefined ? { shading } : {}),
  };
  return Object.keys(format).length ? format : undefined;
}

function projectedParagraphFormat(paragraph: Paragraph): DocxParagraphFormat | undefined {
  const resolved = paragraph.format();
  const properties = paragraph.element.find(WML_NAMESPACE, "pPr");
  const borders = properties?.find(WML_NAMESPACE, "pBdr");
  const shading = properties?.find(WML_NAMESPACE, "shd");
  const fill = shading?.getAttributeNs(WML_NAMESPACE, "fill");
  const border = borders
    ? borders.elements().length >= 4
      ? "all"
      : (borders.elements()[0]?.localName ?? "all")
    : null;
  const format: DocxParagraphFormat = {
    alignment:
      resolved.alignment === "center" ||
      resolved.alignment === "right" ||
      resolved.alignment === "justify"
        ? resolved.alignment
        : "left",
    lineSpacing:
      resolved.lineSpacing && resolved.lineSpacing.rule === "auto"
        ? Number((resolved.lineSpacing.value / 240).toFixed(2))
        : 1,
    spacingAfterPoints:
      resolved.spacingAfterTwips === null ? 0 : Math.round(resolved.spacingAfterTwips / 20),
    indentLevel:
      resolved.indentLeftTwips === null ? 0 : Math.round(resolved.indentLeftTwips / 720),
    border,
    shading: fill && fill.toLowerCase() !== "auto" ? fill.toUpperCase() : null,
  };
  return format;
}

const RUN_FORMAT_FIELDS = [
  "bold",
  "italic",
  "underline",
  "strike",
  "fontFamily",
  "fontSizePoints",
  "color",
  "highlight",
  "shading",
] as const;

const PARAGRAPH_FORMAT_FIELDS = [
  "alignment",
  "lineSpacing",
  "spacingAfterPoints",
  "indentLevel",
  "border",
  "shading",
] as const;

/**
 * The subset of a format record the writer actually changed, or undefined when
 * nothing did. A missing incoming record means the surface never carried
 * formatting for that block, which is not the same as clearing it, so it
 * produces no operation at all.
 */
function changedFormatFields<T extends Record<string, unknown>>(
  before: unknown,
  after: unknown,
  fields: readonly string[],
): T | undefined {
  if (!after || typeof after !== "object") return undefined;
  const previous = (before && typeof before === "object" ? before : {}) as Record<
    string,
    unknown
  >;
  const incoming = after as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  for (const field of fields) {
    if (!(field in incoming)) continue;
    const next = incoming[field] ?? null;
    const current = previous[field] ?? null;
    if (next !== current) patch[field] = incoming[field];
  }
  return Object.keys(patch).length ? (patch as T) : undefined;
}

function parseTableText(value: string) {
  return value.split(/\r?\n/).map((row) =>
    row
      .replace(/^\s*\|/, "")
      .replace(/\|\s*$/, "")
      .split("|")
      .map((cell) => cell.trim()),
  );
}

function fidelityFeature(
  entries: LensFidelityEntry[],
  feature: string,
  partName: string | undefined,
  options?: { regionId?: string; readOnly?: boolean; reason?: string },
) {
  const regionId = options?.regionId ?? `docx:feature:${feature}`;
  if (entries.some((entry) => entry.regionId === regionId)) return;
  entries.push({
    regionId,
    feature,
    class: "PRESERVED",
    ...(partName ? { partName } : {}),
    ...(options?.readOnly ? { readOnly: true } : {}),
    ...(options?.reason ? { reason: options.reason } : {}),
  });
}

function placeholderFor(entry: LensFidelityEntry): DocxNativePlaceholder | null {
  const labels: Record<string, string> = {
    field: "Word fields",
    trackedChanges: "Tracked changes",
    smartArt: "SmartArt",
    ole: "Embedded Office object",
    textBox: "Word text box",
    contentControl: "Word content control",
  };
  // Only the detection pass may raise a placeholder. A placeholder is a claim
  // about *this* file — "there is a text box here, and it is safe" — so it may
  // only come from a `docx:feature:` entry, which is written when the markup was
  // actually found. The blanket `docx:region:` rows say what Spectra can write,
  // not what the file contains; reading them as placeholders would announce
  // tracked changes in every document that has none.
  const label = entry.regionId.startsWith("docx:feature:")
    ? labels[entry.feature]
    : undefined;
  return label
    ? {
        id: entry.regionId,
        feature: entry.feature,
        label,
        detail: "It stays in the Word file, unchanged. You can keep writing around it.",
      }
    : null;
}

/**
 * The region-level fidelity vocabulary the command surface reasons in.
 *
 * Per-block entries answer "may I edit *this* paragraph?". The work bar asks a
 * different question — "may this *kind* of change be written to this file at
 * all?" — and it asks it with the shared region keys, not with the lens's own
 * feature names. So the projection states both, and the region row is deliberately
 * pessimistic: a region is NATIVE only where `materialize` can actually produce
 * a mutation for it today.
 *
 * `images`, `equations`, `footnotes`, `headersFooters` and `sections` are
 * PRESERVED unconditionally, and that is the honest answer rather than a cautious
 * one: the lens writes `/word/document.xml` paragraph text, paragraph properties
 * and table cell text. It writes no drawingML, no OMML, no notes part and no
 * section properties. A file that happens to contain no pictures would otherwise
 * let "insert image" report success while materializing an empty paragraph.
 */
const REGION_FIDELITY: ReadonlyArray<{
  region: string;
  class: LensFidelityEntry["class"];
  reason?: string;
}> = [
  { region: "body", class: "NATIVE" },
  { region: "styles", class: "NATIVE" },
  { region: "tables", class: "NATIVE" },
  {
    region: "lists",
    class: "EQUIVALENT",
    reason:
      "List text and level are written to Word; the numbering definition itself stays as Word defined it.",
  },
  {
    region: "images",
    class: "PRESERVED",
    reason:
      "Pictures in a linked Word file are kept exactly as they are. Spectra does not write Word drawing markup, so a picture cannot be added or resized here.",
  },
  {
    region: "equations",
    class: "PRESERVED",
    reason:
      "Word equations are preserved as OMML. Spectra writes its own LaTeX equations, which a linked Word file cannot hold, so equation editing belongs in Word.",
  },
  {
    region: "footnotes",
    class: "PRESERVED",
    reason:
      "Footnotes and endnotes live in their own Word parts, which Spectra keeps untouched. A note added here could not be written back.",
  },
  {
    region: "headersFooters",
    class: "PRESERVED",
    reason:
      "Headers and footers live in their own Word parts and are kept exactly as the file has them.",
  },
  {
    region: "sections",
    class: "PRESERVED",
    reason:
      "Page size, margins and columns are section properties Spectra preserves rather than rewrites, so the printed Word page stays the one Word laid out.",
  },
  {
    region: "fields",
    class: "PRESERVED",
    reason:
      "Field codes and their last results are preserved. Spectra never recalculates a Word field.",
  },
  {
    region: "comments",
    class: "PRESERVED",
    reason:
      "Word comment parts are preserved. Spectra's own threads live beside the document rather than inside the package.",
  },
  {
    region: "trackedChanges",
    class: "PRESERVED",
    reason:
      "Word revision marks are kept exactly as Word wrote them. Spectra never rewrites them, so accepting or rejecting a revision belongs in Word.",
  },
];

async function projectDocument(
  document: Document,
  profile: LensCompatibilityProfile,
) {
  const fidelityEntries: LensFidelityEntry[] = [];
  const blocks: DocxProjectionBlock[] = [];
  const bodyChildren = topLevelFlow(document.body());
  const topLevelTables = new Map(
    document
      .tables()
      .filter((table) => table.depth === 0)
      .map((table) => [table.element, table] as const),
  );

  for (const { element, path } of bodyChildren) {
    if (
      element.namespaceUri() === WML_NAMESPACE &&
      element.localName === "p"
    ) {
      const paragraph = Paragraph._wrap(document, element);
      const regionId = paragraphRegionId(paragraph, path);
      const styleId = paragraph.styleId();
      const list = paragraph.list();
      const readOnly = hasWml(
        element,
        "ins",
        "del",
        "moveFrom",
        "moveTo",
        "rPrChange",
        "pPrChange",
        "tblPrChange",
        "trPrChange",
        "tcPrChange",
        "fldChar",
        "instrText",
        "sdt",
      );
      // Some Word writers persist built-in Heading styles as the numeric
      // style IDs 1/2/3. Normalize those aliases to the semantic names used
      // by the editor, but never reinterpret protected TOC/field paragraphs.
      const semanticStyleId =
        !readOnly && /^[1-3]$/.test(styleId ?? "")
          ? `Heading${styleId}`
          : styleId;
      const runFormat = readOnly ? undefined : uniformRunFormat(paragraph);
      const paragraphFormat = readOnly ? undefined : projectedParagraphFormat(paragraph);
      blocks.push({
        id: regionId,
        type: list
          ? "list"
          : /^heading[1-3]$/i.test(semanticStyleId ?? "")
            ? "heading"
            : "paragraph",
        text: paragraph.text(),
        attrs: {
          nativePath: path,
          ...(semanticStyleId ? { styleId: semanticStyleId } : {}),
          ...(list ? { list } : {}),
          ...(readOnly ? { nativeReadOnly: true } : {}),
          // Formatting travels with the block so a writer sees the file's own
          // bold and leading rather than Spectra defaults, and so materialize
          // can tell an edit from an unchanged value. A read-only paragraph
          // reports none: nothing may be written back to it anyway.
          ...(runFormat ? { format: runFormat } : {}),
          ...(paragraphFormat ? { paragraphFormat } : {}),
        },
      });
      fidelityEntries.push({
        regionId,
        feature: readOnly ? "revision-or-field-paragraph" : "paragraph",
        class: readOnly ? "PRESERVED" : list ? "EQUIVALENT" : "NATIVE",
        partName: "/word/document.xml",
        ...(readOnly
          ? {
              readOnly: true,
              reason:
                "This paragraph contains Word revision or field machinery and is preserved read-only.",
            }
          : {}),
      });
      continue;
    }
    if (
      element.namespaceUri() === WML_NAMESPACE &&
      element.localName === "tbl"
    ) {
      const table = topLevelTables.get(element) ?? wrappedTable(element);
      if (table) {
        const regionId = tableRegionId(table, path);
        const nested = descendants(table.element).some(
          (candidate) =>
            candidate !== table.element &&
            candidate.namespaceUri() === WML_NAMESPACE &&
            candidate.localName === "tbl",
        );
        const rows = table.rows().map((row) => row.cells().map((cell) => cell.text()));
        blocks.push({
          id: regionId,
          type: "table",
          text: rows.map((row) => row.join(" | ")).join("\n"),
          rows,
          attrs: {
            nativePath: path,
            rowCount: table.rowCount(),
            columnCount: table.columnCount(),
            ...(nested ? { nativeReadOnly: true } : {}),
          },
        });
        fidelityEntries.push({
          regionId,
          feature: nested ? "nested-table" : "table",
          class: nested ? "PRESERVED" : "NATIVE",
          partName: "/word/document.xml",
          ...(nested
            ? {
                readOnly: true,
                reason:
                  "Nested Word tables are preserved read-only until their cell topology can be rewritten safely.",
              }
            : {}),
        });
      }
    }
  }

  const allMainElements = [document.body(), ...descendants(document.body())];
  const mainHas = (...names: string[]) =>
    allMainElements.some(
      (element) =>
        element.namespaceUri() === WML_NAMESPACE && names.includes(element.localName),
    );
  if (mainHas("fldChar", "instrText"))
    fidelityFeature(fidelityEntries, "field", "/word/document.xml", {
      readOnly: true,
      reason: "Word fields are preserved and cannot be resolved or rewritten in Spectra yet.",
    });
  if (
    mainHas(
      "ins",
      "del",
      "moveFrom",
      "moveTo",
      "rPrChange",
      "pPrChange",
      "tblPrChange",
      "trPrChange",
      "tcPrChange",
    )
  )
    fidelityFeature(fidelityEntries, "trackedChanges", "/word/document.xml", {
      readOnly: true,
      reason: "Revision marks stay in Word; accepting or rejecting them is unavailable.",
    });
  if (mainHas("sdt"))
    fidelityFeature(fidelityEntries, "contentControl", "/word/document.xml", {
      readOnly: true,
    });
  if (mainHas("txbxContent"))
    fidelityFeature(fidelityEntries, "textBox", "/word/document.xml", {
      readOnly: true,
    });

  const partNames = document.office.package.parts().map((part) => part.name);
  const partRule = (
    feature: string,
    match: (name: string) => boolean,
    reason?: string,
  ) => {
    const partName = partNames.find(match);
    if (partName)
      fidelityFeature(fidelityEntries, feature, partName, {
        readOnly: true,
        ...(reason ? { reason } : {}),
      });
  };
  partRule("bibliography", (name) => /^\/customXml\/item\d*\.xml$/i.test(name));
  partRule("customXml", (name) => name.toLowerCase().startsWith("/customxml/"));
  partRule("ole", (name) => name.toLowerCase().includes("/embeddings/"));
  partRule("smartArt", (name) => name.toLowerCase().includes("/diagrams/"));
  partRule("footnotes", (name) => /\/word\/footnotes\.xml$/i.test(name));
  partRule("endnotes", (name) => /\/word\/endnotes\.xml$/i.test(name));
  partRule("comments", (name) => /\/word\/comments.*\.xml$/i.test(name));
  partRule("headers", (name) => /\/word\/header\d+\.xml$/i.test(name));
  partRule("footers", (name) => /\/word\/footer\d+\.xml$/i.test(name));
  partRule("unknownExtension", (name) => /unknown|future|extension/i.test(name));
  if (document.office.format.macroEnabled) {
    const vbaPart = partNames.find((name) =>
      /\/word\/vbaProject\.bin$/i.test(name),
    );
    fidelityFeature(
      fidelityEntries,
      vbaPart ? "macro" : "macroContainer",
      vbaPart,
      {
        readOnly: true,
        reason: vbaPart
          ? "Macros are preserved byte-for-byte and are never executed by Spectra."
          : "The macro-enabled Word container remains macro-enabled; this fixture has no VBA project part to execute.",
      },
    );
  }

  // The region row, stated last so a per-block entry never overwrites it.
  for (const region of REGION_FIDELITY) {
    fidelityEntries.push({
      regionId: `docx:region:${region.region}`,
      feature: region.region,
      class: region.class,
      partName: "/word/document.xml",
      ...(region.class === "PRESERVED" ? { readOnly: true } : {}),
      ...(region.reason ? { reason: region.reason } : {}),
    });
  }

  const fidelityMap: LensFidelityMap = {
    version: 1,
    profile,
    entries: fidelityEntries,
  };
  const placeholders = fidelityEntries
    .map(placeholderFor)
    .filter((value): value is DocxNativePlaceholder => Boolean(value));
  const semanticDigest = await sha256Payload(
    new TextEncoder().encode(
      JSON.stringify(blocks),
    ),
  );
  const projection = docxProjectionSchema.parse({
    blocks,
    outline: blocks.flatMap((block) =>
      block.type === "heading"
        ? [
            {
              id: block.id,
              title: block.text,
              level: Number(block.attrs?.styleId?.toString().match(/[1-3]$/)?.[0] ?? 2),
            },
          ]
        : [],
    ),
    nativeBinding: {
      version: 1,
      format: document.office.format.extension as DocxProjection["nativeBinding"]["format"],
      profile,
      macroEnabled: document.office.format.macroEnabled,
      semanticDigest,
      nativePlaceholders: placeholders,
    },
  });
  return { projection, fidelityMap };
}

function findEntry(map: LensFidelityMap, regionId: string) {
  return map.entries.find((entry) => entry.regionId === regionId);
}

function assertEditable(map: LensFidelityMap, regionId: string) {
  const entry = findEntry(map, regionId);
  if (entry?.readOnly)
    throw new DocxLensError(
      "DOCX_REGION_READ_ONLY",
      entry.reason ?? `${entry.feature} is being preserved read-only.`,
    );
}

async function applyDelta(
  carry: LensPreservedCarry<DocxProjection>,
  delta: DocxSemanticDelta,
) {
  const document = await Document.open(carry.payload);
  const aliases = ensureStableRegionIds(document);
  const opened = await projectDocument(document, carry.profile);
  const operations =
    delta.kind === "ai-edit" ? delta.operations : [delta];
  const born = new Map<string, string>();
  const resolveRegionId = (regionId: string) =>
    born.get(regionId) ?? aliases.get(regionId) ?? regionId;

  for (const operation of operations) {
    if (operation.kind === "insert-paragraph") {
      const inserted = insertParagraph(document, {
        ...operation,
        ...(operation.afterRegionId
          ? { afterRegionId: resolveRegionId(operation.afterRegionId) }
          : {}),
      });
      if (operation.regionId) born.set(operation.regionId, inserted);
      continue;
    }
    if (operation.kind === "reorder-regions") {
      const body = document.body();
      const regions = nativeRegions(document);
      const byId = new Map(regions.map((region) => [region.id, region]));
      const resolvedOrder = operation.order.map(resolveRegionId);
      const requested = resolvedOrder.map((regionId) => byId.get(regionId));
      if (
        requested.some((region) => !region) ||
        requested.length !== regions.length ||
        new Set(resolvedOrder).size !== resolvedOrder.length
      )
        throw new DocxLensError(
          "DOCX_UNSUPPORTED_EDIT",
          "The Word region order is incomplete or contains an unknown region.",
        );
      const carriers = regions.map((region) => [region.id, movableCarrier(document, region)] as const);
      const carrierById = new Map(carriers);
      const carrierNodes = carriers.map(([, carrier]) => carrier);
      const carrierSet = new Set(carrierNodes);
      const unmodeled = body.elements().filter(
        (element) => element.localName !== "sectPr" && !carrierSet.has(element),
      );
      if (unmodeled.length)
        throw new DocxLensError(
          "DOCX_UNSUPPORTED_EDIT",
          "This Word document contains unmodeled body content, so its region order cannot be changed safely.",
        );
      const anchor = body.elements().find((element) => element.localName === "sectPr") ?? null;
      carrierNodes.forEach((carrier) => body.removeChild(carrier));
      for (const region of requested as NativeRegion[])
        body.insertBefore(carrierById.get(region.id)!, anchor);
      document._markMainDirty();
      continue;
    }
    if (operation.kind === "delete-region") {
      const regionId = resolveRegionId(operation.regionId);
      assertEditable(opened.fidelityMap, regionId);
      const region = uniqueRegionById(document, regionId);
      const carrier = movableCarrier(document, region);
      carrier.parent?.removeChild(carrier);
      document._markMainDirty();
      continue;
    }
    const regionId = resolveRegionId(operation.regionId);
    assertEditable(opened.fidelityMap, regionId);
    const region = uniqueRegionById(document, regionId);
    const block = opened.projection.blocks.find((candidate) => candidate.id === regionId);
    if (!block) throw new DocxLensError("DOCX_UNSUPPORTED_EDIT", `The Word region ${operation.regionId} no longer exists.`);
    if (operation.kind === "replace-paragraph") {
      if (!region.paragraph)
        throw new DocxLensError(
          "DOCX_UNSUPPORTED_EDIT",
          `The target Word region ${operation.regionId} is not a paragraph.`,
        );
      replaceParagraphText(document, region.paragraph, operation.text);
    } else if (operation.kind === "apply-style") {
      if (!region.paragraph)
        throw new DocxLensError(
          "DOCX_UNSUPPORTED_EDIT",
          `The target Word region ${operation.regionId} is not a paragraph.`,
        );
      setParagraphStyle(document, region.paragraph, operation.style);
    } else if (operation.kind === "format-runs" || operation.kind === "format-paragraph") {
      if (!region.paragraph)
        throw new DocxLensError(
          "DOCX_UNSUPPORTED_EDIT",
          `The target Word region ${operation.regionId} is not a paragraph.`,
        );
      if (operation.kind === "format-runs")
        applyRunFormat(document, region.paragraph, operation.format);
      else applyParagraphFormat(document, region.paragraph, operation.format);
    } else if (operation.kind === "edit-table-cell") {
      if (!region.table)
        throw new DocxLensError(
          "DOCX_UNSUPPORTED_EDIT",
          `The target Word region ${operation.regionId} is not a table.`,
        );
      const row = region.table.rows()[operation.row];
      const cell = row?.cells()[operation.column];
      if (!cell)
        throw new DocxLensError(
          "DOCX_UNSUPPORTED_EDIT",
          "The target Word table cell no longer exists.",
        );
      cell.setText(operation.text);
      document._markMainDirty();
    }
  }
  return document.save();
}

export const docxLens: SpectraLens<DocxProjection, DocxSemanticDelta> = {
  format: "docx",

  async open(payload, profile = "strict-native"): Promise<LensOpenResult<DocxProjection>> {
    let document: Document;
    try {
      document = await Document.open(payload);
    } catch (error) {
      if (bytesLookEncrypted(payload))
        throw new DocxLensError(
          "DOCX_PASSWORD_PROTECTED",
          "This Word file is password-protected. Spectra kept it unchanged and opened it as a file instead.",
        );
      throw new DocxLensError(
        "DOCX_CORRUPT",
        `This Word package is incomplete or corrupt. Spectra kept it unchanged and did not attempt a conversion.${error instanceof Error ? ` (${error.message})` : ""}`,
      );
    }
    ensureStableRegionIds(document);
    const { projection, fidelityMap } = await projectDocument(document, profile);
    const basePayloadHash = await sha256Payload(payload);
    return {
      projection,
      fidelityMap,
      preservedCarry: {
        version: 1,
        format: document.office.format.extension,
        profile,
        basePayloadHash,
        payload,
        projection,
      },
      capabilities: this.capabilities(profile, fidelityMap),
    };
  },

  async mutate(carry, delta) {
    return applyDelta(carry, delta);
  },

  async materialize({ projection, carry }) {
    const before = new Map(carry.projection.blocks.map((block) => [block.id, block]));
    const operations: Exclude<DocxSemanticDelta, { kind: "ai-edit" }>[] = [];
    for (const [blockIndex, block] of projection.blocks.entries()) {
      const previous = before.get(block.id);
      if (!previous) {
        if (block.type === "table")
          throw new DocxLensError(
            "DOCX_UNSUPPORTED_EDIT",
            "Adding a new table to a mounted Word file is unavailable in strict native mode.",
          );
        operations.push({
          kind: "insert-paragraph",
          regionId: block.id,
          afterRegionId: blockIndex > 0 ? projection.blocks[blockIndex - 1]!.id : null,
          text: block.text,
          ...(typeof block.attrs?.styleId === "string"
            ? { style: block.attrs.styleId }
            : {}),
        });
        continue;
      }
      // Yjs/Convex content normalization is allowed to omit native locator
      // metadata from an otherwise unchanged block. Keep the retained
      // paragraph/table locator as the source of truth; only semantic fields
      // supplied by the incoming projection may replace it.
      const incomingAttrs = { ...(block.attrs ?? {}) };
      delete incomingAttrs.paragraphIndex;
      delete incomingAttrs.tableIndex;
      delete incomingAttrs.rowCount;
      delete incomingAttrs.columnCount;
      const effectiveBlock = {
        ...block,
        attrs: {
          ...(previous.attrs ?? {}),
          ...incomingAttrs,
        },
      };
      before.delete(block.id);
      if (effectiveBlock.type === "table" && (effectiveBlock.text !== previous.text || JSON.stringify(effectiveBlock.rows) !== JSON.stringify(previous.rows))) {
        const oldRows = previous.rows ?? parseTableText(previous.text);
        const newRows = effectiveBlock.rows ?? parseTableText(effectiveBlock.text);
        if (
          oldRows.length !== newRows.length ||
          oldRows.some((row, index) => row.length !== newRows[index]?.length)
        )
          throw new DocxLensError(
            "DOCX_UNSUPPORTED_EDIT",
            "Changing a mounted Word table's row or column topology is unavailable in strict native mode.",
          );
        newRows.forEach((row, rowIndex) =>
          row.forEach((text, columnIndex) => {
            if (text !== oldRows[rowIndex]?.[columnIndex])
              operations.push({
                kind: "edit-table-cell",
                regionId: block.id,
                row: rowIndex,
                column: columnIndex,
                text,
              });
          }),
        );
      } else if (effectiveBlock.type !== "table" && effectiveBlock.text !== previous.text) {
        operations.push({
          kind: "replace-paragraph",
          regionId: block.id,
          text: effectiveBlock.text,
        });
      }
      const nextStyle = effectiveBlock.attrs?.styleId;
      if (
        typeof nextStyle === "string" &&
        nextStyle !== previous.attrs?.styleId
      )
        operations.push({
          kind: "apply-style",
          regionId: block.id,
          style: nextStyle,
        });
      // Only the properties the writer actually changed are written. Writing
      // the whole projected set back would turn resolved formatting into direct
      // formatting — a style-bold heading would gain its own `w:b`, and the next
      // person to edit the style in Word would find it no longer applied.
      const runDelta = changedFormatFields(
        previous.attrs?.format,
        effectiveBlock.attrs?.format,
        RUN_FORMAT_FIELDS,
      );
      if (runDelta)
        operations.push({ kind: "format-runs", regionId: block.id, format: runDelta });
      const paragraphDelta = changedFormatFields(
        previous.attrs?.paragraphFormat,
        effectiveBlock.attrs?.paragraphFormat,
        PARAGRAPH_FORMAT_FIELDS,
      );
      if (paragraphDelta)
        operations.push({
          kind: "format-paragraph",
          regionId: block.id,
          format: paragraphDelta,
        });
    }
    if (before.size)
      operations.push(
        ...[...before.keys()].map((regionId) => ({
          kind: "delete-region" as const,
          regionId,
        })),
      );
    const order = projection.blocks.map((block) => block.id);
    const priorOrder = carry.projection.blocks.map((block) => block.id);
    if (order.length !== priorOrder.length || order.some((id, index) => id !== priorOrder[index]))
      operations.push({ kind: "reorder-regions", order });
    if (!operations.length) return carry.payload;
    return applyDelta(carry, { kind: "ai-edit", operations });
  },

  async diffExternal(payloadA, payloadB): Promise<LensExternalDiff> {
    const [before, after, packageComparison] = await Promise.all([
      this.open(payloadA),
      this.open(payloadB),
      comparePackages(payloadA, payloadB),
    ]);
    const prior = new Map(before.projection.blocks.map((block) => [block.id, block]));
    const changes: LensExternalDiff["changes"] = [];
    for (const block of after.projection.blocks) {
      const previous = prior.get(block.id);
      prior.delete(block.id);
      if (!previous)
        changes.push({ regionId: block.id, kind: "insert", after: block });
      else if (JSON.stringify(previous) !== JSON.stringify(block))
        changes.push({
          regionId: block.id,
          kind: "update",
          before: previous,
          after: block,
        });
    }
    for (const block of prior.values())
      changes.push({ regionId: block.id, kind: "delete", before: block });
    const changedParts = packageComparison.parts
      .filter((part) => part.verdict !== "identical")
      .map((part) => `/${part.name}`);
    const modeledParts = new Set(["/word/document.xml"]);
    const preservedPartChanges = changedParts.filter(
      (part) => !modeledParts.has(part),
    );
    for (const partName of preservedPartChanges)
      changes.push({
        regionId: `docx:part:${partName}`,
        kind: "preserved-part-replaced",
        partName,
      });
    return { changes, changedParts, preservedPartChanges };
  },

  capabilities(profile, fidelityMap): LensCapabilitySet {
    const has = (feature: string) =>
      fidelityMap.entries.some((entry) => entry.feature === feature);
    const strict = profile === "strict-native";
    const unavailable = (id: string, reason: string) => ({
      id,
      available: false,
      reason,
    });
    return {
      profile,
      human: [
        { id: "edit-safe-paragraph", available: true },
        { id: "edit-safe-table-cell", available: true },
        { id: "insert-paragraph", available: true },
        has("trackedChanges")
          ? unavailable(
              "accept-revisions",
              "Accept or reject revisions in Word; Spectra is preserving the revision structure.",
            )
          : { id: "accept-revisions", available: false, reason: "No Word revisions are present." },
        has("field")
          ? unavailable(
              "update-field",
              "Update this field in Word; Spectra keeps the field code intact.",
            )
          : { id: "update-field", available: false, reason: "No Word fields are present." },
        strict
          ? unavailable(
              "insert-live-embed",
              "Live embeds cannot be represented in a strict native Word file.",
            )
          : { id: "insert-live-embed", available: true },
      ],
      aiOperations: [
        "replace_paragraph",
        "insert_paragraph",
        "edit_table_cell",
        "apply_paragraph_style",
        "format_runs",
        "format_paragraph",
      ],
    };
  },
};
