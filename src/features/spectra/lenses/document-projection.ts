import { z } from "zod";
import {
  documentBlocksFromJson as sharedDocumentBlocksFromJson,
  documentContentToProseMirrorJson as sharedDocumentContentToProseMirrorJson,
  documentNodeText as sharedDocumentNodeText,
  documentRichInlineFromJson as sharedDocumentRichInlineFromJson,
  docxNativeMediaUrl as sharedDocxNativeMediaUrl,
  docxRichBlockToJson as sharedDocxRichBlockToJson,
  docxRichInlineToJson as sharedDocxRichInlineToJson,
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
  return left.trimEnd() === right.trimEnd();
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
    .map((item) => (item.kind === "text" ? item.text : item.latex))
    .join("");
}

function richContentWithoutImages(content: readonly DocxRichInline[]) {
  return content.filter((item) => item.kind !== "image");
}

function richContentWithoutImagesOrLayout(content: readonly DocxRichInline[]) {
  return richContentWithoutImages(content).map((item) =>
    item.kind === "equation" ? { ...item, display: "block" as const } : item,
  );
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
          const nonImageRichChanged =
              JSON.stringify(
                inlineContent ? richContentWithoutImagesOrLayout(inlineContent) : inlineContent,
              ) !==
              JSON.stringify(
                previousInline
                  ? richContentWithoutImagesOrLayout(previousInline)
                  : previousInline,
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
        JSON.stringify(block.inlineContent) !== JSON.stringify(old.inlineContent) ||
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
      const nonImageRichChanged = hasImages
        ? JSON.stringify(richContentWithoutImagesOrLayout(nextInline)) !==
            JSON.stringify(richContentWithoutImagesOrLayout(previousInline))
        : JSON.stringify(block.inlineContent) !== JSON.stringify(old.inlineContent);
      const richChanged = nonImageRichChanged;
      if (visibleText === previousVisibleText && !richChanged) {
        operations.push(...deletedImages, ...otherImageOperations, ...layoutOperations);
        return;
      }
      const textInlineContent = block.inlineContent
        ? inlineContentForTextOperation(previousInline, nextInline)
        : undefined;
      operations.push(...deletedImages, {
        kind: "replace-paragraph",
        regionId: block.id,
        text: block.text,
        ...(richChanged && textInlineContent ? { inlineContent: textInlineContent } : {}),
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
  if (
    order.length !== priorOrder.length ||
    order.some((regionId, index) => regionId !== priorOrder[index])
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
    const inlineContent = canonicalRichContent(incoming.inlineContent);
    const blockEquation = inlineContent?.find((item) => item.kind === "equation");
    // ProseMirror does not retain Word's invisible trailing run whitespace in
    // its DOM/Yjs projection. Treating that normalization as authored content
    // made an otherwise safe edit also emit replacements for protected native
    // paragraphs. Retain the exact Word text when only its trailing whitespace
    // differs; a material edit (including one in a read-only region) still
    // flows through to the lens and is rejected by its native safety gate.
    const text =
      incoming.type === "equation" && blockEquation
        ? blockEquation.latex
        :
      previous &&
      nativeTrailingWhitespaceEquivalent(previous.text, incoming.text)
        ? previous.text
        : incoming.text;
    const normalizedInlineContent =
      previous &&
      incoming.inlineContent &&
      previous.inlineContent &&
      incoming.text !== previous.text &&
      richTextWithoutImages(incoming.inlineContent) === previous.text
        ? replacePlainRichText(incoming.inlineContent, incoming.text)
        : undefined;
    const normalizedRichRows =
      incoming.type === "table" &&
      incoming.rows &&
      !incoming.richRows
        ? incoming.rows.map((row) =>
            row.map((cell) => [{ kind: "text" as const, text: cell }]),
          )
        : undefined;
    return docxProjectionBlockSchema.parse({
      ...(previous ?? {}),
      ...incoming,
      text,
      ...(incoming.type === "equation" && blockEquation
        ? { latex: blockEquation.latex }
        : {}),
      ...(inlineContent ? { inlineContent } : {}),
      ...(normalizedInlineContent ? { inlineContent: normalizedInlineContent } : {}),
      ...(normalizedRichRows ? { richRows: normalizedRichRows } : {}),
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
