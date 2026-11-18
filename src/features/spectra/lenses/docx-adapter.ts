import { Document, WML_NAMESPACE } from "@ariadng/office/docx";
import { parseXml, serializeNode, XmlElement, XmlText } from "@ariadng/office/xml";
import { latexToEquation } from "./equation-interchange";
import { applyParagraphFormat, applyTableColumnWidths, docxLens, resolveParagraphStyleId, type DocxProjection } from "./docx-lens";
import { TEXT_COLUMN_EMU, paragraphFormatForNode } from "../../../../shared/document-projection.mjs";
import { documentContentToProseMirrorJson, type DocumentJsonNode } from "./document-projection";
import { docxRichInlineSchema, type DocxParagraphFormat } from "./projection-contracts";
import { appendNoteReference, upsertNativeNote } from "./docx-academic";
import { appendCommentBoundary, appendRevision, upsertNativeComment } from "./docx-academic-review";
import { appendWordBibliography, appendWordCitation } from "./docx-citations";

const RELATIONSHIP_NAMESPACE =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const HYPERLINK_RELATIONSHIP =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink";
const W14_NAMESPACE = "http://schemas.microsoft.com/office/word/2010/wordml";
const WORD_HIGHLIGHTS = new Set([
  "yellow", "green", "cyan", "magenta", "blue", "red", "darkBlue", "darkCyan",
  "darkGreen", "darkMagenta", "darkRed", "darkYellow", "darkGray", "lightGray",
  "black", "white", "none",
]);

export type DocxAssetRequest = {
  assetId?: string;
  src?: string;
  mediaType?: string;
  altText?: string;
};

/**
 * Durable asset resolver seam. Native writers receive bytes from a server or
 * explicitly controlled test resolver; authenticated content URLs are never
 * written into a package.
 */
export type DocxAssetResolver = (
  request: DocxAssetRequest,
) => Promise<Uint8Array | undefined>;

export type DocxFidelityNote = {
  scope: string;
  level: "exact" | "adapted" | "unsupported";
  message: string;
};

export type DocxConversionResult = {
  notes: DocxFidelityNote[];
};

export type DocxImportResult = {
  json: DocumentJsonNode;
  projection: DocxProjection;
  conversion: DocxConversionResult;
};

export type DocxPageSetup = {
  size?: string;
  orientation?: "portrait" | "landscape";
  margins?: string;
  columns?: number;
  header?: string;
  footer?: string;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function dataUrlBytes(value: string) {
  const match = /^data:([^;,]+)?;base64,([A-Za-z0-9+/=]+)$/u.exec(value.trim());
  if (!match) return undefined;
  const decode = globalThis.atob;
  if (typeof decode !== "function") return undefined;
  const binary = decode(match[2]!);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function dataUrl(mediaType: string, bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:${mediaType};base64,${globalThis.btoa(binary)}`;
}

function nativeImageToEditable(
  node: DocumentJsonNode,
  media: ReadonlyMap<string, string>,
) {
  if (node.type !== "nativeDocxImage") return node;
  const attrs = record(node.attrs);
  const src = typeof attrs.partName === "string" ? media.get(attrs.partName) : undefined;
  return {
    type: "image",
    attrs: {
      src: src ?? "",
      alt: typeof attrs.alt === "string" ? attrs.alt : "Word image",
      ...(typeof attrs.widthEmu === "number"
        ? { widthPercent: Math.round(Math.max(1, Math.min(100, (attrs.widthEmu / TEXT_COLUMN_EMU) * 100))) }
        : {}),
      ...(typeof attrs.widthEmu === "number" ? { widthEmu: attrs.widthEmu } : {}),
      ...(typeof attrs.heightEmu === "number" ? { heightEmu: attrs.heightEmu } : {}),
    },
  } satisfies DocumentJsonNode;
}

function replaceNativeImages(node: DocumentJsonNode, media: ReadonlyMap<string, string>): DocumentJsonNode {
  const converted = nativeImageToEditable(node, media);
  const next =
    converted !== node
      ? converted
      : {
          ...node,
          ...(node.content
            ? { content: node.content.map((child) => replaceNativeImages(child, media)) }
            : {}),
        };
  if (next.type !== "equation" && next.attrs?.nativeReadOnly === true) {
    const attrs = { ...(next.attrs ?? {}) };
    delete attrs.nativeReadOnly;
    return { ...next, attrs };
  }
  return next;
}

async function mediaForDocument(document: Document) {
  const media = new Map<string, string>();
  for (const image of document.images()) {
    const bytes = await image.data();
    const type = image.format === "jpeg" ? "image/jpeg" : "image/png";
    media.set(image.partName, dataUrl(type, bytes));
  }
  return media;
}

function unsupportedNativeMedia(document: Document) {
  return document.office.package.parts().flatMap((part) => {
    if (!part.name.toLowerCase().startsWith("/word/media/")) return [];
    if (part.contentType === "image/png" || part.contentType === "image/jpeg") return [];
    return [part.name];
  });
}

/** The native DOCX importer used by component import and linked open readback. */
export async function importDocxPayload(payload: Uint8Array): Promise<DocxImportResult> {
  const opened = await docxLens.open(payload, "enhanced");
  const document = await Document.open(opened.preservedCarry.safePayload ?? payload);
  const media = await mediaForDocument(document);
  const json = replaceNativeImages(
    documentContentToProseMirrorJson({
      blocks: opened.projection.blocks,
      nativeBinding: opened.projection.nativeBinding,
    }),
    media,
  );
  const unsupported = unsupportedNativeMedia(document);
  return {
    json,
    projection: opened.projection,
    conversion: {
      notes: [
        {
          scope: "Word structure, runs, links, lists, tables, and supported media",
          level: "exact",
          message: "Converted through the shared native DOCX projection.",
        },
        ...(unsupported.length
          ? [
              {
                scope: "unsupported media",
                level: "unsupported" as const,
                message: `${unsupported.length} Word media part${unsupported.length === 1 ? "" : "s"} remain preserved in the source package but cannot be embedded by this writer: ${unsupported.join(", ")}.`,
              },
            ]
          : []),
      ],
    },
  };
}

function clearParagraph(paragraph: XmlElement) {
  const properties = paragraph.find(WML_NAMESPACE, "pPr");
  for (const child of [...paragraph.children])
    if (child !== properties) paragraph.removeChild(child);
}

const PAGE_SIZES_TWIPS: Record<string, [number, number]> = {
  a4: [11_906, 16_838],
  letter: [12_240, 15_840],
  legal: [12_240, 20_160],
  a5: [8_391, 11_906],
};

const MARGIN_TWIPS: Record<string, number> = {
  narrow: 680,
  normal: 1_440,
  wide: 2_268,
};

function setPageSetup(document: Document, setup: DocxPageSetup | undefined) {
  if (!setup) return;
  if (setup.header?.trim()) document.setHeader(setup.header.trim());
  if (setup.footer?.trim()) document.setFooter(setup.footer.trim());
  const body = document.body();
  let section = body.find(WML_NAMESPACE, "sectPr");
  if (!section) {
    section = new XmlElement("sectPr", "w");
    body.appendChild(section);
  }
  const dimensions = PAGE_SIZES_TWIPS[setup.size ?? "a4"] ?? PAGE_SIZES_TWIPS.a4!;
  const landscape = setup.orientation === "landscape";
  const pageSize = section.find(WML_NAMESPACE, "pgSz") ?? new XmlElement("pgSz", "w");
  pageSize.setAttributeNs(WML_NAMESPACE, "w", String(landscape ? dimensions[1] : dimensions[0]));
  pageSize.setAttributeNs(WML_NAMESPACE, "h", String(landscape ? dimensions[0] : dimensions[1]));
  if (!pageSize.parent) section.appendChild(pageSize);
  if (landscape) pageSize.setAttributeNs(WML_NAMESPACE, "orient", "landscape");
  else pageSize.removeAttributeNs(WML_NAMESPACE, "orient");
  const margin = section.find(WML_NAMESPACE, "pgMar") ?? new XmlElement("pgMar", "w");
  const value = String(MARGIN_TWIPS[setup.margins ?? "normal"] ?? MARGIN_TWIPS.normal);
  for (const side of ["top", "right", "bottom", "left", "header", "footer"])
    margin.setAttributeNs(WML_NAMESPACE, side, value);
  if (!margin.parent) section.appendChild(margin);
  const columns = Math.min(3, Math.max(1, Math.round(Number(setup.columns) || 1)));
  const cols = section.find(WML_NAMESPACE, "cols") ?? new XmlElement("cols", "w");
  if (columns === 1) cols.removeAttributeNs(WML_NAMESPACE, "num");
  else cols.setAttributeNs(WML_NAMESPACE, "num", String(columns));
  if (!cols.parent) section.appendChild(cols);
  document._markMainDirty();
}

function stableParaId(value: string) {
  let hash = 0x811c9dc5;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  // Word's w14:paraId lexical value is constrained to an unsigned 31-bit
  // range; reserve the high bit while retaining an eight-digit identity.
  return ((hash >>> 0) & 0x7fffffff).toString(16).padStart(8, "0").toUpperCase();
}

function safeHref(value: string) {
  if (!/^(?:https?:|mailto:)/i.test(value) || /[\u0000-\u001f\u007f]/u.test(value))
    throw new Error("Only http(s) and mailto hyperlinks can be exported to Word.");
  return value;
}

function relationshipForHref(document: Document, href: string) {
  const target = safeHref(href);
  const existing = document.office.mainPart.relationships().all().find(
    (relationship) =>
      relationship.type === HYPERLINK_RELATIONSHIP &&
      relationship.targetMode === "External" &&
      relationship.target === target,
  );
  return (
    existing ??
    document.office.mainPart.relationships().add({
      type: HYPERLINK_RELATIONSHIP,
      target,
      targetMode: "External",
    })
  ).id;
}

function safeHex(value: unknown) {
  if (typeof value !== "string") return undefined;
  const hex = value.replace(/^#/, "");
  return /^[0-9a-f]{6}$/iu.test(hex) ? hex.toUpperCase() : undefined;
}

// CT_RPr child order: Word rejects a run whose properties are out of sequence.
const RUN_ORDER = [
  "rStyle", "rFonts", "b", "bCs", "i", "iCs", "caps", "smallCaps", "strike", "color", "sz", "szCs", "highlight", "u", "shd",
  "vertAlign",
];

/** The editor's font size ("18pt", "24px", "1.5em") in points. */
function fontSizePoints(value: unknown) {
  if (typeof value === "number" && value > 0) return value;
  if (typeof value !== "string") return undefined;
  const match = value.trim().match(/^(\d+(?:\.\d+)?)\s*(pt|px|em|rem)?$/i);
  if (!match) return undefined;
  const amount = Number(match[1]);
  const unit = (match[2] ?? "pt").toLowerCase();
  const points = unit === "px" ? amount * 0.75 : unit === "em" || unit === "rem" ? amount * 11 : amount;
  return points > 0 && points <= 1638 ? Math.round(points * 2) / 2 : undefined;
}

function orderedRunChild(parent: XmlElement, name: string) {
  const existing = parent.find(WML_NAMESPACE, name);
  if (existing) return existing;
  const element = new XmlElement(name, "w");
  const rank = RUN_ORDER.indexOf(name);
  const before = parent.elements().find((child) => {
    const childRank = RUN_ORDER.indexOf(child.localName);
    return childRank >= 0 && childRank > rank;
  });
  parent.insertBefore(element, before ?? null);
  return element;
}

function writeRunFormat(run: XmlElement, format: Record<string, unknown>) {
  const properties = new XmlElement("rPr", "w");
  run.insertBefore(properties, run.children[0] ?? null);
  const toggle = (name: string, key: string) => {
    if (format[key] !== true) return;
    orderedRunChild(properties, name);
  };
  toggle("b", "bold");
  toggle("i", "italic");
  toggle("strike", "strike");
  toggle("caps", "allCaps");
  toggle("smallCaps", "smallCaps");
  if (format.verticalAlign === "superscript" || format.verticalAlign === "subscript")
    orderedRunChild(properties, "vertAlign").setAttribute("w:val", format.verticalAlign);
  if (format.underline === true) orderedRunChild(properties, "u").setAttribute("w:val", "single");
  if (typeof format.fontFamily === "string") {
    const family = format.fontFamily.split(",")[0]!.trim().replace(/["']/g, "");
    if (!family) throw new Error("A Word run requires a concrete font family.");
    const fonts = orderedRunChild(properties, "rFonts");
    for (const slot of ["ascii", "hAnsi", "eastAsia", "cs"]) fonts.setAttribute(`w:${slot}`, family);
  }
  const size = fontSizePoints(format.fontSizePoints ?? format.fontSize);
  if (size) {
    const halfPoints = String(Math.round(size * 2));
    orderedRunChild(properties, "sz").setAttribute("w:val", halfPoints);
    orderedRunChild(properties, "szCs").setAttribute("w:val", halfPoints);
  }
  const color = safeHex(format.color);
  if (color) orderedRunChild(properties, "color").setAttribute("w:val", color);
  const shading = safeHex(format.shading);
  if (shading) orderedRunChild(properties, "shd").setAttribute("w:fill", shading);
  if (typeof format.highlight === "string" && WORD_HIGHLIGHTS.has(format.highlight))
    orderedRunChild(properties, "highlight").setAttribute("w:val", format.highlight);
  if (!properties.elements().length) run.removeChild(properties);
}

function appendTextRun(
  document: Document,
  paragraph: XmlElement,
  text: string,
  marks: readonly { type: string; attrs?: Record<string, unknown> }[] = [],
) {
  const run = new XmlElement("r", "w");
  const mark = (type: string) => marks.find((candidate) => candidate.type === type);
  const style = record(mark("textStyle")?.attrs);
  const highlight = record(mark("highlight")?.attrs).color;
  const code = Boolean(mark("code"));
  writeRunFormat(run, {
    ...(mark("bold") ? { bold: true } : {}),
    ...(mark("italic") ? { italic: true } : {}),
    ...(mark("underline") ? { underline: true } : {}),
    ...(mark("strike") ? { strike: true } : {}),
    ...(mark("superscript") ? { verticalAlign: "superscript" } : mark("subscript") ? { verticalAlign: "subscript" } : {}),
    ...(mark("smallCaps") ? { smallCaps: true } : {}),
    ...(mark("allCaps") ? { allCaps: true } : {}),
    // Inline code reads as code in Word too: a monospace face on a light ground.
    ...(code ? { fontFamily: "Consolas", shading: "F2F2F2" } : {}),
    ...style,
    ...(typeof highlight === "string" && WORD_HIGHLIGHTS.has(highlight)
      ? { highlight }
      : safeHex(highlight)
        ? { shading: safeHex(highlight) }
        : {}),
  });
  for (const chunk of text.split(/([\t\n])/u)) {
    if (!chunk) continue;
    if (chunk === "\t") {
      run.appendChild(new XmlElement("tab", "w"));
      continue;
    }
    if (chunk === "\n") {
      run.appendChild(new XmlElement("br", "w"));
      continue;
    }
    const textElement = new XmlElement("t", "w");
    if (/^\s|\s$/u.test(chunk)) textElement.setAttribute("xml:space", "preserve");
    textElement.appendChild(new XmlText(chunk));
    run.appendChild(textElement);
  }
  const href = record(mark("link")?.attrs).href;
  if (typeof href === "string" && href) {
    const link = new XmlElement("hyperlink", "w");
    link.setAttributeNs(RELATIONSHIP_NAMESPACE, "id", relationshipForHref(document, href));
    link.appendChild(run);
    paragraph.appendChild(link);
  } else paragraph.appendChild(run);
}

function equationRootForDisplay(value: string, display?: "inline" | "block") {
  const root = parseXml(value).root;
  if (
    root.namespaceUri() !==
    "http://schemas.openxmlformats.org/officeDocument/2006/math"
  )
    throw new Error("The retained equation is not valid OMML.");
  if (!display) return root;
  if (display === "inline") {
    if (root.localName === "oMath") return root;
    const inline = root.find("http://schemas.openxmlformats.org/officeDocument/2006/math", "oMath");
    if (!inline) throw new Error("The display equation has no native oMath body.");
    return inline.clone();
  }
  if (root.localName === "oMathPara") return root;
  return parseXml(
    `<m:oMathPara xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">${serializeNode(root)}</m:oMathPara>`,
  ).root;
}

function appendNativeOmml(paragraph: XmlElement, value: string, display?: "inline" | "block") {
  paragraph.appendChild(equationRootForDisplay(value, display));
}

function appendEquation(
  paragraph: XmlElement,
  latex: string,
  display: "inline" | "block",
  ommlXml?: string,
  ommlSourceLatex?: string,
) {
  // A retained subtree is authoritative only for the exact source it
  // represented on open. If the editor changed LaTeX, regenerate semantic
  // OMML instead of accidentally exporting the old native equation.
  if (ommlXml && ommlSourceLatex !== undefined && ommlSourceLatex === latex) {
    // An unchanged retained subtree is authoritative byte-for-byte. Display
    // changes are handled by the linked lens operation, not by copy export.
    appendNativeOmml(paragraph, ommlXml);
    return;
  }
  const interchange = latexToEquation(latex, display);
  if (!interchange.supported)
    throw new Error(`Equation contains unsupported commands: ${interchange.unsupported.join(", ")}`);
  appendNativeOmml(paragraph, interchange.xml, display);
}

async function appendInlineContent(
  document: Document,
  paragraph: XmlElement,
  content: readonly DocumentJsonNode[],
  resolver: DocxAssetResolver | undefined,
) {
  for (const node of content) {
    if (["wordRevision", "wordCommentBoundary", "spectraCitation"].includes(node.type ?? "") && node.attrs?.native) {
      const item = docxRichInlineSchema.parse(node.attrs.native);
      if (item.kind === "revision") appendRevision(paragraph, item, undefined, document);
      if (item.kind === "commentBoundary") { if (item.comment) await upsertNativeComment(document, item.commentId, item.comment); appendCommentBoundary(paragraph, item.commentId, item.boundary); }
      if (item.kind === "citation") await appendWordCitation(document, paragraph, item);
      if (item.kind === "bibliography") await appendWordBibliography(document, paragraph, item);
      continue;
    }
    if (node.type === "footnote" || node.type === "endnote") {
      const item = docxRichInlineSchema.parse({ kind: "noteRef", noteType: node.type, noteId: node.attrs?.nativeNoteId, text: node.attrs?.text ?? "", ...(node.attrs?.noteContent ? { content: node.attrs.noteContent } : {}) });
      if (item.kind === "noteRef") { await upsertNativeNote(document, item); appendNoteReference(paragraph, item.noteType, item.noteId); }
      continue;
    }
    if (node.type === "text" && node.text) appendTextRun(document, paragraph, node.text, node.marks);
    else if (node.type === "hardBreak") {
      const run = new XmlElement("r", "w");
      run.appendChild(new XmlElement("br", "w"));
      paragraph.appendChild(run);
    }
    else if (node.type === "inlineEquation") {
      const attrs = record(node.attrs);
      appendEquation(
        paragraph,
        String(attrs.latex ?? ""),
        attrs.display === "block" ? "block" : "inline",
        typeof attrs.ommlXml === "string" && attrs.ommlXml ? attrs.ommlXml : undefined,
        typeof attrs.ommlSourceLatex === "string" ? attrs.ommlSourceLatex : undefined,
      );
    } else if (node.type === "image") {
      await appendImageInline(document, paragraph, node, resolver);
    } else if (node.content)
      await appendInlineContent(document, paragraph, node.content, resolver);
  }
}

async function appendParagraph(
  document: Document,
  node: DocumentJsonNode,
  style: string | undefined,
  resolver: DocxAssetResolver | undefined,
  look?: Partial<DocxParagraphFormat>,
) {
  // A fresh package defines only Normal; the heading style is added on first use.
  const styleId = style ? await resolveParagraphStyleId(document, style) : undefined;
  const paragraph = document.addParagraph("", styleId ? { style: styleId } : {});
  const blockId = record(node.attrs).blockId;
  paragraph.element.setAttributeNs(
    W14_NAMESPACE,
    "paraId",
    stableParaId(typeof blockId === "string" ? blockId : crypto.randomUUID()),
  );
  clearParagraph(paragraph.element);
  await appendInlineContent(document, paragraph.element, node.content ?? [], resolver);
  applyNodeParagraphFormat(document, paragraph, node);
  if (look) applyParagraphFormat(document, paragraph, look as DocxParagraphFormat);
  return paragraph;
}

/** How a quote, code block or callout looks in Word: the same as the Word sync writes it. */
const QUOTE_LOOK = { indentLevel: 1, border: "left" } as const;
const CODE_LOOK = { shading: "F2F2F2" } as const;
const CALLOUT_LOOK = { border: "all", shading: "EEF3FB" } as const;
const DIVIDER_LOOK = { border: "bottom" } as const;

function taskItemParagraphs(
  list: DocumentJsonNode,
  level: number,
): { paragraph: DocumentJsonNode; level: number; checked: boolean }[] {
  return (list.content ?? []).flatMap((item) =>
    (item.content ?? []).flatMap((child) =>
      child.type === "taskList"
        ? taskItemParagraphs(child, Math.min(8, level + 1))
        : child.type === "paragraph"
          ? [{ paragraph: child, level, checked: item.attrs?.checked === true }]
          : [],
    ),
  );
}

function monospace(node: DocumentJsonNode): DocumentJsonNode {
  if (node.type === "text")
    return { ...node, marks: [...(node.marks ?? []), { type: "textStyle", attrs: { fontFamily: "Consolas" } }] };
  return node.content ? { ...node, content: node.content.map(monospace) } : node;
}

type CellPlacement = { row: number; column: number; colspan: number; rowspan: number; cell: DocumentJsonNode };

/** Where each editor cell sits on the table's grid, after the cells merged into rows above. */
function tableGrid(rows: readonly DocumentJsonNode[]) {
  const taken = new Set<string>();
  const placements: CellPlacement[] = [];
  let columns = 1;
  rows.forEach((row, rowIndex) => {
    let column = 0;
    for (const cell of row.content ?? []) {
      while (taken.has(`${rowIndex}:${column}`)) column += 1;
      const colspan = Math.max(1, Math.min(63, Math.round(Number(cell.attrs?.colspan) || 1)));
      const rowspan = Math.max(1, Math.min(rows.length - rowIndex, Math.round(Number(cell.attrs?.rowspan) || 1)));
      for (let r = rowIndex; r < rowIndex + rowspan; r += 1)
        for (let c = column; c < column + colspan; c += 1) taken.add(`${r}:${c}`);
      placements.push({ row: rowIndex, column, colspan, rowspan, cell });
      column += colspan;
      columns = Math.max(columns, column);
    }
  });
  for (const key of taken) columns = Math.max(columns, Number(key.split(":")[1]) + 1);
  return { placements, columns };
}

/** Word's merges: `gridSpan` across columns, `vMerge` down rows; the covered cells go. */
function mergeTableCells(table: XmlElement, placements: readonly CellPlacement[]) {
  const rows = table.elements().filter((child) => child.localName === "tr");
  const cells = rows.map((row) => row.elements().filter((child) => child.localName === "tc"));
  const covered = new Set<XmlElement>();
  const mark = (cell: XmlElement | undefined, colspan: number, vMerge: "restart" | "continue" | null) => {
    if (!cell || (colspan === 1 && !vMerge)) return;
    let properties = cell.find(WML_NAMESPACE, "tcPr");
    if (!properties) {
      properties = new XmlElement("tcPr", cell.prefix);
      cell.insertBefore(properties, cell.children[0] ?? null);
    }
    const after = properties.elements().find((child) => !["cnfStyle", "tcW"].includes(child.localName)) ?? null;
    if (colspan > 1) {
      const span = new XmlElement("gridSpan", cell.prefix);
      span.setAttribute("w:val", String(colspan));
      properties.insertBefore(span, after);
    }
    if (vMerge) {
      const merge = new XmlElement("vMerge", cell.prefix);
      if (vMerge === "restart") merge.setAttribute("w:val", "restart");
      properties.insertBefore(merge, after);
    }
  };
  for (const { row, column, colspan, rowspan } of placements) {
    if (colspan === 1 && rowspan === 1) continue;
    for (let r = row; r < row + rowspan; r += 1) {
      mark(cells[r]?.[column], colspan, rowspan > 1 ? (r === row ? "restart" : "continue") : null);
      for (let c = column + 1; c < column + colspan; c += 1) {
        const cell = cells[r]?.[c];
        if (cell) covered.add(cell);
      }
    }
  }
  for (const cell of covered) cell.parent?.removeChild(cell);
}

/** Cell paragraphs joined by Word line breaks, so their text stays apart. */
function cellInline(cell: DocumentJsonNode) {
  return (cell.content ?? []).flatMap((child, index) => [
    ...(index ? [{ type: "hardBreak" } as DocumentJsonNode] : []),
    ...(child.content ?? [child]),
  ]);
}

function writeCopyTableShape(document: Document, table: XmlElement, node: DocumentJsonNode) {
  const properties = table.find(WML_NAMESPACE, "tblPr");
  // `TableGrid` is not defined in a fresh package, so the borders are direct.
  if (properties && !properties.find(WML_NAMESPACE, "tblBorders")) {
    const borders = parseXml(
      `<w:tblBorders xmlns:w="${WML_NAMESPACE}">` +
        ["top", "left", "bottom", "right", "insideH", "insideV"]
          .map((side) => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="auto"/>`)
          .join("") +
        "</w:tblBorders>",
    ).root;
    const later = properties.elements().find((child) =>
      ["shd", "tblLayout", "tblCellMar", "tblLook", "tblCaption", "tblDescription"].includes(child.localName));
    properties.insertBefore(borders, later ?? null);
  }
  const firstRow = node.content?.[0];
  if (firstRow?.content?.length && firstRow.content.every((cell) => cell.type === "tableHeader")) {
    const row = table.find(WML_NAMESPACE, "tr");
    if (row) {
      const rowProperties = new XmlElement("trPr", row.prefix);
      row.insertBefore(rowProperties, row.children[0] ?? null);
      const header = new XmlElement("tblHeader", row.prefix);
      rowProperties.appendChild(header);
      header.setAttributeNs(WML_NAMESPACE, "val", "1");
    }
  }
  // `colwidth` holds one width per column a cell spans.
  const widths = (firstRow?.content ?? []).flatMap((cell) => {
    const span = Math.max(1, Math.round(Number(cell.attrs?.colspan) || 1));
    const given = Array.isArray(cell.attrs?.colwidth) ? cell.attrs.colwidth : [];
    return Array.from({ length: span }, (_, index) => {
      const width = Number(given[index]);
      return Number.isFinite(width) && width > 0 ? width : null;
    });
  });
  if (widths.some((width) => width !== null)) applyTableColumnWidths(document, table, widths);
}

/** Alignment, spacing and indents the editor shows, written as Word's `w:pPr`. */
function applyNodeParagraphFormat(
  document: Document,
  paragraph: ReturnType<Document["addParagraph"]>,
  node: DocumentJsonNode | undefined,
) {
  const format = node ? (paragraphFormatForNode(node) as DocxParagraphFormat | undefined) : undefined;
  if (format) applyParagraphFormat(document, paragraph, format);
}

let copyColumnEmu = TEXT_COLUMN_EMU;

async function appendImage(document: Document, node: DocumentJsonNode, resolver: DocxAssetResolver | undefined) {
  const attrs = record(node.attrs);
  const bytes =
    typeof attrs.src === "string" ? dataUrlBytes(attrs.src) : undefined;
  const resolved =
    bytes ??
    (resolver
      ? await resolver({
          assetId: typeof attrs.assetId === "string" ? attrs.assetId : undefined,
          src: typeof attrs.src === "string" ? attrs.src : undefined,
          mediaType: typeof attrs.mediaType === "string" ? attrs.mediaType : undefined,
          altText: typeof attrs.alt === "string" ? attrs.alt : undefined,
        })
      : undefined);
  if (!resolved) throw new Error("Image bytes are unavailable to the durable DOCX asset resolver.");
  const widthPercent = Number(attrs.widthPercent);
  const widthEmu = Number(attrs.widthEmu);
  const heightEmu = Number(attrs.heightEmu);
  const hasEmuSize = Number.isSafeInteger(widthEmu) && widthEmu > 0;
  return document.addImage(resolved, {
    altText: typeof attrs.alt === "string" ? attrs.alt : "",
    ...(hasEmuSize
      ? {
          widthEmu,
          ...(Number.isSafeInteger(heightEmu) && heightEmu > 0 ? { heightEmu } : {}),
        }
      : Number.isFinite(widthPercent) && widthPercent > 0
      ? { widthEmu: Math.round((copyColumnEmu * Math.min(100, widthPercent)) / 100) }
      : {}),
  });
}

/** Word does not shrink a picture to its column, so a large one is scaled here. */
function fitDrawingToColumn(run: XmlElement) {
  const descendants = (element: XmlElement): XmlElement[] =>
    element.elements().flatMap((child) => [child, ...descendants(child)]);
  const sizes = descendants(run).filter((element) => element.localName === "extent" || element.localName === "ext");
  const outer = sizes.find((element) => element.localName === "extent");
  const width = Number(outer?.getAttribute("cx"));
  if (!outer || !Number.isFinite(width) || width <= copyColumnEmu) return;
  const scale = copyColumnEmu / width;
  for (const size of sizes) {
    const cx = Number(size.getAttribute("cx"));
    const cy = Number(size.getAttribute("cy"));
    if (!Number.isFinite(cx) || !Number.isFinite(cy)) continue;
    size.setAttribute("cx", String(Math.round(cx * scale)));
    size.setAttribute("cy", String(Math.round(cy * scale)));
  }
}

async function appendImageInline(
  document: Document,
  paragraph: XmlElement,
  node: DocumentJsonNode,
  resolver: DocxAssetResolver | undefined,
) {
  await appendImage(document, node, resolver);
  const carrier = [...document.body().elements()]
    .reverse()
    .find(
      (candidate) =>
        candidate.localName === "p" &&
        candidate !== paragraph &&
        candidate.elements().some((child) => child.localName === "r"),
    );
  const run = carrier?.elements().find((child) => child.localName === "r");
  if (!carrier || !run) throw new Error("The inline Word image drawing was not created.");
  carrier.removeChild(run);
  fitDrawingToColumn(run);
  paragraph.appendChild(run);
  if (!carrier.elements().length) document.body().removeChild(carrier);
}

/** The writable width of the copy's page, the width image percentages refer to. */
function textColumnEmu(setup: DocxPageSetup | undefined) {
  // With no page controls the package keeps the library's Letter page.
  const dimensions = PAGE_SIZES_TWIPS[setup ? setup.size ?? "a4" : "letter"] ?? PAGE_SIZES_TWIPS.a4!;
  const pageWidth = setup?.orientation === "landscape" ? dimensions[1] : dimensions[0];
  const margin = MARGIN_TWIPS[setup?.margins ?? "normal"] ?? MARGIN_TWIPS.normal!;
  const columns = Math.min(3, Math.max(1, Math.round(Number(setup?.columns) || 1)));
  const gap = 720 * (columns - 1);
  return Math.round(((pageWidth - 2 * margin - gap) / columns) * 635);
}

type ListSource = { paragraph: DocumentJsonNode; level: number; ordered: boolean; start: number };

function listItemParagraphs(list: DocumentJsonNode, level: number): ListSource[] {
  const ordered = list.type === "orderedList";
  const start = ordered ? Math.max(0, Math.round(Number(list.attrs?.start) || 1)) : 1;
  return (list.content ?? []).flatMap((item) =>
    (item.content ?? []).flatMap((child) =>
      child.type === "bulletList" || child.type === "orderedList"
        ? listItemParagraphs(child, Math.min(8, level + 1))
        : child.type === "paragraph" || child.type === "heading"
          ? [{ paragraph: child, level, ordered, start }]
          : [],
    ),
  );
}

/**
 * One numbering definition holds a whole nested list, so a level whose kind
 * differs from the outer list (bullets inside a numbered list) is reshaped, and
 * a numbered list starting above 1 says so with `w:start`.
 */
function shapeListLevels(document: Document, first: XmlElement | undefined, sources: readonly ListSource[], outerOrdered: boolean) {
  const numId = first?.find(WML_NAMESPACE, "pPr")?.find(WML_NAMESPACE, "numPr")?.find(WML_NAMESPACE, "numId")?.getAttributeNs(WML_NAMESPACE, "val");
  const numbering = document._internal().numbering();
  const root = numbering?.doc.root;
  if (!numId || !numbering || !root) return;
  const num = root.findAll(WML_NAMESPACE, "num").find((entry) => entry.getAttributeNs(WML_NAMESPACE, "numId") === numId);
  const abstractId = num?.find(WML_NAMESPACE, "abstractNumId")?.getAttributeNs(WML_NAMESPACE, "val");
  const abstract = root.findAll(WML_NAMESPACE, "abstractNum").find((entry) => entry.getAttributeNs(WML_NAMESPACE, "abstractNumId") === abstractId);
  if (!abstract) return;
  const shaped = new Set<number>();
  let dirty = false;
  for (const { level, ordered, start } of sources) {
    if (shaped.has(level)) continue;
    shaped.add(level);
    const lvl = abstract.findAll(WML_NAMESPACE, "lvl").find((entry) => entry.getAttributeNs(WML_NAMESPACE, "ilvl") === String(level));
    if (!lvl) continue;
    if (ordered !== outerOrdered) {
      lvl.find(WML_NAMESPACE, "numFmt")?.setAttributeNs(WML_NAMESPACE, "val", ordered ? (["decimal", "lowerLetter", "lowerRoman"][level % 3] ?? "decimal") : "bullet");
      lvl.find(WML_NAMESPACE, "lvlText")?.setAttributeNs(WML_NAMESPACE, "val", ordered ? `%${level + 1}.` : "•");
      // A bullet level's symbol font would turn digits into glyphs.
      const runFormat = lvl.find(WML_NAMESPACE, "rPr");
      if (ordered && runFormat) lvl.removeChild(runFormat);
      dirty = true;
    }
    if (ordered && start !== 1) {
      lvl.find(WML_NAMESPACE, "start")?.setAttributeNs(WML_NAMESPACE, "val", String(start));
      dirty = true;
    }
  }
  if (dirty) document._internal().markDirty(numbering);
}

/**
 * Shared new-package/copy writer. Linked writes use the same semantic
 * operations through `docxLens`; this function is the new-artifact branch of
 * the adapter and never receives permission to replace a retained payload.
 */
export async function exportDocxCopy(
  json: DocumentJsonNode,
  options: { resolveAsset?: DocxAssetResolver; pageSetup?: DocxPageSetup } = {},
) {
  const document = Document.create();
  setPageSetup(document, options.pageSetup);
  copyColumnEmu = textColumnEmu(options.pageSetup);
  const notes: DocxFidelityNote[] = [];
  for (const node of json.content ?? []) {
    try {
      if (node.type === "table") {
        const rows = node.content ?? [];
        const { placements, columns } = tableGrid(rows);
        const table = document.addTable(Math.max(1, rows.length), columns);
        for (const { row: rowIndex, column: columnIndex, cell } of placements) {
            const paragraph = table.cell(rowIndex, columnIndex).paragraphElements()[0];
            if (paragraph) {
              clearParagraph(paragraph);
              await appendInlineContent(document, paragraph, cellInline(cell), options.resolveAsset);
              const alignment = (cell.content ?? []).find((child) => child.type === "paragraph")?.attrs?.textAlign;
              if (alignment === "center" || alignment === "right" || alignment === "justify") {
                const pPr = new XmlElement("pPr", paragraph.prefix);
                paragraph.insertBefore(pPr, paragraph.children[0] ?? null);
                const jc = new XmlElement("jc", paragraph.prefix);
                pPr.appendChild(jc);
                jc.setAttributeNs(WML_NAMESPACE, "val", alignment === "justify" ? "both" : alignment);
              }
            }
          }
        mergeTableCells(table.element, placements);
        writeCopyTableShape(document, table.element, node);
        continue;
      }
      if (node.type === "image") {
        await appendParagraph(document, { type: "paragraph", content: [node] }, undefined, options.resolveAsset);
        continue;
      }
      if (node.type === "spectraReference" || node.type === "spectraCitation") {
        const attrs = record(node.attrs);
        const label = String(
          attrs.label ??
            (node.type === "spectraReference" ? "Spectra reference" : "Citation"),
        );
        await appendParagraph(
          document,
          { type: "paragraph", content: [{ type: "text", text: label }] },
          undefined,
          options.resolveAsset,
        );
        notes.push({
          scope: node.type,
          level: "adapted",
          message:
            "The copy keeps the reference label as editable Word text; Spectra embed insertion remains owned by the embed workflow.",
        });
        continue;
      }
      if (node.type === "bulletList" || node.type === "orderedList") {
        // Nested lists keep their depth; an item's later paragraphs follow it
        // at the same level instead of being dropped.
        const sources = listItemParagraphs(node, 0);
        const items = sources.map((source) => ({ text: "", level: source.level }));
        const paragraphs =
          node.type === "bulletList"
            ? document.addBulletList(items)
            : document.addNumberedList(items);
        shapeListLevels(document, paragraphs[0]?.element, sources, node.type === "orderedList");
        for (const [index, paragraph] of paragraphs.entries()) {
          clearParagraph(paragraph.element);
          const source = sources[index]?.paragraph;
          await appendInlineContent(document, paragraph.element, source?.content ?? [], options.resolveAsset);
          applyNodeParagraphFormat(document, paragraph, source);
        }
        continue;
      }
      if (node.type === "heading") {
        const level = Math.min(6, Math.max(1, Number(record(node.attrs).level) || 2));
        await appendParagraph(document, node, `Heading${level}`, options.resolveAsset);
        continue;
      }
      if (node.type === "equation") {
        const attrs = record(node.attrs);
        await appendParagraph(document, {
          type: "paragraph",
          content: [
            { type: "inlineEquation", attrs: { latex: String(attrs.latex ?? ""), display: attrs.display === "inline" ? "inline" : "block", ...(typeof attrs.ommlXml === "string" && attrs.ommlXml ? { ommlXml: attrs.ommlXml } : {}), ...(typeof attrs.ommlSourceLatex === "string" ? { ommlSourceLatex: attrs.ommlSourceLatex } : {}) } },
          ],
        }, undefined, options.resolveAsset);
        continue;
      }
      if (node.type === "blockquote" || node.type === "callout") {
        // One Word paragraph per editor paragraph: merging them ran the text together.
        const look = node.type === "blockquote" ? QUOTE_LOOK : CALLOUT_LOOK;
        const children = node.content?.some((child) => child.type === "paragraph" || child.type === "heading")
          ? node.content
          : [{ type: "paragraph", content: node.content ?? [] } as DocumentJsonNode];
        for (const child of children)
          await appendParagraph(document, child, child.type === "heading" ? `Heading${Math.min(6, Math.max(1, Number(record(child.attrs).level) || 2))}` : undefined, options.resolveAsset, look);
        continue;
      }
      if (node.type === "codeBlock") {
        await appendParagraph(document, monospace(node), undefined, options.resolveAsset, CODE_LOOK);
        continue;
      }
      if (node.type === "horizontalRule") {
        // Word's own divider: an empty paragraph with a bottom border.
        await appendParagraph(document, { type: "paragraph", content: [] }, undefined, options.resolveAsset, DIVIDER_LOOK);
        continue;
      }
      if (node.type === "pageBreak") {
        const paragraph = await appendParagraph(document, { type: "paragraph", content: [] }, undefined, options.resolveAsset);
        const run = new XmlElement("r", "w");
        const pageBreak = new XmlElement("br", "w");
        pageBreak.setAttribute("w:type", "page");
        run.appendChild(pageBreak);
        paragraph.element.appendChild(run);
        continue;
      }
      if (node.type === "taskList") {
        // Word has no checklist outside content controls; a ballot box keeps the state readable.
        for (const { paragraph, level, checked } of taskItemParagraphs(node, 0)) {
          const box: DocumentJsonNode = { type: "text", text: checked ? "☒ " : "☐ " };
          await appendParagraph(
            document,
            { ...paragraph, content: [box, ...(paragraph.content ?? [])] },
            undefined,
            options.resolveAsset,
            level ? { indentLevel: level } : undefined,
          );
        }
        continue;
      }
      if (
        ![
          "paragraph",
          "blockquote",
          "codeBlock",
          "callout",
        ].includes(node.type ?? "")
      )
        throw new Error(`The ${node.type ?? "unknown"} node has no shared Word copy writer.`);
      await appendParagraph(document, node, undefined, options.resolveAsset);
    } catch (error) {
      // A missing/revoked durable image is a failed export, not an unsupported
      // node. Replacing it with a text placeholder would silently drop user
      // media while reporting a successful Word copy.
      const hasAcademicNode = (value: DocumentJsonNode): boolean => ["footnote", "endnote", "wordRevision", "wordCommentBoundary"].includes(value.type ?? "") || Boolean(value.type === "spectraCitation" && value.attrs?.native) || Boolean(value.content?.some(hasAcademicNode));
      if (node.type === "image" || hasAcademicNode(node)) throw error;
      await appendParagraph(document, {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: `[Unsupported ${node.type ?? "content"}: ${
              error instanceof Error ? error.message : "not representable"
            }]`,
          },
        ],
      }, undefined, options.resolveAsset);
      notes.push({
        scope: node.type ?? "document node",
        level: "unsupported",
        message: error instanceof Error ? error.message : "This content could not be embedded in the Word copy.",
      });
    }
  }
  const bytes = await document.save();
  notes.unshift({
    scope: "Word structure, rich runs, links, lists, tables, and supported media",
    level: "exact",
    message: "Created through the shared @ariadng/office DOCX adapter.",
  });
  return { bytes, conversion: { notes } };
}

export const docxFormatAdapter = {
  open: docxLens.open.bind(docxLens),
  mutate: docxLens.mutate.bind(docxLens),
  materialize: docxLens.materialize.bind(docxLens),
  diffExternal: docxLens.diffExternal.bind(docxLens),
  import: importDocxPayload,
  exportCopy: exportDocxCopy,
};
