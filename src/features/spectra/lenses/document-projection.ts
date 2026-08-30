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
  .pick({ blocks: true, outline: true })
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

export function docxOperationsBetween(
  before: DocxProjection,
  after: DocxProjection,
): DocxOperation[] {
  const previous = new Map(before.blocks.map((block) => [block.id, block]));
  const operations: DocxOperation[] = [];
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
          ...(typeof block.attrs?.styleId === "string"
            ? { style: block.attrs.styleId }
            : {}),
        });
      return;
    }
    if (block.type === "table" && old.type === "table") {
      const oldRows = rowsFor(old);
      const newRows = rowsFor(block);
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
    } else if (block.type !== "table" && block.text !== old.text) {
      operations.push({
        kind: "replace-paragraph",
        regionId: block.id,
        text: block.text,
      });
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
    // ProseMirror does not retain Word's invisible trailing run whitespace in
    // its DOM/Yjs projection. Treating that normalization as authored content
    // made an otherwise safe edit also emit replacements for protected native
    // paragraphs. Retain the exact Word text when only its trailing whitespace
    // differs; a material edit (including one in a read-only region) still
    // flows through to the lens and is rejected by its native safety gate.
    const text =
      previous &&
      nativeTrailingWhitespaceEquivalent(previous.text, incoming.text)
        ? previous.text
        : incoming.text;
    return docxProjectionBlockSchema.parse({
      ...(previous ?? {}),
      ...incoming,
      text,
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
    nativeBinding: base.nativeBinding,
  });
  return {
    projection,
    operations:
      parsed.nativeIntent?.kind === "ai-edit"
        ? parsed.nativeIntent.operations
        : parsed.nativeIntent
          ? [parsed.nativeIntent]
          : docxOperationsBetween(base, projection),
  };
}
