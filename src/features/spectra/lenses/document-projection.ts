import { z } from "zod";
import {
  docxProjectionBlockSchema,
  docxProjectionSchema,
  docxSemanticDeltaSchema,
  type DocxOperation,
  type DocxProjection,
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
  attrs?: Record<string, unknown>;
  latex?: string;
  reference?: Record<string, unknown>;
  citation?: Record<string, unknown>;
};

export function documentNodeText(node?: DocumentJsonNode): string {
  if (!node) return "";
  if (typeof node.text === "string") return node.text;
  const separator = node.type === "listItem" ? "" : "\n";
  return (node.content ?? []).map(documentNodeText).join(separator);
}

function tableRows(node: DocumentJsonNode) {
  return (node.content ?? []).map((row) =>
    (row.content ?? []).map((cell) => documentNodeText(cell).trim()),
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
  const seen = new Set<string>();
  return (json.content ?? [])
    .map((node, index): DocumentSemanticBlock => {
      let id =
        typeof node.attrs?.blockId === "string" && node.attrs.blockId
          ? node.attrs.blockId
          : `block-${index + 1}`;
      if (seen.has(id)) {
        const base = id;
        let suffix = 2;
        while (seen.has(`${base}~${suffix}`)) suffix += 1;
        id = `${base}~${suffix}`;
      }
      seen.add(id);

      if (node.type === "table") {
        const rows = tableRows(node);
        return {
          id,
          type: "table",
          text: rows.map((row) => row.join(" | ")).join("\n"),
          rows,
          ...(node.attrs?.nativeReadOnly === true
            ? { attrs: { nativeReadOnly: true } }
            : {}),
        };
      }

      const text = documentNodeText(node).trimEnd();
      if (node.type === "heading") {
        const level = Number(node.attrs?.level) || 2;
        return {
          id,
          type: "heading",
          text,
          attrs: {
            level,
            styleId: `Heading${level}`,
            ...(node.attrs?.nativeReadOnly === true
              ? { nativeReadOnly: true }
              : {}),
          },
        };
      }
      if (node.type === "blockquote") return { id, type: "quote", text };
      if (node.type === "bulletList" || node.type === "orderedList")
        return { id, type: "list", text };
      if (node.type === "callout")
        return {
          id,
          type: "callout",
          text,
          attrs: { tone: node.attrs?.type ?? node.attrs?.tone ?? "info" },
        };
      if (node.type === "equation") {
        const latex = String(node.attrs?.latex ?? "");
        return {
          id,
          type: "equation",
          text: latex,
          latex,
          attrs: {
            display: node.attrs?.display ?? "block",
            alignment: node.attrs?.alignment ?? "center",
          },
        };
      }
      if (node.type === "codeBlock")
        return {
          id,
          type: "code",
          text,
          attrs: { language: node.attrs?.language ?? undefined },
        };
      if (node.type === "spectraReference")
        return {
          id,
          type: "paragraph",
          text: String(node.attrs?.label ?? "Referenced work"),
          reference: node.attrs,
        };
      if (node.type === "spectraCitation")
        return {
          id,
          type: "paragraph",
          text: String(node.attrs?.label ?? "Citation"),
          citation: node.attrs,
        };
      return {
        id,
        type: "paragraph",
        text,
        ...(node.attrs?.nativeReadOnly === true
          ? { attrs: { nativeReadOnly: true } }
          : {}),
      };
    });
}

const documentContentSchema = docxProjectionSchema
  .pick({ blocks: true, outline: true })
  .partial({ outline: true })
  .extend({
    nativeIntent: docxSemanticDeltaSchema.optional(),
    nativeProjectionComplete: z.literal(true).optional(),
  })
  .passthrough();

function rowsFor(block: DocxProjection["blocks"][number]) {
  return block.rows ?? block.text.split(/\r?\n/).map((row) =>
    row
      .replace(/^\s*\|/, "")
      .replace(/\|\s*$/, "")
      .split("|")
      .map((cell) => cell.trim()),
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
  if (!before || typeof before !== "object" || Array.isArray(before)) return undefined;
  const source = before as Record<string, unknown>;
  const binding = docxProjectionSchema.shape.nativeBinding.safeParse(source.nativeBinding);
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
    return docxProjectionBlockSchema.parse({
      ...(previous ?? {}),
      ...incoming,
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
