import { Heading1, Heading2, Heading3, Heading4, Heading5, Heading6, Pilcrow, Quote, Type, type LucideIcon } from "lucide-react";
import type { DocxStyleCatalogue, DocxStyleEntry } from "../lenses/projection-contracts";
import { wordFontStack } from "./word-style-sheet";

/**
 * A Word document's own paragraph styles as the style menu offers them: the
 * names Word shows, in the order a writer reaches for them, each previewed in
 * its own typeface. Choosing one writes that style, so Word reopens the
 * paragraph under the name the writer picked.
 */

export const WORD_STYLE_PREFIX = "word:";

export type WordStyleOption = {
  value: string;
  label: string;
  styleId: string;
  /** Heading level when the style is one of Word's headings. */
  level?: number;
  icon?: LucideIcon;
  hint?: string;
  previewFontFamily?: string;
};

const ROLE_ORDER: Array<NonNullable<DocxStyleEntry["role"]>> = [
  "normal", "title", "subtitle", "heading1", "heading2", "heading3", "heading4", "heading5", "heading6", "quote", "caption",
];

const HEADING_ICONS = [Heading1, Heading2, Heading3, Heading4, Heading5, Heading6];

// Styles Word applies itself or that only mean something in its own furniture.
const MACHINE_STYLE = /^(toc ?\d|toc heading|header|footer|footnote text|endnote text|annotation text|balloon text|list paragraph|no spacing|table|index ?\d|bibliography)$/iu;

/** Word's built-in names are lower case in the file ("heading 1"); Word shows them capitalised. */
function displayName(name: string) {
  return name.charAt(0).toLocaleUpperCase() + name.slice(1);
}

function hintOf(style: DocxStyleEntry) {
  const look = [
    style.fontFamily,
    style.fontSizePoints ? `${style.fontSizePoints} pt` : undefined,
    style.bold ? "bold" : undefined,
    style.italic ? "italic" : undefined,
  ].filter(Boolean);
  return look.length ? `${displayName(style.name)}: ${look.join(", ")}` : displayName(style.name);
}

export function wordStyleOptions(catalogue: DocxStyleCatalogue | undefined): WordStyleOption[] {
  if (!catalogue) return [];
  const entries = Object.entries(catalogue.paragraph);
  const byRole = new Map<string, [string, DocxStyleEntry]>();
  for (const entry of entries) {
    const role = entry[0] === catalogue.defaultStyleId ? "normal" : entry[1].role;
    if (role && !byRole.has(role)) byRole.set(role, entry);
  }
  const chosen: Array<[string, DocxStyleEntry, string | undefined]> = [];
  const taken = new Set<string>();
  // Word keeps its headings latent until a file first uses one; Spectra writes
  // Word's own definition on first use, so the first three are always offered.
  for (const level of [1, 2, 3]) {
    const role = `heading${level}`;
    if (!byRole.has(role) && !catalogue.paragraph[`Heading${level}`])
      byRole.set(role, [`Heading${level}`, { name: `heading ${level}`, role: role as DocxStyleEntry["role"], bold: true }]);
  }
  for (const role of ROLE_ORDER) {
    const entry = byRole.get(role);
    if (!entry || taken.has(entry[0])) continue;
    taken.add(entry[0]);
    chosen.push([entry[0], entry[1], role]);
  }
  const others = entries
    .filter(([id, style]) => !taken.has(id) && style.role !== "listParagraph" && !MACHINE_STYLE.test(style.name.trim()))
    .sort(([, left], [, right]) => left.name.localeCompare(right.name));
  for (const [id, style] of others.slice(0, 24)) chosen.push([id, style, style.role]);
  return chosen.map(([id, style, role]) => {
    const level = Number(role?.match(/^heading([1-6])$/u)?.[1] ?? 0) || undefined;
    const label = role === "normal" ? "Normal" : level ? `Heading ${level}` : displayName(style.name);
    const font = wordFontStack(style.fontFamily);
    return {
      value: `${WORD_STYLE_PREFIX}${id}`,
      label,
      styleId: id,
      ...(level ? { level, icon: HEADING_ICONS[level - 1] } : role === "normal" ? { icon: Pilcrow } : role === "quote" ? { icon: Quote } : { icon: Type }),
      hint: hintOf(style),
      ...(font ? { previewFontFamily: font } : {}),
    };
  });
}

/** The option the paragraph at the cursor is in, by its heading level or its Word style. */
export function activeWordStyle(
  options: readonly WordStyleOption[],
  node: { type: string; level?: number; styleId?: string | null },
) {
  if (node.type === "heading") return options.find((option) => option.level === node.level)?.value;
  if (node.type !== "paragraph") return undefined;
  const styleId = node.styleId || undefined;
  if (!styleId) return options[0]?.value;
  return options.find((option) => option.styleId === styleId)?.value;
}
