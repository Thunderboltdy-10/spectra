import { z } from "zod";
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

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function richInlineText(content: readonly DocxRichInline[]) {
  return content
    .map((item) => {
      if (item.kind === "text") return item.text;
      if (item.kind === "equation") return item.latex;
      return item.altText;
    })
    .join("");
}

function richInlineHasObject(content: readonly DocxRichInline[]) {
  return content.some((item) => item.kind !== "text");
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
  const source = record(binding);
  const artifactId =
    typeof source.sourceArtifactId === "string"
      ? source.sourceArtifactId
      : "";
  const payloadHash =
    typeof source.sourcePayloadHash === "string"
      ? source.sourcePayloadHash
      : "";
  if (!artifactId || !/^[a-f0-9]{64}$/.test(payloadHash)) return "";
  const query = new URLSearchParams({
    artifactId,
    payloadHash,
    partName: image.partName,
  });
  return `/api/spectra/lenses/docx/media?${query.toString()}`;
}

export function docxRichInlineToJson(
  content: readonly DocxRichInline[],
  binding: unknown,
  nativeReadOnly = false,
): DocumentJsonNode[] | undefined {
  const nodes = content.flatMap((item): DocumentJsonNode[] => {
    if (item.kind === "text")
      return item.text ? [{ type: "text", text: item.text }] : [];
    if (item.kind === "equation")
      return [
        {
          type: "inlineEquation",
          attrs: {
            latex: item.latex,
            ...(nativeReadOnly ? { nativeReadOnly: true } : {}),
          },
        },
      ];
    return [
      {
        type: "nativeDocxImage",
        attrs: {
          src: docxNativeMediaUrl(binding, item),
          partName: item.partName,
          mediaType: item.mediaType,
          alt: item.altText,
          ...(item.widthEmu ? { widthEmu: item.widthEmu } : {}),
          ...(item.heightEmu ? { heightEmu: item.heightEmu } : {}),
          placement: item.placement,
          nativeReadOnly: true,
        },
      },
    ];
  });
  return nodes.length ? nodes : undefined;
}

function cellJsonFromRichContent(
  content: readonly DocxRichInline[],
  binding: unknown,
  nativeReadOnly: boolean,
) {
  const meaningful = content.filter(
    (item) => item.kind !== "text" || Boolean(item.text.trim()),
  );
  const displayEquation =
    meaningful.length === 1 &&
    meaningful[0]?.kind === "equation" &&
    meaningful[0].display === "block"
      ? meaningful[0]
      : null;
  if (displayEquation)
    return [
      {
        type: "equation",
        attrs: {
          latex: displayEquation.latex,
          display: "block",
          alignment: "center",
          ...(nativeReadOnly ? { nativeReadOnly: true } : {}),
        },
      },
    ];
  return [
    {
      type: "paragraph",
      content: docxRichInlineToJson(content, binding, nativeReadOnly),
    },
  ];
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
  const block = parsed.data;
  const attrs = record(block.attrs);
  const nativeReadOnly = attrs.nativeReadOnly === true;
  const nativeAttrs = {
    blockId: block.id,
    ...(nativeReadOnly ? { nativeReadOnly: true } : {}),
  };

  if (block.type === "equation") {
    const equation = block.inlineContent?.find(
      (item): item is Extract<DocxRichInline, { kind: "equation" }> =>
        item.kind === "equation",
    );
    return {
      type: "equation",
      attrs: {
        ...nativeAttrs,
        latex: equation?.latex ?? block.text,
        display: "block",
        alignment: attrs.alignment ?? "center",
      },
    };
  }

  if (block.type === "table" && block.richRows) {
    return {
      type: "table",
      attrs: nativeAttrs,
      content: block.richRows.map((row, rowIndex) => ({
        type: "tableRow",
        content: row.map((cell) => ({
          type: rowIndex === 0 ? "tableHeader" : "tableCell",
          content: cellJsonFromRichContent(cell, binding, nativeReadOnly),
        })),
      })),
    };
  }

  const inlineContent = block.inlineContent ?? [];
  if (!richInlineHasObject(inlineContent)) return null;
  const content = docxRichInlineToJson(
    inlineContent,
    binding,
    nativeReadOnly,
  );
  if (block.type === "heading")
    return {
      type: "heading",
      attrs: {
        ...nativeAttrs,
        level:
          Number(String(attrs.styleId ?? "").match(/^Heading([1-3])$/i)?.[1]) ||
          Number(attrs.level) ||
          2,
      },
      content,
    };
  if (block.type === "list")
    return {
      type: "bulletList",
      attrs: nativeAttrs,
      content: [
        {
          type: "listItem",
          content: [{ type: "paragraph", content }],
        },
      ],
    };
  return { type: "paragraph", attrs: nativeAttrs, content };
}

export function documentNodeText(node?: DocumentJsonNode): string {
  if (!node) return "";
  if (typeof node.text === "string") return node.text;
  if (node.type === "inlineEquation" || node.type === "equation")
    return String(node.attrs?.latex ?? "");
  if (node.type === "nativeDocxImage")
    return String(node.attrs?.alt ?? "");
  const separator = node.type === "listItem" ? "" : "\n";
  return (node.content ?? []).map(documentNodeText).join(separator);
}

function appendRichInline(
  output: DocxRichInline[],
  item: DocxRichInline,
) {
  const previous = output.at(-1);
  if (item.kind === "text" && previous?.kind === "text") {
    previous.text += item.text;
    return;
  }
  output.push(item);
}

export function documentRichInlineFromJson(
  node: DocumentJsonNode,
): DocxRichInline[] {
  const output: DocxRichInline[] = [];
  const visit = (current: DocumentJsonNode) => {
    if (typeof current.text === "string") {
      if (current.text)
        appendRichInline(output, { kind: "text", text: current.text });
      return;
    }
    if (current.type === "inlineEquation" || current.type === "equation") {
      appendRichInline(output, {
        kind: "equation",
        latex: String(current.attrs?.latex ?? ""),
        display: current.type === "equation" ? "block" : "inline",
      });
      return;
    }
    if (current.type === "nativeDocxImage") {
      const widthEmu = Number(current.attrs?.widthEmu);
      const heightEmu = Number(current.attrs?.heightEmu);
      const parsed = docxRichInlineSchema.safeParse({
        kind: "image",
        partName: current.attrs?.partName,
        mediaType: current.attrs?.mediaType,
        altText: String(current.attrs?.alt ?? "Word image"),
        ...(Number.isSafeInteger(widthEmu) && widthEmu > 0
          ? { widthEmu }
          : {}),
        ...(Number.isSafeInteger(heightEmu) && heightEmu > 0
          ? { heightEmu }
          : {}),
        placement:
          current.attrs?.placement === "anchored" ? "anchored" : "inline",
      });
      if (parsed.success) appendRichInline(output, parsed.data);
      return;
    }
    const children = current.content ?? [];
    children.forEach((child, index) => {
      if (
        index > 0 &&
        ["paragraph", "heading"].includes(child.type ?? "") &&
        output.length
      )
        appendRichInline(output, { kind: "text", text: "\n" });
      visit(child);
    });
  };
  visit(node);
  return output;
}

function tableRows(node: DocumentJsonNode) {
  return (node.content ?? []).map((row) =>
    (row.content ?? []).map((cell) => documentNodeText(cell).trim()),
  );
}

function tableRichRows(node: DocumentJsonNode) {
  return (node.content ?? []).map((row) =>
    (row.content ?? []).map((cell) => documentRichInlineFromJson(cell)),
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
        const richRows = tableRichRows(node);
        return {
          id,
          type: "table",
          text: rows.map((row) => row.join(" | ")).join("\n"),
          rows,
          ...(richRows.some((row) => row.some(richInlineHasObject))
            ? { richRows }
            : {}),
          ...(node.attrs?.nativeReadOnly === true
            ? { attrs: { nativeReadOnly: true } }
            : {}),
        };
      }

      const inlineContent = documentRichInlineFromJson(node);
      const hasRichContent = richInlineHasObject(inlineContent);
      const text = (
        hasRichContent ? richInlineText(inlineContent) : documentNodeText(node)
      ).trimEnd();
      if (node.type === "heading") {
        const level = Number(node.attrs?.level) || 2;
        return {
          id,
          type: "heading",
          text,
          ...(hasRichContent ? { inlineContent } : {}),
          attrs: {
            level,
            styleId: `Heading${level}`,
            ...(node.attrs?.nativeReadOnly === true
              ? { nativeReadOnly: true }
              : {}),
          },
        };
      }
      if (node.type === "blockquote")
        return {
          id,
          type: "quote",
          text,
          ...(hasRichContent ? { inlineContent } : {}),
        };
      if (node.type === "bulletList" || node.type === "orderedList")
        return {
          id,
          type: "list",
          text,
          ...(hasRichContent ? { inlineContent } : {}),
          ...(node.attrs?.nativeReadOnly === true
            ? { attrs: { nativeReadOnly: true } }
            : {}),
        };
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
          inlineContent: [
            { kind: "equation", latex, display: "block" },
          ],
          attrs: {
            display: node.attrs?.display ?? "block",
            alignment: node.attrs?.alignment ?? "center",
            ...(node.attrs?.nativeReadOnly === true
              ? { nativeReadOnly: true }
              : {}),
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
        ...(hasRichContent ? { inlineContent } : {}),
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
