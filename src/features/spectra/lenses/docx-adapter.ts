import { Document, WML_NAMESPACE } from "@ariadng/office/docx";
import { parseXml, serializeNode, XmlElement, XmlText } from "@ariadng/office/xml";
import { latexToEquation } from "./equation-interchange";
import { docxLens, type DocxProjection } from "./docx-lens";
import { documentContentToProseMirrorJson, type DocumentJsonNode } from "./document-projection";

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
        ? { widthPercent: Math.max(1, Math.min(100, (attrs.widthEmu / 914400) / 8.27 * 100)) }
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
  return (hash >>> 0).toString(16).padStart(8, "0").toUpperCase();
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

const RUN_ORDER = [
  "rStyle", "rFonts", "b", "bCs", "i", "iCs", "strike", "color", "sz", "szCs", "highlight", "u", "shd",
];

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
  if (format.underline === true) orderedRunChild(properties, "u").setAttribute("w:val", "single");
  if (typeof format.fontFamily === "string") {
    const family = format.fontFamily.split(",")[0]!.trim().replace(/["']/g, "");
    if (!family) throw new Error("A Word run requires a concrete font family.");
    const fonts = orderedRunChild(properties, "rFonts");
    for (const slot of ["ascii", "hAnsi", "eastAsia", "cs"]) fonts.setAttribute(`w:${slot}`, family);
  }
  if (typeof format.fontSizePoints === "number" && format.fontSizePoints > 0) {
    const halfPoints = String(Math.round(format.fontSizePoints * 2));
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
  writeRunFormat(run, {
    ...(mark("bold") ? { bold: true } : {}),
    ...(mark("italic") ? { italic: true } : {}),
    ...(mark("underline") ? { underline: true } : {}),
    ...(mark("strike") ? { strike: true } : {}),
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
    if (node.type === "text" && node.text) appendTextRun(document, paragraph, node.text, node.marks);
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
) {
  const paragraph = document.addParagraph("", style ? { style } : {});
  const blockId = record(node.attrs).blockId;
  paragraph.element.setAttributeNs(
    W14_NAMESPACE,
    "paraId",
    stableParaId(typeof blockId === "string" ? blockId : crypto.randomUUID()),
  );
  clearParagraph(paragraph.element);
  await appendInlineContent(document, paragraph.element, node.content ?? [], resolver);
  return paragraph;
}

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
      ? { widthPx: Math.round(793 * Math.min(100, widthPercent) / 100) }
      : {}),
  });
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
  paragraph.appendChild(run);
  if (!carrier.elements().length) document.body().removeChild(carrier);
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
  const notes: DocxFidelityNote[] = [];
  for (const node of json.content ?? []) {
    try {
      if (node.type === "table") {
        const rows = node.content ?? [];
        const columns = Math.max(1, ...rows.map((row) => row.content?.length ?? 0));
        const table = document.addTable(Math.max(1, rows.length), columns, { style: "TableGrid" });
        for (const [rowIndex, row] of rows.entries())
          for (const [columnIndex, cell] of (row.content ?? []).entries()) {
            const paragraph = table.cell(rowIndex, columnIndex).paragraphElements()[0];
            if (paragraph) {
              clearParagraph(paragraph);
              await appendInlineContent(
                document,
                paragraph,
                cell.content?.flatMap((child) => child.content ?? [child]) ?? [],
                options.resolveAsset,
              );
            }
          }
        continue;
      }
      if (node.type === "image") {
        await appendImage(document, node, options.resolveAsset);
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
        const items = (node.content ?? []).flatMap((item) => {
          const paragraph = item.content?.find((child) => child.type === "paragraph");
          return paragraph ? [{ text: paragraph.content?.map((child) => child.text ?? "").join("") ?? "", level: 0 }] : [];
        });
        const paragraphs =
          node.type === "bulletList"
            ? document.addBulletList(items)
            : document.addNumberedList(items);
        for (const [index, paragraph] of paragraphs.entries()) {
          clearParagraph(paragraph.element);
          const item = (node.content ?? [])[index];
          const source = item?.content?.find((child) => child.type === "paragraph");
          await appendInlineContent(document, paragraph.element, source?.content ?? [], options.resolveAsset);
        }
        continue;
      }
      if (node.type === "heading") {
        const level = Math.min(3, Math.max(1, Number(record(node.attrs).level) || 2));
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
      if (node.type === "image") throw error;
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
