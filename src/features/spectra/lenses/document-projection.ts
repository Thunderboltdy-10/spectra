import { z } from "zod";
import {
  documentBlocksFromJson as sharedDocumentBlocksFromJson,
  documentContentToProseMirrorJson as sharedDocumentContentToProseMirrorJson,
  documentNodeText as sharedDocumentNodeText,
  documentRichInlineFromJson as sharedDocumentRichInlineFromJson,
  docxNativeMediaUrl as sharedDocxNativeMediaUrl,
  docxRichBlockToJson as sharedDocxRichBlockToJson,
  docxRichInlineToJson as sharedDocxRichInlineToJson,
  authoredSemanticsEqual,
  restoreDocxEquationCarryMetadata,
} from "../../../../shared/document-projection.mjs";
import { equationNodeToLatex, latexToEquation } from "./equation-interchange";
import {
  docxProjectionBlockSchema,
  docxProjectionSchema,
  docxRichInlineSchema,
  docxSemanticDeltaSchema,
  type DocxOperation,
  type DocxProjection,
  type DocxRichInline,
} from "./projection-contracts";
import { isEquationLatexSupported } from "./equation-interchange";

export type DocumentJsonNode = {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
  content?: DocumentJsonNode[];
};

export type DocumentSemanticBlock = {
  id: string;
  type: string;
  text: string;
  rows?: string[][];
  inlineContent?: DocxRichInline[];
  richRows?: DocxRichInline[][][];
  attrs?: Record<string, unknown>;
  latex?: string;
  reference?: Record<string, unknown>;
  citation?: Record<string, unknown>;
};

function canonicalEquationLatex(
  latex: string,
  display: "inline" | "block",
  retainedSource?: string,
  retainedOmml?: string,
) {
  // Retained OMML/source pairs are authoritative for advanced native content.
  // Only canonicalize newly authored or source-changing equations so the route
  // digest matches Word's deterministic OMML readback without flattening a
  // native subtree.
  if (retainedOmml && retainedSource === latex) return latex;
  const interchange = latexToEquation(latex, display);
  return interchange.supported ? equationNodeToLatex(interchange.ast) : latex;
}

function canonicalRichContent(content: readonly DocxRichInline[] | undefined) {
  return content?.map((item) => {
    if (item.kind !== "equation") return item;
    return {
      ...item,
      latex: canonicalEquationLatex(
        item.latex,
        item.display,
        item.ommlSourceLatex,
        item.ommlXml,
      ),
    };
  });
}

export function bindDocxProjectionSource(
  projection: DocxProjection,
  artifactId: string,
  payloadHash: string,
): DocxProjection {
  return docxProjectionSchema.parse({
    ...projection,
    nativeBinding: {
      ...projection.nativeBinding,
      sourceArtifactId: artifactId,
      sourcePayloadHash: payloadHash,
    },
  });
}

export function docxNativeMediaUrl(
  binding: unknown,
  image: Extract<DocxRichInline, { kind: "image" }>,
) {
  return sharedDocxNativeMediaUrl(binding, image) as string;
}

export function docxRichInlineToJson(
  content: readonly DocxRichInline[],
  binding: unknown,
  nativeReadOnly = false,
): DocumentJsonNode[] | undefined {
  return sharedDocxRichInlineToJson(content, binding, nativeReadOnly) as
    DocumentJsonNode[] | undefined;
}

/**
 * Convert only the native rich branches of a semantic block. Returning null
 * leaves the established plain-text projection path untouched.
 */
export function docxRichBlockToJson(
  value: Record<string, unknown>,
  binding: unknown,
): DocumentJsonNode | null {
  const parsed = docxProjectionBlockSchema.safeParse(value);
  if (!parsed.success) return null;
  return sharedDocxRichBlockToJson(
    parsed.data,
    binding,
  ) as DocumentJsonNode | null;
}

export function documentNodeText(node?: DocumentJsonNode): string {
  return sharedDocumentNodeText(node) as string;
}

export function documentRichInlineFromJson(
  node: DocumentJsonNode,
): DocxRichInline[] {
  return (sharedDocumentRichInlineFromJson(node) as unknown[]).flatMap(
    (item) => {
      const parsed = docxRichInlineSchema.safeParse(item);
      return parsed.success ? [parsed.data] : [];
    },
  );
}

/**
 * The single TipTap/ProseMirror -> semantic block transform.
 *
 * Both the React studio and the Yjs adapter call this function. Keeping the
 * table branch here is what prevents a native table from degrading into an
 * ordinary paragraph on one of the two persistence paths.
 */
export function documentBlocksFromJson(
  json: DocumentJsonNode,
): DocumentSemanticBlock[] {
  return sharedDocumentBlocksFromJson(json) as DocumentSemanticBlock[];
}

/**
 * Convex documents have a roughly 1 MiB value ceiling. Native OMML is an
 * exact-package preservation aid, not authored document semantics: the
 * equation's LaTeX is the editable source and the original DOCX remains the
 * carry package. Keep exact OMML only when regenerating it from LaTeX would
 * be unsafe; this keeps large equation-heavy papers openable without making
 * an unsupported equation look editable.
 */
function compactDocxInlineForStorage(item: DocxRichInline): DocxRichInline {
  if (item.kind !== "equation" || !isEquationLatexSupported(item.latex))
    return item;
  const {
    ommlXml: _ommlXml,
    ommlSourceLatex: _ommlSourceLatex,
    ...semanticEquation
  } = item;
  return semanticEquation;
}

function compactDocxBlockForStorage(
  block: DocxProjection["blocks"][number],
) {
  const compact = {
    ...block,
    ...(block.inlineContent
      ? { inlineContent: block.inlineContent.map(compactDocxInlineForStorage) }
      : {}),
    ...(block.richRows
      ? {
          richRows: block.richRows.map((row) =>
            row.map((cell) => cell.map(compactDocxInlineForStorage)),
          ),
        }
      : {}),
  };
  if (compact.type !== "equation") return compact;
  // Equation blocks already carry the same LaTeX in inlineContent. Removing
  // this duplicate is what gives formal, equation-dense papers headroom for
  // the fidelity map and the Convex mutation envelope.
  const { latex: _latex, ...withoutDuplicateLatex } = compact;
  return withoutDuplicateLatex;
}

/** Return a Convex-safe DOCX projection without dropping unsafe native data. */
export function compactDocxProjectionForStorage(
  projection: DocxProjection,
): DocxProjection {
  return docxProjectionSchema.parse({
    ...projection,
    blocks: projection.blocks.map(compactDocxBlockForStorage),
  });
}

/**
 * Imported documents may also carry an editor JSON mirror. That mirror repeats
 * every equation and can exceed the persistence ceiling even when the native
 * projection is compact. Native content reconstructs this mirror on open, so
 * it is deliberately omitted at the native import boundary.
 */
export function compactDocxEditorJsonForStorage(value: unknown): unknown {
  const visit = (current: unknown): unknown => {
    if (Array.isArray(current)) return current.map(visit);
    if (!current || typeof current !== "object") return current;
    const source = current as Record<string, unknown>;
    const next = Object.fromEntries(
      Object.entries(source).map(([key, child]) => [key, visit(child)]),
    ) as Record<string, unknown>;
    const attrs = next.attrs;
    const latex =
      attrs && typeof attrs === "object" && !Array.isArray(attrs)
        ? (attrs as Record<string, unknown>).latex
        : undefined;
    if (
      (next.type === "inlineEquation" || next.type === "equation") &&
      typeof latex === "string" &&
      isEquationLatexSupported(latex) &&
      attrs &&
      typeof attrs === "object" &&
      !Array.isArray(attrs)
    ) {
      const {
        ommlXml: _ommlXml,
        ommlSourceLatex: _ommlSourceLatex,
        ...semanticAttrs
      } = attrs as Record<string, unknown>;
      next.attrs = semanticAttrs;
    }
    return next;
  };
  return visit(value);
}

/** Compact native content while retaining the fields used by editor chrome. */
export function compactDocxContentForStorage(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const source = value as Record<string, unknown>;
  const next = { ...source };
  delete next.tiptap;
  if (Array.isArray(next.blocks))
    next.blocks = next.blocks.map((block) => {
      const parsed = docxProjectionBlockSchema.safeParse(block);
      return parsed.success ? compactDocxBlockForStorage(parsed.data) : block;
    });
  return next;
}

/**
 * Recover native equation carry metadata from the exact projection used as
 * the materialization base. The editor projection may omit OMML to stay under
 * the Convex value ceiling, but it must not invent a subtree from another
 * revision or regenerate one that was untouched.
 */
export function restoreDocxBlockCarryMetadata(
  previous: DocxProjection["blocks"][number],
  incoming: DocxProjection["blocks"][number],
) {
  const inlineContent = incoming.inlineContent
    ? restoreDocxEquationCarryMetadata(previous.inlineContent, incoming.inlineContent)
    : undefined;
  const richRows = incoming.richRows
    ? incoming.richRows.map((row, rowIndex) =>
        row.map((cell, columnIndex) =>
          restoreDocxEquationCarryMetadata(
            previous.richRows?.[rowIndex]?.[columnIndex],
            cell,
          ),
        ),
      )
    : undefined;
  return {
    ...incoming,
    ...(inlineContent ? { inlineContent } : {}),
    ...(richRows ? { richRows } : {}),
  };
}

export function documentContentToProseMirrorJson(
  content: Record<string, unknown>,
): DocumentJsonNode {
  return sharedDocumentContentToProseMirrorJson(content) as DocumentJsonNode;
}

const documentContentSchema = docxProjectionSchema
  .pick({ blocks: true, outline: true, pageSetup: true })
  .partial({ outline: true })
  .extend({
    nativeIntent: docxSemanticDeltaSchema.optional(),
    nativeProjectionComplete: z.literal(true).optional(),
  })
  .passthrough();

function nativeTrailingWhitespaceEquivalent(left: string, right: string) {
  // The editor omits terminal native run whitespace and paragraph separators
  // from its text mirror. Keep the exact native projection when only these
  // ASCII whitespace characters differ; inlineContent still carries authored
  // hard breaks and other meaningful runs.
  return left.replace(/[ \t\r\n]+$/u, "") === right.replace(/[ \t\r\n]+$/u, "");
}

function rowsFor(block: DocxProjection["blocks"][number]) {
  return (
    block.rows ??
    block.text.split(/\r?\n/).map((row) =>
      row
        .replace(/^\s*\|/, "")
        .replace(/\|\s*$/, "")
        .split("|")
        .map((cell) => cell.trim()),
    )
  );
}

function richRowsFor(block: DocxProjection["blocks"][number]) {
  return block.richRows ?? block.rows?.map((row) => row.map((text) => [{ kind: "text" as const, text }])) ?? [];
}

function richTextWithoutImages(content: readonly DocxRichInline[]) {
  return content
    .filter((item) => item.kind !== "image")
    .map((item) => item.kind === "text" || item.kind === "citation" || item.kind === "bibliography" ? item.text : item.kind === "revision" ? item.revisionKind === "ins" ? item.text : "" : item.kind === "equation" ? item.latex : "")
    .join("");
}

function richContentWithoutImages(content: readonly DocxRichInline[]) {
  return content.filter((item) => item.kind !== "image");
}

/**
 * The editor schema can expose only the editable text before a protected Word
 * field or hyperlink. That storage projection is a strict prefix of the native
 * read-only paragraph, not an authored deletion. Keep the native block when
 * the incoming rich content is exactly that prefix; real edits still reach the
 * DOCX read-only safety gate.
 */
function isReadOnlyProjectionPrefix(
  previous: DocxProjection["blocks"][number],
  incoming: DocxProjection["blocks"][number],
) {
  if (
    previous.attrs?.nativeReadOnly !== true ||
    incoming.attrs?.nativeReadOnly !== true ||
    previous.type !== "paragraph" ||
    incoming.type !== previous.type ||
    incoming.text.length > previous.text.length ||
    !previous.text.startsWith(incoming.text)
  )
    return false;

  const originalContent = previous.inlineContent ?? [];
  const projectedContent = incoming.inlineContent ?? [];
  if (
    projectedContent.length >= originalContent.length ||
    !projectedContent.every((item, index) =>
      authoredSemanticsEqual(item, originalContent[index]),
    )
  )
    return false;

  const originalAttrs = previous.attrs ?? {};
  return Object.entries(incoming.attrs ?? {}).every(
    ([key, value]) =>
      key === "nativeReadOnly" ||
      authoredSemanticsEqual(value, originalAttrs[key]),
  );
}

function richContentWithoutImagesOrLayout(content: readonly DocxRichInline[]) {
  return richContentWithoutImages(content).map((item) =>
    item.kind === "equation" ? { ...item, display: "block" as const } : item,
  );
}

function imageOccurrenceSequence(content: readonly DocxRichInline[]) {
  return content
    .filter((item): item is Extract<DocxRichInline, { kind: "image" }> => item.kind === "image")
    .map((item) => item.occurrenceId ?? item.partName ?? item.assetId ?? "");
}

function imageOccurrenceOrderChanged(
  before: readonly DocxRichInline[],
  after: readonly DocxRichInline[],
) {
  const previous = imageOccurrenceSequence(before);
  const next = imageOccurrenceSequence(after);
  // Add/remove/replace operations are handled by imageOperationsBetween. A
  // same-cardinality reorder is the image change that needs a rich rewrite.
  return previous.length === next.length &&
    previous.some((value, index) => value !== next[index]);
}

function authoredRichContentChanged(
  before: readonly DocxRichInline[],
  after: readonly DocxRichInline[],
) {
  return !authoredSemanticsEqual(
    richContentWithoutImagesOrLayout(before),
    richContentWithoutImagesOrLayout(after),
  ) || imageOccurrenceOrderChanged(before, after);
}

function replacePlainRichText(
  content: readonly DocxRichInline[],
  text: string,
): DocxRichInline[] | undefined {
  if (content.some((item) => item.kind !== "text")) return undefined;
  const first = content.find((item) => item.kind === "text");
  if (!first || content.filter((item) => item.kind === "text").length !== 1)
    return undefined;
  return [{ ...first, text }];
}

function imageOperationsBetween(
  regionId: string,
  beforeContent: readonly DocxRichInline[] = [],
  afterContent: readonly DocxRichInline[] = [],
  location?: { row: number; column: number },
): DocxOperation[] {
  const beforeImages = beforeContent.filter(
    (item): item is Extract<DocxRichInline, { kind: "image" }> => item.kind === "image",
  );
  const afterImages = afterContent.filter(
    (item): item is Extract<DocxRichInline, { kind: "image" }> => item.kind === "image",
  );
  const sameOccurrence = (
    left: Extract<DocxRichInline, { kind: "image" }>,
    right: Extract<DocxRichInline, { kind: "image" }>,
  ) =>
    left.occurrenceId && right.occurrenceId
      ? left.occurrenceId === right.occurrenceId
      : left.partName === right.partName;
  const removed = beforeImages.flatMap<DocxOperation>((item) => {
    if (afterImages.some((candidate) => sameOccurrence(item, candidate)) || !item.partName)
      return [];
    return [{
      kind: "delete-image" as const,
      regionId,
      partName: item.partName,
      ...(item.occurrenceId ? { occurrenceId: item.occurrenceId } : {}),
    }];
  });
  const changed = afterImages.flatMap<DocxOperation>((item): DocxOperation[] => {
    if (item.kind !== "image") return [];
    const previous = beforeImages.find((candidate) => sameOccurrence(candidate, item));
    if (!previous && item.assetId)
      return [{
        kind: "insert-image",
        regionId,
        ...(location ?? {}),
        assetId: item.assetId,
        mediaType: item.mediaType,
        ...(item.altText !== undefined ? { altText: item.altText } : {}),
        ...(item.widthEmu !== undefined ? { widthEmu: item.widthEmu } : {}),
        ...(item.heightEmu !== undefined ? { heightEmu: item.heightEmu } : {}),
        ...(item.crop !== undefined ? { crop: item.crop } : {}),
      }];
    if (!previous && item.partName)
      return [{
        kind: "insert-image",
        regionId,
        ...(location ?? {}),
        partName: item.partName,
        ...(item.occurrenceId ? { occurrenceId: item.occurrenceId } : {}),
        mediaType: item.mediaType,
        ...(item.altText !== undefined ? { altText: item.altText } : {}),
        ...(item.widthEmu !== undefined ? { widthEmu: item.widthEmu } : {}),
        ...(item.heightEmu !== undefined ? { heightEmu: item.heightEmu } : {}),
        ...(item.crop !== undefined ? { crop: item.crop } : {}),
      }];
    if (!previous || !item.partName) return [];
    if (item.assetId && item.assetId !== previous.assetId)
      return [{
        kind: "replace-image",
        regionId,
        partName: item.partName,
        ...(item.occurrenceId ? { occurrenceId: item.occurrenceId } : {}),
        assetId: item.assetId,
        mediaType: item.mediaType,
        ...(item.altText !== undefined ? { altText: item.altText } : {}),
        ...(item.widthEmu !== undefined ? { widthEmu: item.widthEmu } : {}),
        ...(item.heightEmu !== undefined ? { heightEmu: item.heightEmu } : {}),
        ...(item.crop !== undefined ? { crop: item.crop } : {}),
      }];
    const operation: Extract<DocxOperation, { kind: "update-image" }> = {
      kind: "update-image",
      regionId,
      partName: item.partName,
      ...(item.occurrenceId ? { occurrenceId: item.occurrenceId } : {}),
      ...(item.altText !== previous.altText ? { altText: item.altText } : {}),
      ...(item.widthEmu !== previous.widthEmu ? { widthEmu: item.widthEmu } : {}),
      ...(item.heightEmu !== previous.heightEmu ? { heightEmu: item.heightEmu } : {}),
      ...(JSON.stringify(item.crop) !== JSON.stringify(previous.crop)
        ? { crop: item.crop ?? {} }
        : {}),
    };
    return operation.altText !== undefined ||
      operation.widthEmu !== undefined ||
      operation.heightEmu !== undefined ||
      operation.crop !== undefined
      ? [operation]
      : [];
  });
  return [...removed, ...changed];
}

function inlineContentForTextOperation(
  beforeContent: readonly DocxRichInline[],
  afterContent: readonly DocxRichInline[],
) {
  const retainedParts = new Set(
    beforeContent.flatMap((item) =>
      item.kind === "image" && item.partName ? [item.partName] : [],
    ),
  );
  return afterContent.filter(
    (item) => item.kind !== "image" || (item.partName && retainedParts.has(item.partName)),
  );
}

function equationLayoutBetween(
  regionId: string,
  before: DocxProjection["blocks"][number],
  after: DocxProjection["blocks"][number],
): DocxOperation[] {
  const beforeEquation = (before.inlineContent ?? []).find((item) => item.kind === "equation");
  const afterEquation = (after.inlineContent ?? []).find((item) => item.kind === "equation");
  if (!beforeEquation || !afterEquation) return [];
  const beforeDisplay = before.attrs?.display === "inline" || beforeEquation.display === "inline" ? "inline" : "block";
  const afterDisplay = after.attrs?.display === "inline" || afterEquation.display === "inline" ? "inline" : "block";
  const beforeAlignment = before.attrs?.alignment === "left" || before.attrs?.alignment === "right" || before.attrs?.alignment === "center"
    ? before.attrs.alignment
    : "center";
  const afterAlignment = after.attrs?.alignment === "left" || after.attrs?.alignment === "right" || after.attrs?.alignment === "center"
    ? after.attrs.alignment
    : "center";
  if (beforeDisplay === afterDisplay && beforeAlignment === afterAlignment) return [];
  return [{
    kind: "set-equation-layout",
    regionId,
    ...(beforeDisplay !== afterDisplay ? { display: afterDisplay } : {}),
    ...(beforeAlignment !== afterAlignment ? { alignment: afterAlignment } : {}),
  }];
}

export function docxOperationsBetween(
  before: DocxProjection,
  after: DocxProjection,
): DocxOperation[] {
  const previous = new Map(before.blocks.map((block) => [block.id, block]));
  const operations: DocxOperation[] = [];
  const beforePage = before.pageSetup ?? {};
  const afterPage = after.pageSetup ?? {};
  const pagePatch = Object.fromEntries(
    (["size", "orientation", "margins", "columns"] as const).flatMap((field) =>
      JSON.stringify(beforePage[field]) === JSON.stringify(afterPage[field])
        ? []
        : [[field, afterPage[field]]],
    ),
  );
  if (Object.keys(pagePatch).length)
    operations.push({
      kind: "update-section",
      ...(afterPage.sectionIndex !== undefined ? { sectionIndex: afterPage.sectionIndex } : {}),
      ...pagePatch,
    } as DocxOperation);
  for (const slot of ["header", "footer"] as const)
    if (beforePage[slot] !== afterPage[slot])
      operations.push({
        kind: "update-header-footer",
        ...(afterPage.sectionIndex !== undefined ? { sectionIndex: afterPage.sectionIndex } : {}),
        slot,
        text: afterPage[slot] ?? "",
      });
  after.blocks.forEach((block, index) => {
    const old = previous.get(block.id);
    previous.delete(block.id);
    if (!old) {
      if (block.type !== "table")
        operations.push({
          kind: "insert-paragraph",
          regionId: block.id,
          afterRegionId: index ? after.blocks[index - 1]!.id : null,
          text: block.text,
          ...(block.inlineContent ? { inlineContent: block.inlineContent } : {}),
          ...(typeof block.attrs?.styleId === "string"
            ? { style: block.attrs.styleId }
            : {}),
        });
      return;
    }
    if (block.type === "table" && old.type === "table") {
      const oldRows = rowsFor(old);
      const newRows = rowsFor(block);
      if (newRows.length > oldRows.length)
        for (let row = oldRows.length; row < newRows.length; row += 1)
          operations.push({ kind: "insert-table-row", regionId: block.id, row });
      if (newRows.length < oldRows.length)
        for (let row = oldRows.length - 1; row >= newRows.length; row -= 1)
          operations.push({ kind: "delete-table-row", regionId: block.id, row });
      const oldColumns = Math.max(0, ...oldRows.map((row) => row.length));
      const newColumns = Math.max(0, ...newRows.map((row) => row.length));
      if (newColumns > oldColumns)
        for (let column = oldColumns; column < newColumns; column += 1)
          operations.push({ kind: "insert-table-column", regionId: block.id, column });
      if (newColumns < oldColumns)
        for (let column = oldColumns - 1; column >= newColumns; column -= 1)
          operations.push({ kind: "delete-table-column", regionId: block.id, column });
      const oldRichRows = richRowsFor(old);
      const newRichRows = richRowsFor(block);
      newRows.forEach((row, rowIndex) =>
        row.forEach((text, columnIndex) => {
          const inlineContent = newRichRows[rowIndex]?.[columnIndex];
          const previousInline = oldRichRows[rowIndex]?.[columnIndex];
          const imageOperations = imageOperationsBetween(
            block.id,
            previousInline,
            inlineContent,
            { row: rowIndex, column: columnIndex },
          );
          const deletedImages = imageOperations.filter((operation) => operation.kind === "delete-image");
          const otherImageOperations = imageOperations.filter((operation) => operation.kind !== "delete-image");
          const visibleText = inlineContent
            ? richTextWithoutImages(inlineContent)
            : text;
          const previousVisibleText = previousInline
            ? richTextWithoutImages(previousInline)
            : oldRows[rowIndex]?.[columnIndex] ?? "";
          const nonImageRichChanged = authoredRichContentChanged(
            previousInline,
            inlineContent ?? [],
          );
          operations.push(...deletedImages);
          if (visibleText !== previousVisibleText || nonImageRichChanged) {
            const textInlineContent = inlineContent
              ? inlineContentForTextOperation(previousInline, inlineContent)
              : undefined;
            operations.push({
              kind: "edit-table-cell",
              regionId: block.id,
              row: rowIndex,
              column: columnIndex,
              text,
              ...(textInlineContent ? { inlineContent: textInlineContent } : {}),
            });
          }
          // Apply text before adding/replacing drawings so the text rewrite
          // never clears a drawing operation that is about to run.
          operations.push(...otherImageOperations);
        }),
      );
    } else if (
      block.type !== "table" &&
      (block.text !== old.text ||
        authoredRichContentChanged(old.inlineContent ?? [], block.inlineContent ?? []) ||
        imageOperationsBetween(block.id, old.inlineContent ?? [], block.inlineContent ?? []).length > 0 ||
        block.attrs?.display !== old.attrs?.display ||
        block.attrs?.alignment !== old.attrs?.alignment)
    ) {
      const previousInline = old.inlineContent ?? [];
      const nextInline = block.inlineContent ?? [];
      const imageOperations = imageOperationsBetween(block.id, previousInline, nextInline);
      const deletedImages = imageOperations.filter((operation) => operation.kind === "delete-image");
      const otherImageOperations = imageOperations.filter((operation) => operation.kind !== "delete-image");
      const layoutOperations = equationLayoutBetween(block.id, old, block);
      const hasImages = previousInline.some((item) => item.kind === "image") ||
        nextInline.some((item) => item.kind === "image");
      const visibleText = hasImages ? richTextWithoutImages(nextInline) : block.text;
      const previousVisibleText = hasImages ? richTextWithoutImages(previousInline) : old.text;
      const nonImageRichChanged = authoredRichContentChanged(
        previousInline,
        nextInline,
      );
      const richChanged = nonImageRichChanged;
      if (visibleText === previousVisibleText && !richChanged) {
        operations.push(...deletedImages, ...otherImageOperations, ...layoutOperations);
        return;
      }
      const textInlineContent = block.inlineContent
        ? inlineContentForTextOperation(previousInline, nextInline)
        : undefined;
      const inlineContentChanged = JSON.stringify(previousInline) !== JSON.stringify(nextInline);
      operations.push(...deletedImages, {
        kind: "replace-paragraph",
        regionId: block.id,
        text: block.text,
        ...(inlineContentChanged && textInlineContent ? { inlineContent: textInlineContent } : {}),
      }, ...otherImageOperations, ...layoutOperations);
      // Apply retained text before adding/replacing drawings so the text rewrite
      // never clears a surviving picture operation that follows it.
    }
  });
  operations.push(
    ...[...previous.keys()].map((regionId) => ({
      kind: "delete-region" as const,
      regionId,
    })),
  );
  const priorOrder = before.blocks.map((block) => block.id);
  const order = after.blocks.map((block) => block.id);
  const priorIds = new Set(priorOrder);
  const afterIds = new Set(order);
  const retainedBefore = priorOrder.filter((regionId) => afterIds.has(regionId));
  const retainedAfter = order.filter((regionId) => priorIds.has(regionId));
  if (
    retainedAfter.some((regionId, index) => regionId !== retainedBefore[index])
  )
    operations.push({ kind: "reorder-regions", order });
  return operations;
}

export function docxIntentFromDocumentBlocks(
  before: unknown,
  after: readonly DocumentSemanticBlock[],
) {
  if (!before || typeof before !== "object" || Array.isArray(before))
    return undefined;
  const source = before as Record<string, unknown>;
  const binding = docxProjectionSchema.shape.nativeBinding.safeParse(
    source.nativeBinding,
  );
  if (!binding.success) return undefined;
  const oldBlocks = Array.isArray(source.blocks)
    ? source.blocks.flatMap((block) => {
        const parsed = docxProjectionBlockSchema.safeParse(block);
        return parsed.success ? [parsed.data] : [];
      })
    : [];
  const newBlocks = after.flatMap((block) => {
    const parsed = docxProjectionBlockSchema.safeParse(block);
    return parsed.success ? [parsed.data] : [];
  });
  return {
    kind: "ai-edit" as const,
    operations: docxOperationsBetween(
      { blocks: oldBlocks, outline: [], nativeBinding: binding.data },
      { blocks: newBlocks, outline: [], nativeBinding: binding.data },
    ),
  };
}

/** The one document editor-model -> DOCX projection transform. */
export function docxProjectionFromContent(
  value: unknown,
  base: DocxProjection,
) {
  // A linked file can be opened before its semantic projection has ever been
  // activated. Convex legitimately carries `null` in that state; the native
  // projection we just read is the only safe starting point.
  if (value == null) return { projection: base, operations: [] };
  const parsed = documentContentSchema.parse(value);
  const baseById = new Map(base.blocks.map((block) => [block.id, block]));
  const mergeBlock = (incoming: DocxProjection["blocks"][number]) => {
    const previous = baseById.get(incoming.id);
    if (previous && isReadOnlyProjectionPrefix(previous, incoming))
      return previous;
    const recovered = previous
      ? restoreDocxBlockCarryMetadata(previous, incoming)
      : incoming;
    const inlineContent = canonicalRichContent(recovered.inlineContent);
    const blockEquation = inlineContent?.find((item) => item.kind === "equation");
    // ProseMirror does not retain Word's invisible trailing run whitespace in
    // its DOM/Yjs projection. Treating that normalization as authored content
    // made an otherwise safe edit also emit replacements for protected native
    // paragraphs. Retain the exact Word text when only its trailing whitespace
    // differs; a material edit (including one in a read-only region) still
    // flows through to the lens and is rejected by its native safety gate.
    const text =
      recovered.type === "equation" && blockEquation
        ? blockEquation.latex
        :
      previous &&
      nativeTrailingWhitespaceEquivalent(previous.text, incoming.text)
        ? previous.text
        : incoming.text;
    const normalizedInlineContent =
      previous &&
      recovered.inlineContent &&
      previous.inlineContent &&
      recovered.text !== previous.text &&
      richTextWithoutImages(recovered.inlineContent) === previous.text
        ? replacePlainRichText(recovered.inlineContent, recovered.text)
        : undefined;
    const normalizedRichRows =
      recovered.type === "table" &&
      recovered.rows &&
      !recovered.richRows
        ? recovered.rows.map((row) =>
            row.map((cell) => [{ kind: "text" as const, text: cell }]),
          )
        : undefined;
    return docxProjectionBlockSchema.parse({
      ...(previous ?? {}),
      ...recovered,
      text,
      ...(recovered.type === "equation" && blockEquation
        ? { latex: blockEquation.latex }
        : {}),
      ...(inlineContent ? { inlineContent } : {}),
      ...(normalizedInlineContent ? { inlineContent: normalizedInlineContent } : {}),
      ...(recovered.richRows
        ? {
            richRows: recovered.richRows.map((row) =>
              row.map((cell) => canonicalRichContent(cell) ?? []),
            ),
          }
        : normalizedRichRows
          ? { richRows: normalizedRichRows }
          : {}),
      ...(previous?.attrs || incoming.attrs
        ? {
            attrs: {
              ...(previous?.attrs ?? {}),
              ...(incoming.attrs ?? {}),
            },
          }
        : {}),
    });
  };
  const blocks = parsed.nativeProjectionComplete
    ? parsed.blocks.map(mergeBlock)
    : (() => {
        const incomingById = new Map(
          parsed.blocks.map((block) => [block.id, block]),
        );
        const baseIds = new Set(base.blocks.map((block) => block.id));
        return [
          ...base.blocks.map((block) =>
            incomingById.has(block.id)
              ? mergeBlock(incomingById.get(block.id)!)
              : block,
          ),
          ...parsed.blocks
            .filter((block) => !baseIds.has(block.id))
            .map(mergeBlock),
        ];
      })();
  const projection = docxProjectionSchema.parse({
    blocks,
    outline: parsed.outline ?? base.outline,
    ...(parsed.pageSetup ? { pageSetup: parsed.pageSetup } : base.pageSetup ? { pageSetup: base.pageSetup } : {}),
    nativeBinding: base.nativeBinding,
  });
  const inferredOperations = docxOperationsBetween(base, projection);
  const explicitOperations = parsed.nativeIntent
    ? parsed.nativeIntent.kind === "ai-edit"
      ? parsed.nativeIntent.operations
      : [parsed.nativeIntent]
    : undefined;
  return {
    projection,
    // The editor's native intent predates page/header/footer operations and
    // may therefore omit those changes. Keep explicit block operations, then
    // add the inferred chrome/section operations exactly once.
    operations: explicitOperations
      ? [
          ...explicitOperations,
          ...inferredOperations.filter((operation) =>
            operation.kind === "update-section" || operation.kind === "update-header-footer",
          ),
        ]
      : inferredOperations,
  };
}
