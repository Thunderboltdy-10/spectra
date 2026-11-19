import type { DocxStyleCatalogue, DocxStyleEntry } from "../lenses/projection-contracts";

/**
 * A Word document's own look, as CSS for the page that shows it. The default
 * paragraph style sets the page's type, each heading level takes its heading
 * style, and a paragraph that carries a style id (`data-style`) takes that
 * style. Text the writer types then reads as Word would show it.
 *
 * Every selector is wrapped in `:where()`, so the page's structural rules and
 * a paragraph's own inline spacing still win; the sheet only replaces Spectra's
 * prose defaults.
 */

const SERIF = /cambria|times|georgia|garamond|book antiqua|palatino|baskerville|caslon|minion|stix|caladea|tinos|serif|constantia|century|bodoni|didot|charter|crimson|libre baskerville|merriweather|noto serif|sylfaen/i;
const MONO = /courier|consolas|mono|menlo|lucida console|cousine|source code/i;

/**
 * Open fonts with the same metrics as Word's, tried after the font itself.
 * Each is served by Spectra under a variable the document page defines
 * (`word-fonts.ts`); Figtree is the interface's own face.
 */
const METRIC_TWINS: Record<string, string> = {
  calibri: "var(--word-font-carlito)",
  cambria: "var(--word-font-caladea)",
  "times new roman": "var(--word-font-tinos)",
  arial: "var(--word-font-arimo)",
  helvetica: "var(--word-font-arimo)",
  "courier new": "var(--word-font-cousine)",
  courier: "var(--word-font-cousine)",
  aptos: "var(--font-figtree)",
  "aptos display": "var(--font-figtree)",
};

const SAFE_FAMILY = /^[\p{L}\p{M}\p{N} ._&'+-]{1,80}$/u;

/** A CSS family list for a Word font: the font, its open twin, then the generic family. */
export function wordFontStack(family: string | undefined) {
  if (!family || !SAFE_FAMILY.test(family)) return undefined;
  const generic = MONO.test(family) ? "monospace" : SERIF.test(family) ? "serif" : "sans-serif";
  const twin = METRIC_TWINS[family.toLocaleLowerCase()];
  return [`"${family.replace(/"/g, "")}"`, ...(twin ? [twin] : []), generic].join(", ");
}

const SAFE_COLOR = /^[0-9a-f]{6}$/i;

/** Word "single" spacing is the font's own line height, a little over its size. */
const SINGLE_LINE = 1.17;

function declarations(style: DocxStyleEntry, base?: DocxStyleEntry) {
  const lines: string[] = [];
  const font = wordFontStack(style.fontFamily);
  if (font && style.fontFamily !== base?.fontFamily) lines.push(`font-family: ${font}`);
  if (style.fontSizePoints && style.fontSizePoints !== base?.fontSizePoints) lines.push(`font-size: ${style.fontSizePoints}pt`);
  if (style.bold !== base?.bold) lines.push(`font-weight: ${style.bold ? 700 : 400}`);
  if (style.italic !== base?.italic) lines.push(`font-style: ${style.italic ? "italic" : "normal"}`);
  if (style.allCaps !== base?.allCaps) lines.push(`text-transform: ${style.allCaps ? "uppercase" : "none"}`);
  if (style.smallCaps !== base?.smallCaps) lines.push(`font-variant-caps: ${style.smallCaps ? "small-caps" : "normal"}`);
  if (style.alignment !== base?.alignment)
    lines.push(`text-align: ${style.alignment === "distribute" ? "justify" : style.alignment ?? "left"}`);
  if (style.lineHeightPoints) lines.push(`line-height: ${style.lineHeightPoints}pt`);
  else if (!base || style.lineSpacing !== base.lineSpacing || base.lineHeightPoints)
    lines.push(`line-height: ${((style.lineSpacing ?? 1) * SINGLE_LINE).toFixed(3)}`);
  if (style.spacingBeforePoints !== base?.spacingBeforePoints || !base) lines.push(`margin-top: ${style.spacingBeforePoints ?? 0}pt`);
  if (style.spacingAfterPoints !== base?.spacingAfterPoints || !base) lines.push(`margin-bottom: ${style.spacingAfterPoints ?? 0}pt`);
  if (style.indentLeftPoints !== base?.indentLeftPoints) lines.push(`margin-left: ${style.indentLeftPoints ?? 0}pt`);
  if (style.firstLineIndentPoints !== base?.firstLineIndentPoints) lines.push(`text-indent: ${style.firstLineIndentPoints ?? 0}pt`);
  return lines;
}

function colorRules(selector: string, color: string | undefined) {
  if (!color || !SAFE_COLOR.test(color) || /^0{6}$/.test(color)) return [];
  return [
    `${selector} { color: #${color}; }`,
    // A dark page keeps Word's hue but stays readable.
    `:where(.dark) ${selector} { color: color-mix(in oklab, #${color} 45%, var(--text-primary)); }`,
  ];
}

const HEADING_TAGS: Record<string, string> = {
  heading1: "h1",
  heading2: "h2",
  heading3: "h3",
  heading4: "h4",
  heading5: "h5",
  heading6: "h6",
};

/** The style sheet for one Word document's page. `scope` selects the page's editor. */
export function wordStyleSheet(catalogue: DocxStyleCatalogue | undefined, scope: string) {
  const base = catalogue?.paragraph[catalogue.defaultStyleId];
  if (!catalogue || !base) return "";
  const rules: string[] = [];
  const root = `:where(${scope})`;
  const font = wordFontStack(base.fontFamily);
  const leading = base.lineHeightPoints ? `${base.lineHeightPoints}pt` : ((base.lineSpacing ?? 1) * SINGLE_LINE).toFixed(3);
  rules.push(
    `${root} { ${[
      ...(font ? [`--prose-font: ${font}`, `--prose-heading-font: ${font}`, `font-family: ${font}`] : []),
      ...(base.fontSizePoints ? [`--prose-size: ${base.fontSizePoints}pt`, `font-size: ${base.fontSizePoints}pt`] : []),
      `--prose-leading: ${leading}`,
      `line-height: ${leading}`,
    ].join("; ")}; }`,
  );
  rules.push(`${root} :where(p, li > p) { ${declarations(base).join("; ")}; }`);
  rules.push(...colorRules(`${root} :where(p)`, base.color));
  const seen = new Set<string>();
  for (const [id, style] of Object.entries(catalogue.paragraph)) {
    const heading = style.role ? HEADING_TAGS[style.role] : undefined;
    if (heading && !seen.has(heading)) {
      seen.add(heading);
      const selector = `${root} :where(${heading})`;
      rules.push(`${selector} { letter-spacing: normal; ${declarations({ bold: false, italic: false, ...style }).join("; ")}; }`);
      rules.push(...colorRules(selector, style.color));
    }
    if (id === catalogue.defaultStyleId || !/^[\p{L}\p{N}_ .-]{1,200}$/u.test(id)) continue;
    const selector = `${root} :where(p[data-style="${id}"])`;
    const own = declarations(style, base);
    if (own.length) rules.push(`${selector} { ${own.join("; ")}; }`);
    rules.push(...colorRules(selector, style.color));
  }
  return rules.join("\n");
}
