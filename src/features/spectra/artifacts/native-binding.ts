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
  const record = binding as Record<string, unknown>;
  return {
    ...content,
    nativeBinding: {
      ...record,
      ...("semanticDigest" in record ? { semanticDigest: UNDERIVED } : {}),
      ...("sourcePayloadHash" in record ? { sourcePayloadHash: UNDERIVED } : {}),
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

/**
 * Some of what an Office file holds is the file's, not a writer's: a slide's
 * layout part and accessibility hints, a formula's cached result, the format
 * Excel spells out for a cell nobody formatted. The readback keeps its own,
 * whatever was sent, so a comparison of what the writer changed sets them
 * aside on those files only.
 */
export function withoutFileOwnedFields<T>(content: T): T {
  const format = nativeFormat(content);
  const record = content as { slides?: unknown; sheets?: unknown };
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
