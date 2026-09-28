import { comparePackages } from "@ariadng/office/preservation";
import { contentProjection } from "@/app/api/spectra/lenses/docx/route";
import { assertNativePreservationKept } from "./preservation-proof";
import { docxProjectionFromContent } from "./document-projection";
import { docxLens, type DocxProjection } from "./docx-lens";
import {
  pptxArtifactContent,
  pptxProjectionFromContent,
  pptxProjectionUpdateFromContent,
  xlsxArtifactContent,
  xlsxProjectionUpdateFromContent,
} from "./office-content";
import { pptxLens, type PptxProjection } from "./pptx-lens";
import { xlsxLens, type XlsxProjection } from "./xlsx-lens";
import { offsetCellToRow } from "../sheets/operations";
import { coordinateToAddress, parseAddress } from "../sheets/model";
import type { SheetsContent } from "../sheets/model";
import { documentYjsAdapter } from "../work/models/yjs/document-adapter";
import {
  presentationYjsAdapter,
  sheetsYjsAdapter,
} from "../work/models/yjs/structured-adapters";
import type { PresentationContent } from "../presentation/model";

const actor = { clientId: "p2-i5-seam", kind: "human" as const };

function humanOrigin() {
  return documentYjsAdapter.origins(actor).localHuman;
}

function regionIds(projection: { blocks?: Array<{ id: string }>; sheets?: Array<{ cells: Array<{ id: string }> }>; slides?: Array<{ id: string; objects: Array<{ id: string }> }> }) {
  if (projection.blocks) return projection.blocks.map((block) => block.id);
  if (projection.sheets)
    return projection.sheets.flatMap((sheet) => sheet.cells.map((cell) => cell.id));
  return (projection.slides ?? []).flatMap((slide) => [
    slide.id,
    ...slide.objects.map((object) => object.id),
  ]);
}

/**
 * The old adapter that turned a Word table into pipe-text paragraphs.
 * Kept only so the DOC-1 contract can fail on purpose against the pre-fix seam.
 */
export function flattenTablesLikePreFixAdapter(
  blocks: DocxProjection["blocks"],
): DocxProjection["blocks"] {
  return blocks.map((block) =>
    block.type === "table"
      ? {
          ...block,
          type: "paragraph",
          rows: undefined,
          text: (block.rows ?? [])
            .map((row) => row.join(" | "))
            .join("\n") || block.text,
        }
      : block,
  );
}

export type DocxSeamMutation = (content: {
  blocks: DocxProjection["blocks"];
}) => { blocks: DocxProjection["blocks"]; nativeProjectionComplete?: true };

export async function runDocxProductionSeam(
  bytes: Uint8Array,
  mutate: DocxSeamMutation,
) {
  const opened = await docxLens.open(bytes, "strict-native");
  const document = documentYjsAdapter.createDocument({
    blocks: opened.projection.blocks,
    nativeBinding: opened.projection.nativeBinding,
  });
  const before = documentYjsAdapter.project(document);
  const mutated = mutate({
    blocks: (before.blocks ?? opened.projection.blocks) as DocxProjection["blocks"],
  });
  documentYjsAdapter.applyProjection(
    document,
    {
      ...before,
      blocks: mutated.blocks,
      nativeProjectionComplete: true,
      nativeBinding: opened.projection.nativeBinding,
    },
    humanOrigin(),
  );
  const afterYjs = documentYjsAdapter.project(document);
  const editorContent = { ...afterYjs, nativeProjectionComplete: true as const };
  const update = docxProjectionFromContent(editorContent, opened.projection);
  const routed = contentProjection(editorContent, opened.projection);
  if (JSON.stringify(routed) !== JSON.stringify(update.projection))
    throw new Error("DOCX route merge drifted from the canonical projection transform.");
  const output = update.operations.length
    ? await docxLens.mutate(opened.preservedCarry, {
        kind: "ai-edit",
        operations: update.operations,
      })
    : bytes;
  const [comparison, reopened] = await Promise.all([comparePackages(bytes, output), docxLens.open(output, "strict-native")]);
  await assertNativePreservationKept({
    entries: opened.fidelityMap.entries,
    parts: comparison.parts,
    before: opened.preservedCarry.safePayload ?? bytes, after: reopened.preservedCarry.safePayload ?? output,
    intent: { format: "docx", projection: opened.projection, operations: update.operations },
  });
  return {
    opened,
    afterYjs,
    update,
    output,
    comparison,
    reopened,
    beforeIds: regionIds(opened.projection),
    afterIds: regionIds(reopened.projection),
  };
}

export type XlsxSeamMutation = (content: SheetsContent) => SheetsContent;

export async function runXlsxProductionSeam(
  bytes: Uint8Array,
  mutate: XlsxSeamMutation,
) {
  const opened = await xlsxLens.open(bytes);
  const document = sheetsYjsAdapter.createDocument(
    xlsxArtifactContent(opened.projection),
  );
  const mutated = mutate(sheetsYjsAdapter.project(document));
  sheetsYjsAdapter.applyProjection(
    document,
    mutated,
    sheetsYjsAdapter.origins(actor).localHuman,
  );
  const afterYjs = sheetsYjsAdapter.project(document);
  const update = xlsxProjectionUpdateFromContent(afterYjs, opened.projection);
  const output = update.operations.length
    ? await xlsxLens.mutate(opened.preservedCarry, {
        kind: "ai-edit",
        operations: update.operations,
      })
    : bytes;
  const [comparison, reopened] = await Promise.all([comparePackages(bytes, output), xlsxLens.open(output)]);
  await assertNativePreservationKept({
    entries: opened.fidelityMap.entries,
    parts: comparison.parts,
    before: opened.preservedCarry.safePayload ?? bytes, after: reopened.preservedCarry.safePayload ?? output,
    intent: { format: "xlsx", projection: opened.projection, operations: update.operations },
  });
  return {
    opened,
    afterYjs,
    update,
    output,
    comparison,
    reopened,
    beforeIds: regionIds(opened.projection),
    afterIds: regionIds(reopened.projection),
  };
}

export type PptxSeamMutation = (content: PresentationContent) => PresentationContent;

export async function runPptxProductionSeam(
  bytes: Uint8Array,
  mutate: PptxSeamMutation,
) {
  const opened = await pptxLens.open(bytes);
  const document = presentationYjsAdapter.createDocument(
    pptxArtifactContent(opened.projection),
  );
  const mutated = mutate(presentationYjsAdapter.project(document));
  presentationYjsAdapter.applyProjection(
    document,
    mutated,
    presentationYjsAdapter.origins(actor).localHuman,
  );
  const afterYjs = presentationYjsAdapter.project(document);
  const update = pptxProjectionUpdateFromContent(afterYjs, opened.projection, { objectLists: "complete" });
  const merged = pptxProjectionFromContent(afterYjs, opened.projection);
  const output = update.operations.length
    ? await pptxLens.mutate(opened.preservedCarry, {
        kind: "ai-edit",
        operations: update.operations,
      })
    : bytes;
  const [comparison, reopened] = await Promise.all([comparePackages(bytes, output), pptxLens.open(output)]);
  await assertNativePreservationKept({
    entries: opened.fidelityMap.entries,
    parts: comparison.parts,
    before: opened.preservedCarry.safePayload ?? bytes, after: reopened.preservedCarry.safePayload ?? output,
    intent: { format: "pptx", projection: opened.projection, operations: update.operations },
  });
  return {
    opened,
    afterYjs,
    update,
    merged,
    output,
    comparison,
    reopened,
    beforeIds: regionIds(opened.projection),
    afterIds: regionIds(reopened.projection),
  };
}

/**
 * Studio sort coordinates (0-based row/column, same as `runCustomSort`).
 * The grid's `offsetCellToRow` is the shifter under test — this only gathers rows.
 */
export function sortSheetRows(
  content: SheetsContent,
  startRow: number,
  endRow: number,
  keyColumn: number,
): SheetsContent {
  const sheet = content.sheets[0];
  if (!sheet) return content;
  const columns = [
    keyColumn,
    ...Object.keys(sheet.cells).flatMap((ref) => {
      const parsed = parseAddress(ref);
      return parsed ? [parsed.column] : [];
    }),
  ];
  const maxColumn = Math.max(...columns);
  const rows: Array<{
    row: number;
    values: Record<number, (typeof sheet.cells)[string] | undefined>;
  }> = [];
  for (let row = startRow; row <= endRow; row += 1) {
    const values: Record<number, (typeof sheet.cells)[string] | undefined> = {};
    for (let column = 0; column <= maxColumn; column += 1)
      values[column] = sheet.cells[coordinateToAddress({ row, column })];
    rows.push({ row, values });
  }
  rows.sort((left, right) => {
    const a = left.values[keyColumn]?.value;
    const b = right.values[keyColumn]?.value;
    return String(a ?? "").localeCompare(String(b ?? ""));
  });
  const cells = { ...sheet.cells };
  rows.forEach((entry, offset) => {
    const targetRow = startRow + offset;
    for (let column = 0; column <= maxColumn; column += 1) {
      const address = coordinateToAddress({ row: targetRow, column });
      const cell = entry.values[column];
      if (cell) cells[address] = offsetCellToRow(cell, entry.row, targetRow);
      else delete cells[address];
    }
  });
  return {
    ...content,
    sheets: content.sheets.map((candidate, index) =>
      index === 0 ? { ...candidate, cells } : candidate,
    ),
  };
}

export function semanticDigest(projection: DocxProjection | XlsxProjection | PptxProjection) {
  return projection.nativeBinding.semanticDigest;
}
