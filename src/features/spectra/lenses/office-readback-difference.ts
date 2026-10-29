import { pptxProjectionSemanticDigest, type PptxProjection } from "./pptx-lens";
import { pptxSemanticContent } from "./pptx-readback";
import { xlsxSemanticDigest } from "./xlsx-lens";
import type { XlsxProjection } from "./projection-contracts";

/** Name the first slide, sheet or cell whose native readback differs from the
 * request, so a refused write tells the writer what the file could not hold. */
export async function officeReadbackDifference(requested: PptxProjection | XlsxProjection, readback: PptxProjection | XlsxProjection, isSheet: boolean) {
  try {
    if (isSheet) {
      const want = requested as XlsxProjection, got = readback as XlsxProjection;
      if (want.sheets.length !== got.sheets.length) return `Excel reopened ${got.sheets.length} sheets where ${want.sheets.length} were written`;
      for (const [index, sheet] of want.sheets.entries()) {
        const other = got.sheets[index]!;
        if (await xlsxSemanticDigest({ ...want, sheets: [sheet] }) === await xlsxSemanticDigest({ ...got, sheets: [other] })) continue;
        const cells = new Map(other.cells.map((cell) => [cell.ref, cell]));
        const cell = sheet.cells.find((cell) => {
          const read = cells.get(cell.ref);
          return JSON.stringify([cell.value, cell.formula, cell.format]) !== JSON.stringify([read?.value, read?.formula, read?.format]);
        });
        return cell ? `cell ${sheet.name}!${cell.ref} did not survive Excel's readback` : `sheet "${sheet.name}" layout did not survive Excel's readback`;
      }
      return "workbook settings or defined names did not survive Excel's readback";
    }
    const want = requested as PptxProjection, got = readback as PptxProjection;
    if (want.slides.length !== got.slides.length) return `PowerPoint reopened ${got.slides.length} slides where ${want.slides.length} were written`;
    for (const [index, slide] of want.slides.entries()) {
      if (await pptxProjectionSemanticDigest({ ...want, slides: [slide] }) === await pptxProjectionSemanticDigest({ ...got, slides: [got.slides[index]!] })) continue;
      const field = firstDifference(pptxSemanticContent({ ...want, slides: [slide] }), pptxSemanticContent({ ...got, slides: [got.slides[index]!] }))?.replace(/^0\.?/, "");
      return `slide ${index + 1} did not survive PowerPoint's readback${field ? ` (${field} is not something the file can hold as written; leave it as the read showed it)` : ""}`;
    }
    return "presentation settings did not survive PowerPoint's readback";
  } catch {
    return "the file did not read back as written";
  }
}

/** The first path where two plain values differ, named for the writer. */
function firstDifference(want: unknown, got: unknown, path: string[] = []): string | null {
  if (JSON.stringify(want) === JSON.stringify(got)) return null;
  if (want && got && typeof want === "object" && typeof got === "object" && Array.isArray(want) === Array.isArray(got)) {
    const left = want as Record<string, unknown>, right = got as Record<string, unknown>;
    for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
      const found = firstDifference(left[key], right[key], [...path, key]);
      if (found) return found;
    }
  }
  return path.join(".") || null;
}
