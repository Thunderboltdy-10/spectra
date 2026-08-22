import { Document, Paragraph, WML_NAMESPACE } from "@ariadng/office/docx";
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

const W14_NAMESPACE =
  "http://schemas.microsoft.com/office/word/2010/wordml";

export type DocxProjectionBlock = {
  id: string;
  type: "paragraph" | "heading" | "list" | "table";
  text: string;
  attrs?: Record<string, unknown>;
};

export type DocxNativePlaceholder = {
  id: string;
  label: string;
  detail: string;
  feature: string;
};

export type DocxProjection = {
  blocks: DocxProjectionBlock[];
  outline: Array<{ id: string; title: string; level: number }>;
  nativeBinding: {
    version: 1;
    format: "docx" | "docm" | "dotx" | "dotm";
    profile: LensCompatibilityProfile;
    macroEnabled: boolean;
    semanticDigest: string;
    nativePlaceholders: DocxNativePlaceholder[];
  };
};

export type DocxSemanticDelta =
  | {
      kind: "replace-paragraph";
      regionId: string;
      text: string;
    }
  | {
      kind: "edit-table-cell";
      regionId: string;
      row: number;
      column: number;
      text: string;
    }
  | {
      kind: "insert-paragraph";
      text: string;
      style?: string;
    }
  | {
      kind: "apply-style";
      regionId: string;
      style: string;
    }
  | {
      kind: "ai-edit";
      operations: Exclude<DocxSemanticDelta, { kind: "ai-edit" }>[];
    };

export class DocxLensError extends Error {
  constructor(
    public readonly code:
      | "DOCX_PASSWORD_PROTECTED"
      | "DOCX_CORRUPT"
      | "DOCX_REGION_READ_ONLY"
      | "DOCX_UNSUPPORTED_EDIT",
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

function paragraphRegionId(paragraph: Paragraph, index: number) {
  const nativeId = paragraph.element.getAttributeNs(W14_NAMESPACE, "paraId");
  return nativeId
    ? `docx:paragraph:${nativeId.toLowerCase()}`
    : `docx:paragraph:${index}`;
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

function replaceParagraphText(document: Document, paragraph: Paragraph, text: string) {
  const runs = paragraph.runs();
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

function tableText(rows: readonly { cells(): readonly { text(): string }[] }[]) {
  return rows
    .map((row) => row.cells().map((cell) => cell.text()).join(" | "))
    .join("\n");
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
  const label = labels[entry.feature];
  return label
    ? {
        id: entry.regionId,
        feature: entry.feature,
        label,
        detail: `${label} is kept safe in the original Word package.`,
      }
    : null;
}

async function projectDocument(
  document: Document,
  profile: LensCompatibilityProfile,
) {
  const fidelityEntries: LensFidelityEntry[] = [];
  const blocks: DocxProjectionBlock[] = [];
  const bodyChildren = document.body().elements();
  const topLevelTables = document.tables().filter((table) => table.depth === 0);
  let paragraphIndex = 0;
  let tableIndex = 0;

  for (const element of bodyChildren) {
    if (
      element.namespaceUri() === WML_NAMESPACE &&
      element.localName === "p"
    ) {
      const paragraph = Paragraph._wrap(document, element);
      const regionId = paragraphRegionId(paragraph, paragraphIndex);
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
      blocks.push({
        id: regionId,
        type: list
          ? "list"
          : /^heading[1-3]$/i.test(semanticStyleId ?? "")
            ? "heading"
            : "paragraph",
        text: paragraph.text(),
        attrs: {
          paragraphIndex,
          ...(semanticStyleId ? { styleId: semanticStyleId } : {}),
          ...(list ? { list } : {}),
          ...(readOnly ? { nativeReadOnly: true } : {}),
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
      paragraphIndex += 1;
      continue;
    }
    if (
      element.namespaceUri() === WML_NAMESPACE &&
      element.localName === "tbl"
    ) {
      const table = topLevelTables[tableIndex];
      if (table) {
        const regionId = `docx:table:${tableIndex}`;
        const nested = document.tables().some((candidate) => candidate.depth > 0);
        blocks.push({
          id: regionId,
          type: "table",
          text: tableText(table.rows()),
          attrs: {
            tableIndex,
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
      tableIndex += 1;
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
      JSON.stringify(blocks.map(({ id, type, text }) => ({ id, type, text }))),
    ),
  );
  const projection: DocxProjection = {
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
  };
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

function resolveParagraphIndex(
  projection: DocxProjection,
  block: DocxProjectionBlock,
  paragraphCount: number,
) {
  const declared = Number(block.attrs?.paragraphIndex);
  if (Number.isInteger(declared) && declared >= 0 && declared < paragraphCount)
    return declared;
  const blockIndex = projection.blocks.findIndex((candidate) => candidate.id === block.id);
  if (blockIndex < 0) return -1;
  return projection.blocks
    .slice(0, blockIndex)
    .filter((candidate) => candidate.type !== "table").length;
}

async function applyDelta(
  carry: LensPreservedCarry<DocxProjection>,
  delta: DocxSemanticDelta,
) {
  const document = await Document.open(carry.payload);
  const opened = await projectDocument(document, carry.profile);
  // Projection indexes only top-level body paragraphs. The generic
  // document.paragraphs() collection also includes paragraphs inside table
  // cells, so using it here shifts every paragraph after the first table and
  // can make a valid AI or human edit target the wrong native region.
  const paragraphs = document
    .body()
    .elements()
    .filter(
      (element) =>
        element.namespaceUri() === WML_NAMESPACE && element.localName === "p",
    )
    .map((element) => Paragraph._wrap(document, element));
  const tables = document.tables().filter((table) => table.depth === 0);
  const operations =
    delta.kind === "ai-edit" ? delta.operations : [delta];

  for (const operation of operations) {
    if (operation.kind === "insert-paragraph") {
      document.addParagraph(operation.text, {
        ...(operation.style ? { style: safeStyleId(operation.style) } : {}),
      });
      continue;
    }
    assertEditable(opened.fidelityMap, operation.regionId);
    const block = opened.projection.blocks.find(
      (candidate) => candidate.id === operation.regionId,
    );
    if (!block)
      throw new DocxLensError(
        "DOCX_UNSUPPORTED_EDIT",
        `The Word region ${operation.regionId} no longer exists.`,
      );
    if (operation.kind === "replace-paragraph") {
      const index = resolveParagraphIndex(opened.projection, block, paragraphs.length);
      const paragraph = paragraphs[index];
      if (!paragraph)
        throw new DocxLensError(
          "DOCX_UNSUPPORTED_EDIT",
          `The target Word paragraph could not be resolved safely (region=${operation.regionId}, index=${index}, projectedParagraphs=${paragraphs.length}).`,
        );
      replaceParagraphText(document, paragraph, operation.text);
    } else if (operation.kind === "apply-style") {
      const index = resolveParagraphIndex(opened.projection, block, paragraphs.length);
      const paragraph = paragraphs[index];
      if (!paragraph)
        throw new DocxLensError(
          "DOCX_UNSUPPORTED_EDIT",
          `The target Word paragraph could not be resolved safely (style region=${operation.regionId}, index=${index}, projectedParagraphs=${paragraphs.length}).`,
        );
      setParagraphStyle(document, paragraph, operation.style);
    } else if (operation.kind === "edit-table-cell") {
      const index = Number(block.attrs?.tableIndex);
      const table = tables[index];
      if (!table)
        throw new DocxLensError(
          "DOCX_UNSUPPORTED_EDIT",
          "The target Word table could not be resolved safely.",
        );
      table.cell(operation.row, operation.column).setText(operation.text);
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
    for (const block of projection.blocks) {
      const previous = before.get(block.id);
      if (!previous) {
        if (block.type === "table")
          throw new DocxLensError(
            "DOCX_UNSUPPORTED_EDIT",
            "Adding a new table to a mounted Word file is unavailable in strict native mode.",
          );
        operations.push({
          kind: "insert-paragraph",
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
      if (effectiveBlock.type === "table" && effectiveBlock.text !== previous.text) {
        const oldRows = parseTableText(previous.text);
        const newRows = parseTableText(effectiveBlock.text);
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
    }
    if (before.size)
      throw new DocxLensError(
        "DOCX_UNSUPPORTED_EDIT",
        "Deleting native Word regions is unavailable until the lens can prove the surrounding revision structure remains valid.",
      );
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
      else if (previous.text !== block.text)
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
      ],
    };
  },
};
