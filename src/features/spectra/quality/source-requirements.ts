import { parseDelimited } from "../sheets/model";

/** Derive data requirements from inspected source content, independent of the
 * user's wording or filename. Blank cells and headings are not measurements. */
export function hasNumericTableSource(attachments: Array<{ name: string; mimeType: string; extractedText?: string }>) {
  return attachments.some((attachment) => {
    const text = attachment.extractedText;
    if (!text || !( /\.(csv|tsv)$/i.test(attachment.name) || /csv|tab-separated-values/i.test(attachment.mimeType))) return false;
    const rows = parseDelimited(text, /\.tsv$/i.test(attachment.name) || /tab-separated/i.test(attachment.mimeType) ? "\t" : ",");
    if (rows.length < 3) return false;
    return rows[0]!.some((label, column) => label.trim() && rows.slice(1).filter((row) => {
      const cell = row[column]?.trim();
      return cell && Number.isFinite(Number(cell));
    }).length >= 2);
  });
}
