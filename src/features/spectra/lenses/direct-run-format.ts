import type { DocxStyleCatalogue, DocxStyleEntry } from "./projection-contracts";

/**
 * Runs carry the formatting the writer gave them, not what their paragraph's
 * style already shows. A run that reads Cambria 12 pt in a Cambria 12 pt
 * paragraph says nothing about its font; the page draws it from the style.
 *
 * The lens, the diff and Word's readback all pass blocks through here, so a
 * run stored with its resolved format (older content) and the same run stored
 * with its direct format compare equal, and a write never spells out the
 * style's own font on text it did not change.
 */

type RunFormat = Record<string, unknown>;
type Inline = { kind: string; format?: RunFormat };
type Block = {
  type: string;
  attrs?: Record<string, unknown>;
  inlineContent?: Inline[];
  richRows?: Inline[][][];
};

const STYLE_KEYS = ["fontFamily", "fontSizePoints", "color", "bold", "italic", "allCaps", "smallCaps"] as const;

/** The paragraph style a block is drawn in: its own id, its heading role, else the default. */
export function blockStyle(catalogue: DocxStyleCatalogue | undefined, attrs: Record<string, unknown> | undefined) {
  if (!catalogue) return undefined;
  const ids = [attrs?.nativeStyleId, attrs?.styleId].filter((id): id is string => typeof id === "string" && id.length > 0);
  for (const id of ids) if (catalogue.paragraph[id]) return catalogue.paragraph[id];
  const heading = ids.map((id) => id.match(/^Heading([1-6])$/i)?.[1]).find(Boolean);
  if (heading) {
    const role = `heading${heading}`;
    const styled = Object.values(catalogue.paragraph).find((style) => style.role === role);
    if (styled) return styled;
  }
  return catalogue.paragraph[catalogue.defaultStyleId];
}

const same = (key: (typeof STYLE_KEYS)[number], value: unknown, style: DocxStyleEntry) => {
  const own = style[key];
  if (key === "color" || key === "fontFamily")
    return typeof value === "string" && typeof own === "string" && value.toLowerCase() === own.toLowerCase();
  if (key === "fontSizePoints") return typeof value === "number" && typeof own === "number" && Math.abs(value - own) < 0.01;
  // A toggle the style already turns on adds nothing when the run turns it on too.
  return value === true && own === true;
};

/** The part of a run's format its paragraph style does not already give it. */
export function directRunFormat<T extends RunFormat | undefined>(format: T, style: DocxStyleEntry | undefined): T | undefined {
  if (!format || !style) return format;
  let changed = false;
  const direct: RunFormat = {};
  for (const [key, value] of Object.entries(format)) {
    if ((STYLE_KEYS as readonly string[]).includes(key) && same(key as (typeof STYLE_KEYS)[number], value, style)) {
      changed = true;
      continue;
    }
    direct[key] = value;
  }
  if (!changed) return format;
  return (Object.keys(direct).length ? direct : undefined) as T | undefined;
}

function directInline(items: Inline[], style: DocxStyleEntry) {
  let changed = false;
  const next = items.map((item) => {
    if (item.kind !== "text" || !item.format) return item;
    const format = directRunFormat(item.format, style);
    if (format === item.format) return item;
    changed = true;
    const { format: _format, ...rest } = item;
    return (format ? { ...rest, format } : rest) as typeof item;
  });
  return changed ? mergeAlike(next) : items;
}

const PLAIN_TEXT_KEYS = new Set(["kind", "text", "format", "href"]);
const plainText = (item: Inline) => item.kind === "text" && Object.keys(item).every((key) => PLAIN_TEXT_KEYS.has(key));

/** Neighbouring runs that now look the same are one run, as the editor holds them. */
function mergeAlike(items: Inline[]) {
  const merged: Inline[] = [];
  for (const item of items) {
    const previous = merged.at(-1);
    if (
      previous && plainText(previous) && plainText(item) &&
      JSON.stringify(previous.format ?? null) === JSON.stringify(item.format ?? null) &&
      (previous as { href?: unknown }).href === (item as { href?: unknown }).href
    ) {
      merged[merged.length - 1] = { ...previous, text: String((previous as { text?: unknown }).text ?? "") + String((item as { text?: unknown }).text ?? "") } as Inline;
      continue;
    }
    merged.push(item);
  }
  return merged;
}

/**
 * Blocks with each run's format reduced to what its paragraph style does not
 * give. A table cell's words are measured against its paragraph's style, or
 * the document's default when the cell names none.
 */
export function directFormatBlocks<B extends Block>(
  blocks: B[],
  catalogue: DocxStyleCatalogue | undefined,
  /** Where an edited table no longer carries its cell styles: the stored table's. */
  fallbackCellStyles?: (block: B) => unknown,
): B[] {
  if (!catalogue) return blocks;
  return blocks.map((block) => {
    if (block.type === "equation") return block;
    if (block.type === "table") {
      const base = catalogue.paragraph[catalogue.defaultStyleId];
      if (!base || !block.richRows) return block;
      const cellStyles = (Array.isArray(block.attrs?.cellStyles) ? block.attrs.cellStyles : fallbackCellStyles?.(block)) as
        | Array<Array<string | null>>
        | undefined;
      let changed = false;
      const richRows = block.richRows.map((row, r) => row.map((cell, c) => {
        const id = cellStyles?.[r]?.[c];
        const next = directInline(cell, (id && catalogue.paragraph[id]) || base);
        if (next !== cell) changed = true;
        return next;
      }));
      if (!changed) return block;
      // Cells left with nothing but their plain words are plain rows, as Word
      // projects a table whose cells carry no formatting of their own.
      const rows = (block as { rows?: string[][] }).rows;
      const plain = rows && richRows.every((row, r) => row.every((cell, c) =>
        cell.length <= 1 && cell.every((item) => item.kind === "text" && !item.format && !(item as { href?: unknown }).href &&
          (item as { text?: unknown }).text === rows[r]?.[c])));
      if (plain) {
        const { richRows: _richRows, ...rest } = block;
        return rest as B;
      }
      return { ...block, richRows };
    }
    const style = blockStyle(catalogue, block.attrs);
    if (!style) return block;
    const inlineContent = block.inlineContent ? directInline(block.inlineContent, style) : undefined;
    const changed = inlineContent !== block.inlineContent;
    const summary = block.attrs?.format as RunFormat | undefined;
    const format = summary ? directRunFormat(summary, style) : undefined;
    const attrsChanged = summary !== undefined && format !== summary;
    if (!changed && !attrsChanged) return block;
    const attrs = attrsChanged
      ? (() => {
          const { format: _format, ...rest } = block.attrs ?? {};
          return format ? { ...rest, format } : rest;
        })()
      : block.attrs;
    return { ...block, ...(inlineContent ? { inlineContent } : {}), ...(attrs ? { attrs } : {}) };
  });
}

/**
 * What a paragraph style gives one paragraph-format field, falling back to
 * Word's own defaults where the style says nothing: left, single, no space,
 * no indent, no border or shading.
 */
export function styleParagraphValue(style: DocxStyleEntry | undefined, key: string): unknown {
  switch (key) {
    case "alignment": return style?.alignment ?? "left";
    case "lineSpacing": return style?.lineHeightPoints ? undefined : style?.lineSpacing ?? 1;
    case "spacingAfterPoints": return style?.spacingAfterPoints ?? 0;
    case "spacingBeforePoints": return style?.spacingBeforePoints ?? 0;
    case "firstLineIndentPoints": return style?.firstLineIndentPoints ?? 0;
    case "indentLevel": return style?.indentLeftPoints ? undefined : 0;
    case "border": return null;
    case "shading": return null;
    default: return undefined;
  }
}
