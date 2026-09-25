import { sheetCellEntries } from "../../../../shared/sheet-cells";
import { artifactContextSnapshot } from "./context-builder";

const MAX_MODEL_CONTENT_BYTES = 64 * 1024;
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;

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
  } else if (Array.isArray(source.blocks) && selection.blockIds?.length) {
    const wanted = new Set(selection.blockIds.slice(0, 16));
    partial = { blocks: source.blocks.filter(value => wanted.has(String((value as Record<string, unknown>).id))).filter(value => bytes(value) <= 2_000) };
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
