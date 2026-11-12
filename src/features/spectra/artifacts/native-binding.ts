const UNDERIVED = "0".repeat(64);

/**
 * An Office file's binding carries hashes the lens re-derives from the content
 * on every native save. They say nothing the content does not, so comparisons
 * of what a writer changed hold them fixed: the identity of the file stays.
 */
export function withoutDerivedNativeBinding<T>(content: T): T {
  if (!content || typeof content !== "object" || Array.isArray(content)) return content;
  const binding = (content as { nativeBinding?: unknown }).nativeBinding;
  if (!binding || typeof binding !== "object") return content;
  const { externalTransaction: _externalTransaction, ...record } = binding as Record<string, unknown>;
  return {
    ...content,
    nativeBinding: {
      ...record,
      ...("semanticDigest" in record ? { semanticDigest: UNDERIVED } : {}),
      ...("sourcePayloadHash" in record ? { sourcePayloadHash: UNDERIVED } : {}),
      // A file without Word's paragraph ids gains them on its first save.
      ...("identityStable" in record ? { identityStable: true } : {}),
    },
  };
}

const SLIDE_FIELDS_OF_THE_FILE = ["layoutId", "accessibility"] as const;

/** What Excel writes for a cell nobody formatted. */
const EXCEL_DEFAULT_FORMAT: Record<string, unknown> = {
  bold: false, italic: false, underline: false, strike: false, fontFamily: "sans", fontSize: 11,
  verticalAlign: "bottom", wrap: false, rotation: 0, indent: 0, numberFormat: "general",
};

const nativeFormat = (content: unknown) =>
  String((content as { nativeBinding?: { format?: unknown } } | null)?.nativeBinding?.format ?? "");

function withoutFileOwnedSlide(slide: unknown) {
  if (!slide || typeof slide !== "object") return slide;
  const rest = { ...(slide as Record<string, unknown>) };
  for (const field of SLIDE_FIELDS_OF_THE_FILE) delete rest[field];
  return rest;
}

function withoutFileOwnedCell(cell: unknown) {
  if (!cell || typeof cell !== "object") return cell;
  const rest = { ...(cell as Record<string, unknown>) };
  if (rest.formula) {
    delete rest.value;
    delete rest.nativeFormulaSupport;
  }
  if (rest.format && typeof rest.format === "object") {
    const format = Object.fromEntries(
      Object.entries(rest.format as Record<string, unknown>).filter(([key, value]) => EXCEL_DEFAULT_FORMAT[key] !== value),
    );
    if (Object.keys(format).length) rest.format = format;
    else delete rest.format;
  }
  return rest;
}

/** The text a Word block shows, however the file splits it up. */
function blockText(block: unknown): string {
  if (!block || typeof block !== "object") return "";
  const { type, text, rows, inlineContent } = block as { type?: unknown; text?: unknown; rows?: unknown; inlineContent?: unknown };
  if (type === "equation") return "";
  if (Array.isArray(inlineContent))
    return inlineContent
      .map((item: { kind?: unknown; text?: unknown }) => (item?.kind !== "equation" && typeof item?.text === "string" ? item.text : ""))
      .join("");
  const cells = Array.isArray(rows) ? rows.flat().map(String) : [];
  return (typeof text === "string" && !cells.length ? [text] : cells).join(" ");
}

/**
 * The letters and numbers of a Word document's prose, in order. Word spells the
 * same equation its own way, so equations are left out, along with punctuation
 * and formatting: the lens has already compared those against the file.
 */
function wordsOfBlocks(blocks: unknown[]) {
  return blocks
    .map(blockText)
    .join(" ")
    .replace(/\$\$?[^$]*\$\$?/g, "")
    .replace(/\\[a-zA-Z]+/g, "")
    .normalize("NFD")
    .replace(/[^\p{L}\p{N}]/gu, "");
}

/**
 * Some of what an Office file holds is the file's, not a writer's: a slide's
 * layout part and accessibility hints, a formula's cached result, the format
 * Excel spells out for a cell nobody formatted. The readback keeps its own,
 * whatever was sent, so a comparison of what the writer changed sets them
 * aside on those files only.
 *
 * A Word file owns more still: it assigns block ids, merges and resolves runs,
 * and splits a list into paragraphs when it is saved. The lens has already
 * compared the formatting it could represent against the request before this
 * runs, so here a Word result answers only for its words and page setup.
 */
export function withoutFileOwnedFields<T>(content: T): T {
  const format = nativeFormat(content);
  const record = content as { slides?: unknown; sheets?: unknown; blocks?: unknown; pageSetup?: unknown };
  if (/^do[ct][xm]$/.test(format) && Array.isArray(record.blocks))
    return {
      words: wordsOfBlocks(record.blocks),
      pageSetup: record.pageSetup ?? null,
      nativeBinding: (content as { nativeBinding?: unknown }).nativeBinding,
    } as T;
  if (/^p(?:pt|ot|ps|pa)[xm]$/.test(format) && Array.isArray(record.slides))
    return { ...content, slides: record.slides.map(withoutFileOwnedSlide) };
  if (/^x(?:ls|lt|la)[xm]$/.test(format) && Array.isArray(record.sheets))
    return {
      ...content,
      sheets: record.sheets.map((sheet) => {
        const cells = (sheet as { cells?: unknown } | null)?.cells;
        if (!cells || typeof cells !== "object" || Array.isArray(cells)) return sheet;
        return {
          ...(sheet as Record<string, unknown>),
          cells: Object.fromEntries(Object.entries(cells).map(([address, cell]) => [address, withoutFileOwnedCell(cell)])),
        };
      }),
    };
  return content;
}
