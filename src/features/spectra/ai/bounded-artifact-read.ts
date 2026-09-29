import { sheetCellEntries } from "../../../../shared/sheet-cells";
import { artifactContextSnapshot } from "./context-builder";

const MAX_MODEL_CONTENT_BYTES = 64 * 1024;
const OUTLINE_BYTES = 20 * 1024;
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;

/**
 * A document too large to return whole: as many complete blocks as fit
 * (from the start, or the requested blockIds), plus an outline of every other
 * block's id so the model can ask for any region. Previously it saw the first
 * 24 blocks' ids only, and a requested block over 2,000 bytes was dropped
 * without a word.
 */
function largeDocumentRead(
  artifact: Record<string, unknown>,
  snapshot: { title?: unknown; summary?: unknown },
  blocks: unknown[],
  blockIds: string[] | undefined,
) {
  const wanted = blockIds?.length ? new Set(blockIds.slice(0, 16)) : null;
  let budget = MAX_MODEL_CONTENT_BYTES - OUTLINE_BYTES;
  const shown: unknown[] = [];
  const shownIndexes = new Set<number>();
  const tooLarge: Array<{ id: unknown; bytes: number }> = [];
  for (const [index, value] of blocks.entries()) {
    const row = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
    if (wanted && !wanted.has(String(row.id))) continue;
    const size = bytes(value);
    if (size > budget) {
      if (!wanted) break;
      tooLarge.push({ id: row.id, bytes: size });
      continue;
    }
    shown.push(value);
    shownIndexes.add(index);
    budget -= size;
  }
  let outlineBudget = OUTLINE_BYTES;
  const outline: Array<Record<string, unknown>> = [];
  let outlineStoppedAt: number | null = null;
  for (const [index, value] of blocks.entries()) {
    if (shownIndexes.has(index)) continue;
    const row = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
    // Ids for every block; headings keep a short label for navigation.
    const label = typeof row.heading === "string" && row.heading.trim() ? row.heading : /heading|title/i.test(String(row.type)) ? row.text : undefined;
    const heading = typeof label === "string" && label.trim() ? label.slice(0, 80) : undefined;
    const entry = { index, id: row.id, type: row.type, ...(heading ? { heading } : {}) };
    const size = bytes(entry);
    if (size > outlineBudget) { outlineStoppedAt = index; break; }
    outline.push(entry);
    outlineBudget -= size;
  }
  const missing = wanted ? [...wanted].filter((id) => !blocks.some((value) => String((value as Record<string, unknown> | null)?.id) === id)) : [];
  return {
    id: artifact.id ?? artifact._id, blueprintKey: artifact.blueprintKey ?? artifact.type,
    title: snapshot.title, summary: snapshot.summary, updatedAt: artifact.updatedAt,
    currentVersionId: artifact.currentVersionId, contentHash: artifact.contentHash,
    liveStateVectorHash: artifact.liveStateVectorHash,
    content: { blocks: shown },
    blockOutline: outline,
    contentCoverage: {
      complete: false,
      totalBytes: bytes(artifact.content),
      totalBlocks: blocks.length,
      shownBlocks: shown.length,
      ...(outlineStoppedAt !== null ? { outlineStopsBeforeIndex: outlineStoppedAt } : {}),
      ...(tooLarge.length ? { blocksTooLargeToReturn: tooLarge } : {}),
      ...(missing.length ? { unknownBlockIds: missing } : {}),
      instruction: "content.blocks are complete blocks; blockOutline lists every other block's id. Request up to 16 blockIds from the outline to read them. Use targeted contentPatch operations; never replace the document with this partial content.",
    },
  };
}

/** Bound model reads, not canonical content. Partial content must be patched,
 * never used as a replacement for the complete authored artifact. */
export function boundedArtifactRead(
  artifact: Record<string, unknown>,
  selection: { prompt?: string; cellAddresses?: string[]; sheetId?: string; blockIds?: string[] } = {},
) {
  const { content } = artifact;
  if (content == null || bytes(content) <= MAX_MODEL_CONTENT_BYTES) return artifact;
  const snapshot = artifactContextSnapshot({ ...artifact, _id: artifact._id ?? artifact.id }, { includeExcerpt: true });
  const source = content as Record<string, unknown>;
  const requested = new Set((selection.cellAddresses ?? [...(selection.prompt ?? "").matchAll(/\b([A-Z]{1,3}[1-9]\d{0,6})\b/gi)].map(match => match[1]!)).slice(0, 32).map(address => address.toUpperCase()));
  let partial: unknown = snapshot.structure;
  if (Array.isArray(source.sheets)) {
    partial = {
      activeSheetId: source.activeSheetId,
      sheets: source.sheets.filter((value) => !selection.sheetId || (value as Record<string, unknown>).id === selection.sheetId).slice(0, 8).map((value) => {
        const sheet = value as Record<string, unknown>;
        const entries = sheetCellEntries(sheet.cells);
        const selected = entries.filter(([address], index) => requested.has(address) || index < 8);
        const cells: Record<string, unknown> = {};
        let remaining = 4_000;
        for (const [address, cell] of selected.sort(([a], [b]) => Number(requested.has(b)) - Number(requested.has(a)))) {
          const size = bytes(cell);
          if (size <= remaining) { cells[address] = cell; remaining -= size; }
        }
        return { id: sheet.id, name: String(sheet.name ?? "").slice(0, 120), rowCount: sheet.rowCount, columnCount: sheet.columnCount, totalCellCount: entries.length, cells };
      }),
    };
  } else if (Array.isArray(source.blocks)) {
    return largeDocumentRead(artifact, snapshot, source.blocks, selection.blockIds);
  }
  return {
    id: artifact.id ?? artifact._id, blueprintKey: artifact.blueprintKey ?? artifact.type,
    title: snapshot.title, summary: snapshot.summary, updatedAt: artifact.updatedAt,
    currentVersionId: artifact.currentVersionId, contentHash: artifact.contentHash,
    liveStateVectorHash: artifact.liveStateVectorHash,
    content: partial,
    contentCoverage: { complete: false, totalBytes: bytes(content), instruction: "Only the returned regions were read. Use targeted contentPatch operations; do not replace this partial content. read_artifact accepts cellAddresses/sheetId or blockIds for further regions." },
  };
}
