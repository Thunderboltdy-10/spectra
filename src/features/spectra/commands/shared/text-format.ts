import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Baseline,
  Bold,
  Eraser,
  Highlighter,
  Indent,
  Italic,
  List,
  ListOrdered,
  Outdent,
  PaintBucket,
  Strikethrough,
  Type,
  Underline,
} from "lucide-react";
import { z } from "zod";
import type { CommandBinding, CommandControlOption, FidelityRegionKey } from "../types";

/**
 * The shared text-formatting vocabulary.
 *
 * Before this module, "make it bold" existed three times: a TipTap chain inside
 * the document format bar, a cell-format inspector in Sheets, and a shape text
 * toggle in Presentation. None of them was a registered command, so the AI
 * could not do what the button did, a shortcut could not reach it, and nothing
 * could be pinned, renamed or moved.
 *
 * Here a type declares only the *adapter* — what it means to set a font on the
 * current selection — and receives real `CommandBinding`s with shared ids,
 * labels, icons, ordering, tabs and native-region declarations. The bar renders
 * a font picker, a size stepper and colour wells; the AI calls the identical
 * `execute` with a typed scalar.
 */

/** The one patch shape the three types agree on (contract §3.2.1). */
export const textFormatPatchSchema = z.object({
  fontFamily: z.string().optional(),
  fontSize: z.number().min(4).max(400).optional(),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  underline: z.boolean().optional(),
  strike: z.boolean().optional(),
  color: z.string().nullable().optional(),
  highlight: z.string().nullable().optional(),
  alignment: z.enum(["left", "center", "right", "justify"]).optional(),
  lineHeight: z.number().min(0.5).max(4).optional(),
});

export type TextFormatPatch = z.infer<typeof textFormatPatchSchema>;

/**
 * Fonts a person actually reaches for, with honest fallbacks. Every entry is a
 * real stack rather than a bare family name, so a deck or document keeps its
 * intended look on a machine that lacks the first choice.
 */
export const SHARED_FONT_STACKS: readonly CommandControlOption[] = [
  { value: "Inter, ui-sans-serif, system-ui, sans-serif", label: "Inter", previewFontFamily: "Inter, sans-serif" },
  { value: "Aptos, Calibri, Inter, sans-serif", label: "Aptos", previewFontFamily: "Aptos, Calibri, sans-serif" },
  { value: "Calibri, Carlito, Inter, sans-serif", label: "Calibri", previewFontFamily: "Calibri, Carlito, sans-serif" },
  { value: "Arial, Helvetica, sans-serif", label: "Arial", previewFontFamily: "Arial, Helvetica, sans-serif" },
  { value: "Helvetica Neue, Helvetica, Arial, sans-serif", label: "Helvetica", previewFontFamily: "Helvetica Neue, Helvetica, sans-serif" },
  { value: "Verdana, Geneva, sans-serif", label: "Verdana", previewFontFamily: "Verdana, Geneva, sans-serif" },
  { value: "Tahoma, Verdana, sans-serif", label: "Tahoma", previewFontFamily: "Tahoma, Verdana, sans-serif" },
  { value: "Georgia, Cambria, serif", label: "Georgia", previewFontFamily: "Georgia, Cambria, serif" },
  { value: "Cambria, Caladea, Georgia, serif", label: "Cambria", previewFontFamily: "Cambria, Caladea, Georgia, serif" },
  { value: "Times New Roman, Liberation Serif, Times, serif", label: "Times New Roman", previewFontFamily: "Times New Roman, serif" },
  { value: "Garamond, EB Garamond, Georgia, serif", label: "Garamond", previewFontFamily: "Garamond, Georgia, serif" },
  { value: "Courier New, Courier, monospace", label: "Courier New", previewFontFamily: "Courier New, monospace" },
  { value: "JetBrains Mono, ui-monospace, SFMono-Regular, monospace", label: "JetBrains Mono", previewFontFamily: "JetBrains Mono, monospace" },
];

/** Word's size list, which is what people's fingers already know. */
export const SHARED_FONT_SIZES: readonly number[] = [
  8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 48, 60, 72, 96,
];

/**
 * A restrained palette: greys that read as text, then one row of hues that stay
 * legible on white and on a dark slide. Deliberately not a 200-swatch grid —
 * depth without clutter (D34).
 */
export const SHARED_TEXT_COLORS: readonly string[] = [
  "#101828", "#344054", "#667085", "#98a2b3", "#ffffff",
  "#b42318", "#c4320a", "#b54708", "#a15c07", "#3538cd",
  "#175cd3", "#026aa2", "#027a48", "#5925dc", "#c11574",
];

export const SHARED_HIGHLIGHT_COLORS: readonly string[] = [
  "#fef0c7", "#dff3ed", "#d1e9ff", "#e9d7fe", "#fee4e2",
  "#fcfcfd", "#f2f4f7", "#fdf2fa", "#ecfdf3", "#eff8ff",
];

export const SHARED_LINE_HEIGHTS: readonly CommandControlOption[] = [
  { value: "1", label: "Single" },
  { value: "1.15", label: "1.15" },
  { value: "1.5", label: "1.5" },
  { value: "2", label: "Double" },
];

export type ToggleFacet = {
  active?: boolean;
  toggle: () => void;
};

export type ValueFacet<T> = {
  value?: T;
  set: (value: T) => void;
};

/**
 * What a type must be able to do for a shared formatting control to exist.
 * Every facet is optional: a type gets exactly the controls it can honestly
 * perform, and no ghost appears for the rest.
 */
export type TextFormatAdapter = {
  /** Paragraph or block style — "Normal", "Heading 1", a slide text level. */
  style?: ValueFacet<string> & { options: readonly CommandControlOption[] };
  fontFamily?: ValueFacet<string>;
  fontSize?: ValueFacet<number>;
  bold?: ToggleFacet;
  italic?: ToggleFacet;
  underline?: ToggleFacet;
  strike?: ToggleFacet;
  color?: ValueFacet<string | null>;
  highlight?: ValueFacet<string | null>;
  alignment?: ValueFacet<string>;
  lineHeight?: ValueFacet<number>;
  bulletList?: ToggleFacet;
  numberedList?: ToggleFacet;
  indent?: { increase: () => void; decrease: () => void; canDecrease?: boolean };
  clear?: () => void;
  /** Native regions a formatting write touches for this type. */
  touches?: readonly FidelityRegionKey[];
  /** Whether formatting is currently editable at all. */
  disabled?: boolean;
  /** Controls that belong in General as contract favourites. */
  generalPins?: readonly ("style" | "fontFamily" | "fontSize" | "bold" | "italic")[];
};

const DEFAULT_GENERAL_PINS = ["fontFamily", "fontSize", "bold", "italic"] as const;

/**
 * Builds the formatting command family for one artifact type. Order here is the
 * order in the Format tab, and it is deliberate: what you change most often is
 * leftmost, so the row reads the way a hand moves.
 */
export function textFormatBindings(adapter: TextFormatAdapter): CommandBinding[] {
  const touches = adapter.touches ?? ["styles"];
  const pins = new Set<string>(adapter.generalPins ?? DEFAULT_GENERAL_PINS);
  const disabled = adapter.disabled || undefined;
  const bindings: CommandBinding[] = [];

  if (adapter.style) {
    const style = adapter.style;
    bindings.push({
      id: "format.style",
      label: "Style",
      icon: Type,
      tab: "Format",
      group: "Styles",
      priority: "essential",
      requires: "edit",
      general: pins.has("style"),
      disabled,
      hint: "Paragraph style",
      touches: ["styles"],
      manifestOps: ["format_blocks"],
      control: {
        kind: "select",
        options: style.options,
        value: style.value,
        width: "9.5rem",
      },
      onSelect: (value) => {
        if (typeof value === "string") style.set(value);
      },
    });
  }

  if (adapter.fontFamily) {
    const font = adapter.fontFamily;
    bindings.push({
      id: "format.fontFamily",
      label: "Font",
      icon: Baseline,
      tab: "Format",
      group: "Font",
      priority: "essential",
      requires: "edit",
      general: pins.has("fontFamily"),
      disabled,
      hint: "Font family for the selection",
      touches,
      control: {
        kind: "select",
        options: SHARED_FONT_STACKS,
        value: font.value,
        placeholder: "Font",
        width: "9rem",
      },
      onSelect: (value) => {
        if (typeof value === "string") font.set(value);
      },
    });
  }

  if (adapter.fontSize) {
    const size = adapter.fontSize;
    bindings.push({
      id: "format.fontSize",
      label: "Size",
      icon: Type,
      tab: "Format",
      group: "Font",
      priority: "essential",
      requires: "edit",
      general: pins.has("fontSize"),
      keepLabel: true,
      disabled,
      hint: "Font size in points",
      touches,
      control: {
        kind: "numeric",
        value: size.value,
        min: 4,
        max: 400,
        step: 1,
        presets: SHARED_FONT_SIZES,
      },
      onSelect: (value) => {
        const next = typeof value === "number" ? value : Number(value);
        if (Number.isFinite(next)) size.set(Math.min(400, Math.max(4, next)));
      },
    });
  }

  const marks: Array<[string, string, typeof Bold, ToggleFacet | undefined, string, boolean]> = [
    ["format.bold", "Bold", Bold, adapter.bold, "Mod+B", pins.has("bold")],
    ["format.italic", "Italic", Italic, adapter.italic, "Mod+I", pins.has("italic")],
    ["format.underline", "Underline", Underline, adapter.underline, "Mod+U", false],
    ["format.strike", "Strikethrough", Strikethrough, adapter.strike, "Mod+Shift+X", false],
  ];
  for (const [id, label, icon, facet, shortcut, general] of marks) {
    if (!facet) continue;
    bindings.push({
      id,
      label,
      icon,
      tab: "Format",
      group: "Font",
      priority: "essential",
      requires: "edit",
      general,
      disabled,
      shortcut,
      active: facet.active ?? false,
      touches,
      onSelect: () => facet.toggle(),
    });
  }

  if (adapter.color) {
    const color = adapter.color;
    bindings.push({
      id: "format.color",
      label: "Text colour",
      icon: PaintBucket,
      tab: "Format",
      group: "Font",
      priority: "secondary",
      requires: "edit",
      disabled,
      hint: "Colour of the selected text",
      touches,
      control: {
        kind: "color",
        value: color.value ?? undefined,
        swatches: SHARED_TEXT_COLORS,
        clearLabel: "Automatic",
      },
      onSelect: (value) => color.set(typeof value === "string" ? value : null),
    });
  }

  if (adapter.highlight) {
    const highlight = adapter.highlight;
    bindings.push({
      id: "format.highlight",
      label: "Highlight",
      icon: Highlighter,
      tab: "Format",
      group: "Font",
      priority: "secondary",
      requires: "edit",
      disabled,
      hint: "Highlight the selection",
      touches,
      control: {
        kind: "color",
        value: highlight.value ?? undefined,
        swatches: SHARED_HIGHLIGHT_COLORS,
        clearLabel: "No highlight",
      },
      onSelect: (value) => highlight.set(typeof value === "string" ? value : null),
    });
  }

  if (adapter.alignment) {
    const alignment = adapter.alignment;
    bindings.push({
      id: "format.align",
      label: "Alignment",
      icon: AlignLeft,
      tab: "Format",
      group: "Paragraph",
      priority: "essential",
      requires: "edit",
      disabled,
      touches,
      control: {
        kind: "segmented",
        value: alignment.value ?? "left",
        options: [
          { value: "left", label: "Left", icon: AlignLeft },
          { value: "center", label: "Centre", icon: AlignCenter },
          { value: "right", label: "Right", icon: AlignRight },
          { value: "justify", label: "Justify", icon: AlignJustify },
        ],
      },
      onSelect: (value) => {
        if (typeof value === "string") alignment.set(value);
      },
    });
  }

  if (adapter.lineHeight) {
    const lineHeight = adapter.lineHeight;
    bindings.push({
      id: "format.lineSpacing",
      label: "Line spacing",
      icon: AlignJustify,
      tab: "Format",
      group: "Paragraph",
      priority: "secondary",
      requires: "edit",
      disabled,
      touches,
      control: {
        kind: "menu",
        options: SHARED_LINE_HEIGHTS,
        value: lineHeight.value ? String(lineHeight.value) : undefined,
      },
      onSelect: (value) => {
        const next = Number(value);
        if (Number.isFinite(next)) lineHeight.set(next);
      },
    });
  }

  if (adapter.bulletList) {
    const list = adapter.bulletList;
    bindings.push({
      id: "format.list.bullet",
      label: "Bulleted list",
      icon: List,
      tab: "Format",
      group: "Lists",
      priority: "essential",
      requires: "edit",
      disabled,
      active: list.active ?? false,
      touches: ["lists"],
      onSelect: () => list.toggle(),
    });
  }

  if (adapter.numberedList) {
    const list = adapter.numberedList;
    bindings.push({
      id: "format.list.numbered",
      label: "Numbered list",
      icon: ListOrdered,
      tab: "Format",
      group: "Lists",
      priority: "essential",
      requires: "edit",
      disabled,
      active: list.active ?? false,
      touches: ["lists"],
      onSelect: () => list.toggle(),
    });
  }

  if (adapter.indent) {
    const indent = adapter.indent;
    bindings.push(
      {
        id: "format.indent.increase",
        label: "Increase indent",
        icon: Indent,
        tab: "Format",
        group: "Paragraph",
        priority: "secondary",
        requires: "edit",
        disabled,
        touches,
        onSelect: () => indent.increase(),
      },
      {
        id: "format.indent.decrease",
        label: "Decrease indent",
        icon: Outdent,
        tab: "Format",
        group: "Paragraph",
        priority: "secondary",
        requires: "edit",
        disabled: disabled || indent.canDecrease === false || undefined,
        touches,
        onSelect: () => indent.decrease(),
      },
    );
  }

  if (adapter.clear) {
    const clear = adapter.clear;
    bindings.push({
      id: "format.clear",
      label: "Clear formatting",
      icon: Eraser,
      tab: "Format",
      group: "Font",
      priority: "secondary",
      requires: "edit",
      disabled,
      hint: "Return the selection to its style default",
      touches,
      onSelect: () => clear(),
    });
  }

  return bindings;
}
