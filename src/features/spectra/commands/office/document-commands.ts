import {
  AlertTriangle,
  AlignLeft,
  BookMarked,
  BookOpen,
  Braces,
  Check,
  ChevronDown,
  ChevronUp,
  Code2,
  Columns2,
  Columns3,
  Copy,
  Eye,
  File,
  FileText,
  Focus,
  Frame,
  Heading,
  Heading1,
  Heading2,
  Heading3,
  History,
  Image as ImageIcon,
  Indent,
  Info,
  LayoutTemplate,
  Lightbulb,
  Link2,
  Link2Off,
  ListChecks,
  ListOrdered,
  ListTree,
  Maximize2,
  Merge,
  MessageSquare,
  Minimize2,
  Minus,
  Outdent,
  PaintBucket,
  PanelBottom,
  PanelLeft,
  PanelTop,
  Pencil,
  Pilcrow,
  Plus,
  Quote,
  RefreshCw,
  Rows3,
  SeparatorHorizontal,
  Sigma,
  SpellCheck,
  Split,
  Square,
  SquareCode,
  SquareSplitVertical,
  SquareX,
  Superscript,
  Table as TableIcon,
  Text,
  TextCursorInput,
  TextQuote,
  Trash2,
  WrapText,
  X,
} from "lucide-react";
import {
  commentsBinding,
  exportBindings,
  findBindings,
  historyBindings,
  importBinding,
  printBinding,
  textFormatBindings,
  type CommentsAdapter,
  type ExportAdapter,
  type FindAdapter,
  type HistoryAdapter,
  type ImportAdapter,
  type TextFormatAdapter,
  type ToggleFacet,
} from "../shared";
import {
  DOCUMENT_EXPORT_COPIES,
  DOCUMENT_NATIVE_REASONS,
  projectBindingsFromIr,
} from "../../capabilities";
import type { CommandBinding, CommandControlOption } from "../types";

/**
 * The Document command set.
 *
 * Everything a person can do to a document is declared here, once, as a pure
 * function of the studio's handlers. That is the point: before this module the
 * format bar called TipTap directly, the slash menu called TipTap directly, and
 * the workbar carried a third, smaller vocabulary — so a verb could exist three
 * times with three behaviours, none of them reachable by the AI, a shortcut, or
 * the customizer (C1).
 *
 * The rules this file follows:
 *
 *   One id, one implementation. `onSelect` is the only place a verb happens.
 *   Ids never change. `format.bold` becomes `document.format.bold` once and
 *   stays there, whatever tab it is later moved to.
 *   No ghosts. A control appears only when the studio supplied a handler that
 *   can honestly perform it, and a command that writes a region the linked Word
 *   file only *preserves* declares that region so the shared availability path
 *   disables it with a real reason.
 *   Shared families come from `commands/shared`. History, find, formatting,
 *   comments, export and import are written once for all three editors; this
 *   module supplies only the document's adapter and its placement.
 */

/** Paragraph styles offered when the artifact carries no named-style set. */
export const DOCUMENT_STYLE_OPTIONS: readonly CommandControlOption[] = [
  { value: "paragraph", label: "Body text", icon: Pilcrow },
  { value: "h1", label: "Heading 1", icon: Heading1 },
  { value: "h2", label: "Heading 2", icon: Heading2 },
  { value: "h3", label: "Heading 3", icon: Heading3 },
  { value: "quote", label: "Quotation", icon: Quote },
  { value: "code", label: "Code block", icon: SquareCode },
];

/** Paper sizes Spectra can lay out and print truthfully. */
export const DOCUMENT_PAGE_SIZES: readonly CommandControlOption[] = [
  { value: "a4", label: "A4", icon: FileText },
  { value: "letter", label: "Letter", icon: FileText },
  { value: "legal", label: "Legal", icon: FileText },
  { value: "a5", label: "A5", icon: File },
];

export const DOCUMENT_MARGIN_PRESETS: readonly CommandControlOption[] = [
  { value: "narrow", label: "Narrow · 12 mm", icon: Minimize2 },
  { value: "normal", label: "Normal · 25 mm", icon: Square },
  { value: "wide", label: "Wide · 40 mm", icon: Maximize2 },
];

/** Space after a paragraph, in points — Word's own ladder. */
export const DOCUMENT_PARAGRAPH_SPACING: readonly number[] = [0, 4, 6, 8, 12, 18, 24];

export const DOCUMENT_BORDER_OPTIONS: readonly CommandControlOption[] = [
  { value: "none", label: "No border", icon: SquareX },
  { value: "all", label: "Box", icon: Square },
  { value: "top", label: "Line above", icon: PanelTop },
  { value: "bottom", label: "Line below", icon: PanelBottom },
  { value: "left", label: "Line at left", icon: PanelLeft },
];

export const DOCUMENT_SHADING_COLORS: readonly string[] = [
  "#f2f4f7", "#eff8ff", "#ecfdf3", "#fef0c7", "#fee4e2", "#f4f3ff",
];

export const DOCUMENT_IMAGE_WRAP: readonly CommandControlOption[] = [
  { value: "inline", label: "In line with text", icon: TextCursorInput },
  { value: "left", label: "Wrap left", icon: WrapText },
  { value: "right", label: "Wrap right", icon: WrapText },
  { value: "break", label: "Break text", icon: SeparatorHorizontal },
];

/**
 * The contract's General favourites for Document (§2). The matrix test asserts
 * these are present, so the list lives beside the bindings that satisfy it.
 */
export const DOCUMENT_GENERAL_DEFAULTS: readonly string[] = [
  "document.navigate.find",
  "document.history.undo",
  "document.history.redo",
  "document.navigate.outline",
  "document.review.comments",
  "document.format.fontFamily",
  "document.format.fontSize",
  "document.format.bold",
  "document.format.italic",
];

/** A toggle the studio can honestly perform, with its live state. */
export type DocumentToggle = ToggleFacet;

export type DocumentOutlineHandlers = {
  toggle: () => void;
  open?: boolean;
  /** Heading count, so the hint can say what the rail would show. */
  headings?: number;
};

export type DocumentParagraphHandlers = {
  /** Space after the paragraph, in points. */
  spacingAfter?: number;
  setSpacingAfter: (points: number) => void;
  border?: string;
  setBorder: (kind: string) => void;
  shading?: string | null;
  setShading: (color: string | null) => void;
  quote: DocumentToggle;
  codeBlock: DocumentToggle;
  inlineCode: DocumentToggle;
  /** Multilevel lists: nesting the current item, and lifting it back out. */
  inList?: boolean;
  listLevel?: number;
  demote: () => void;
  promote: () => void;
  canPromote?: boolean;
  /** Reorders the block itself, the way Alt+Shift+↑ does in Word. */
  moveUp: () => void;
  moveDown: () => void;
};

export type DocumentNamedStyleHandlers = {
  options?: readonly CommandControlOption[];
  apply: (styleId: string) => void;
  /** Captures the current formatting as a new named style. */
  create?: () => void;
  createHint?: string;
};

export type DocumentCommandHandlers = {
  /** False for a reader, or when the document is open in a read mode. */
  editable: boolean;
  history: HistoryAdapter;
  find: FindAdapter;
  comments: CommentsAdapter;
  /** Character and paragraph formatting the document can honestly perform. */
  format: TextFormatAdapter;
  paragraph: DocumentParagraphHandlers;
  namedStyles: DocumentNamedStyleHandlers;
  outline: DocumentOutlineHandlers;
  spellcheck: DocumentToggle;
  insert: DocumentInsertHandlers;
  table: DocumentTableHandlers;
  image: DocumentImageHandlers;
  equation: DocumentEquationHandlers;
  page: DocumentPageHandlers;
  references: DocumentReferenceHandlers;
  review: DocumentReviewHandlers;
  /** Export copies. Never the sync path — a linked file is never replaced. */
  exportCopies: ExportAdapter;
  importCopy: ImportAdapter;
  print: () => void;
};

/**
 * Placement patch applied to a shared family's bindings.
 *
 * The shared factories decide what a verb *is*; each type decides where it
 * lives and how hard it fights for bar space. Document has ten General
 * favourites and only five may be `essential`, so the pins that are controls
 * (Font, Size) and the two rails (Outline, Comments) ride at `secondary` and
 * shed into the overflow menu together at tight density.
 */
type Placement = Partial<
  Pick<
    CommandBinding,
    "priority" | "tab" | "group" | "general" | "touches" | "hint" | "manifestOps" | "keepLabel"
  >
>;

function placed(
  bindings: readonly CommandBinding[],
  placements: Readonly<Record<string, Placement>>,
): CommandBinding[] {
  return bindings.map((binding) => {
    const patch = placements[binding.id];
    return patch ? { ...binding, ...patch } : binding;
  });
}

/**
 * History, find/replace and the formatting family, in the order the Document
 * work bar reads them.
 */
function foundationBindings(handlers: DocumentCommandHandlers): CommandBinding[] {
  const bindings: CommandBinding[] = [
    ...historyBindings(handlers.history),
    ...findBindings(handlers.find),
    {
      id: "navigate.outline",
      label: "Outline",
      icon: ListTree,
      priority: "secondary",
      general: true,
      active: handlers.outline.open,
      hint: handlers.outline.headings
        ? `${handlers.outline.headings} heading${handlers.outline.headings === 1 ? "" : "s"}`
        : "Add headings to navigate long documents",
      undo: "none(explain)",
      manifestOps: ["inspect_outline"],
      onSelect: () => handlers.outline.toggle(),
    },
    // Spectra comment threads are Spectra's own; they are never written into
    // the Word package, so this command declares no native region. When the
    // linked file carries Word comments the adapter says so in the hint, which
    // is the honest statement — not a disabled button.
    { ...commentsBinding(handlers.comments), touches: undefined },
    // General is the document's Home: the formatting used every few seconds is
    // on it as well as on Format.
    ...textFormatBindings("document", {
      ...handlers.format,
      generalPins: ["fontFamily", "fontSize", "bold", "italic", "underline", "strike", "color", "highlight", "alignment"],
    }),
  ];
  return placed(bindings, {
    "format.underline": { priority: "secondary" },
    "format.strike": { priority: "secondary" },
    "format.align": { priority: "secondary" },
    "format.fontFamily": {
      priority: "secondary",
      keepLabel: true,
    },
    "format.fontSize": { priority: "secondary" },
  });
}

/** Paragraph shape: spacing, borders, shading, quotes, code, list depth. */
function paragraphBindings(handlers: DocumentCommandHandlers): CommandBinding[] {
  const paragraph = handlers.paragraph;
  const disabled = !handlers.editable || undefined;
  return [
    {
      id: "format.paragraphSpacing",
      label: "Paragraph spacing",
      icon: Rows3,
      tab: "Format",
      group: "Paragraph",
      priority: "secondary",
      requires: "edit",
      disabled,
      hint: "Space after this paragraph, in points",
      touches: ["body"],
      manifestOps: ["format_blocks"],
      control: {
        kind: "numeric",
        value: paragraph.spacingAfter ?? 0,
        min: 0,
        max: 96,
        step: 2,
        suffix: "pt",
        presets: DOCUMENT_PARAGRAPH_SPACING,
      },
      onSelect: (value) => {
        const next = typeof value === "number" ? value : Number(value);
        if (Number.isFinite(next)) paragraph.setSpacingAfter(Math.min(96, Math.max(0, next)));
      },
    },
    {
      id: "format.border",
      label: "Borders",
      icon: Frame,
      tab: "Format",
      group: "Paragraph",
      priority: "secondary",
      requires: "edit",
      disabled,
      hint: "Rule above, below or around this paragraph",
      touches: ["body"],
      manifestOps: ["format_blocks"],
      control: {
        kind: "menu",
        options: DOCUMENT_BORDER_OPTIONS,
        value: paragraph.border ?? "none",
      },
      onSelect: (value) => {
        if (typeof value === "string") paragraph.setBorder(value);
      },
    },
    {
      id: "format.shading",
      label: "Shading",
      icon: PaintBucket,
      tab: "Format",
      group: "Paragraph",
      priority: "secondary",
      requires: "edit",
      disabled,
      hint: "Background fill behind this paragraph",
      touches: ["body"],
      manifestOps: ["format_blocks"],
      control: {
        kind: "color",
        value: paragraph.shading ?? undefined,
        swatches: DOCUMENT_SHADING_COLORS,
        clearLabel: "No fill",
      },
      onSelect: (value) => paragraph.setShading(typeof value === "string" ? value : null),
    },
    {
      id: "format.quote",
      label: "Quotation",
      icon: Quote,
      tab: "Format",
      group: "Blocks",
      priority: "secondary",
      requires: "edit",
      disabled,
      active: paragraph.quote.active ?? false,
      hint: "Set the paragraph as a quotation",
      touches: ["styles"],
      manifestOps: ["format_blocks"],
      onSelect: () => paragraph.quote.toggle(),
    },
    {
      id: "format.code.inline",
      label: "Inline code",
      icon: Code2,
      tab: "Format",
      group: "Blocks",
      priority: "secondary",
      requires: "edit",
      disabled,
      active: paragraph.inlineCode.active ?? false,
      hint: "Mark the selection as code",
      touches: ["body"],
      manifestOps: ["format_blocks"],
      onSelect: () => paragraph.inlineCode.toggle(),
    },
    {
      id: "format.code.block",
      label: "Code block",
      icon: Braces,
      tab: "Format",
      group: "Blocks",
      priority: "secondary",
      requires: "edit",
      disabled,
      active: paragraph.codeBlock.active ?? false,
      hint: "A whole block of preformatted code",
      touches: ["styles"],
      manifestOps: ["format_blocks"],
      onSelect: () => paragraph.codeBlock.toggle(),
    },
    {
      id: "format.list.demote",
      label: "Nest list item",
      icon: Indent,
      tab: "Format",
      group: "Lists",
      priority: "secondary",
      requires: "edit",
      disabled: disabled || paragraph.inList === false || undefined,
      hint:
        paragraph.listLevel && paragraph.listLevel > 1
          ? `Level ${paragraph.listLevel} — nest one deeper`
          : "Make this item a sub-item of the one above",
      touches: ["lists"],
      manifestOps: ["format_blocks"],
      onSelect: () => paragraph.demote(),
    },
    {
      id: "format.list.promote",
      label: "Lift list item",
      icon: Outdent,
      tab: "Format",
      group: "Lists",
      priority: "secondary",
      requires: "edit",
      disabled: disabled || paragraph.canPromote === false || undefined,
      hint: "Lift this item back out one level",
      touches: ["lists"],
      manifestOps: ["format_blocks"],
      onSelect: () => paragraph.promote(),
    },
    {
      id: "format.block.moveUp",
      label: "Move up",
      icon: ChevronUp,
      tab: "Format",
      group: "Order",
      priority: "secondary",
      requires: "edit",
      disabled,
      shortcut: "Alt+Shift+ArrowUp",
      hint: "Moves this block above the one before it, keeping its comments and history",
      touches: ["body"],
      manifestOps: ["move_blocks"],
      onSelect: () => paragraph.moveUp(),
    },
    {
      id: "format.block.moveDown",
      label: "Move down",
      icon: ChevronDown,
      tab: "Format",
      group: "Order",
      priority: "secondary",
      requires: "edit",
      disabled,
      shortcut: "Alt+Shift+ArrowDown",
      hint: "Moves this block below the one after it, keeping its comments and history",
      touches: ["body"],
      manifestOps: ["move_blocks"],
      onSelect: () => paragraph.moveDown(),
    },
    {
      id: "format.namedStyle.apply",
      label: "Named style",
      icon: Heading,
      tab: "Format",
      group: "Styles",
      priority: "secondary",
      requires: "edit",
      disabled: disabled || !handlers.namedStyles.options?.length || undefined,
      hint: handlers.namedStyles.options?.length
        ? "Apply a style this document already defines"
        : "This document defines no extra named styles yet",
      touches: ["styles"],
      manifestOps: ["format_blocks"],
      control: {
        kind: "select",
        options: handlers.namedStyles.options ?? [],
        placeholder: "Named style",
        width: "10rem",
      },
      onSelect: (value) => {
        if (typeof value === "string") handlers.namedStyles.apply(value);
      },
    },
    ...(handlers.namedStyles.create
      ? [
          {
            id: "format.namedStyle.create",
            label: "Save as named style",
            icon: Copy,
            tab: "Format",
            group: "Styles",
            priority: "advanced" as const,
            requires: "edit" as const,
            disabled,
            hint:
              handlers.namedStyles.createHint ??
              "Keeps the current formatting as a style you can reapply",
            touches: ["styles"] as const,
            onSelect: () => handlers.namedStyles.create?.(),
          },
        ]
      : []),
    {
      id: "review.spellcheck",
      label: "Spell check",
      icon: SpellCheck,
      tab: "Format",
      group: "Proofing",
      priority: "advanced",
      disabled,
      active: handlers.spellcheck.active ?? false,
      hint: "Uses your browser's dictionary; nothing is sent to a server",
      undo: "none(explain)",
      onSelect: () => handlers.spellcheck.toggle(),
    },
  ];
}

export type DocumentInsertHandlers = {
  table: () => void;
  image: () => void;
  /** Opens the link editor for the current selection. */
  link: () => void;
  linkActive?: boolean;
  unlink: () => void;
  equationBlock: () => void;
  equationInline: () => void;
  callout: (kind: "info" | "warning" | "tip") => void;
  divider: () => void;
  taskList: () => void;
  taskListActive?: boolean;
  /** Places another Spectra work as a live reference rather than a copy. */
  reference: () => void;
  citation: () => void;
  citationHint?: string;
  footnote: () => void;
  endnote: () => void;
  pageBreak: () => void;
  sectionBreak: () => void;
  /** A styled caption paragraph under the selected image or table. */
  caption: () => void;
  tableOfContents: () => void;
};

/**
 * Insert.
 *
 * Every entry here is also a slash-menu entry: the menu renders from these
 * bindings, so `/table` and the Insert tab run the same command, and a change
 * to one is a change to both.
 */
function insertBindings(handlers: DocumentCommandHandlers): CommandBinding[] {
  const insert = handlers.insert;
  const disabled = !handlers.editable || undefined;
  const callouts = (["info", "warning", "tip"] as const).map((kind) => ({
    id: `insert.callout.${kind}`,
    label:
      kind === "info"
        ? "Info callout"
        : kind === "warning"
          ? "Warning callout"
          : "Tip callout",
    icon: kind === "warning" ? AlertTriangle : kind === "tip" ? Lightbulb : Info,
    tab: "Insert",
    group: "Callouts",
    priority: "advanced" as const,
    requires: "edit" as const,
    disabled,
    hint: "A Spectra callout. An exported Word copy keeps the text as an indented block.",
    touches: ["body"] as const,
    manifestOps: ["insert_callout"] as const,
    onSelect: () => insert.callout(kind),
  }));
  return [
    {
      id: "insert.table",
      label: "Table",
      icon: TableIcon,
      tab: "Insert",
      group: "Tables",
      priority: "essential",
      requires: "edit",
      disabled,
      hint: "A three-by-three table with a header row",
      touches: ["tableStructure"],
      manifestOps: ["create_table"],
      onSelect: () => insert.table(),
    },
    {
      id: "insert.image",
      label: "Image",
      icon: ImageIcon,
      tab: "Insert",
      group: "Media",
      priority: "essential",
      requires: "edit",
      disabled,
      hint: "Place a picture from this device",
      touches: ["images"],
      onSelect: () => insert.image(),
    },
    {
      id: "insert.link",
      label: "Link",
      icon: Link2,
      tab: "Insert",
      group: "Links",
      priority: "essential",
      requires: "edit",
      disabled,
      shortcut: "Mod+K",
      active: insert.linkActive ?? false,
      hint: "Link the selected text to a web address",
      touches: ["hyperlinks"],
      onSelect: () => insert.link(),
    },
    ...(insert.linkActive
      ? [
          {
            id: "insert.link.remove",
            label: "Remove link",
            icon: Link2Off,
            tab: "Insert",
            group: "Links",
            priority: "secondary" as const,
            requires: "edit" as const,
            hint: "Keeps the text, drops the address",
            touches: ["hyperlinks"] as const,
            onSelect: () => insert.unlink(),
          },
        ]
      : []),
    {
      id: "insert.equation",
      label: "Equation",
      icon: Sigma,
      tab: "Insert",
      group: "Math",
      priority: "essential",
      requires: "edit",
      disabled,
      hint: "A LaTeX equation on its own line",
      touches: ["equations"],
      nativeDelta: "insert-paragraph",
      manifestOps: ["insert_equation"],
      onSelect: () => insert.equationBlock(),
    },
    {
      id: "insert.equation.inline",
      label: "Inline equation",
      icon: Superscript,
      tab: "Insert",
      group: "Math",
      priority: "secondary",
      requires: "edit",
      disabled,
      hint: "A LaTeX equation inside the sentence",
      touches: ["equations"],
      nativeDelta: "replace-paragraph",
      manifestOps: ["insert_equation"],
      onSelect: () => insert.equationInline(),
    },
    {
      id: "insert.pageBreak",
      label: "Page break",
      icon: SquareSplitVertical,
      tab: "Insert",
      group: "Breaks",
      priority: "essential",
      requires: "edit",
      disabled,
      hint: "Starts what follows on a new page",
      touches: ["sections"],
      manifestOps: ["insert_blocks"],
      onSelect: () => insert.pageBreak(),
    },
    {
      id: "insert.sectionBreak",
      label: "Section break",
      icon: Columns3,
      tab: "Insert",
      group: "Breaks",
      priority: "secondary",
      requires: "edit",
      disabled,
      hint: "Starts a section that can carry its own page setup",
      touches: ["sections"],
      manifestOps: ["insert_blocks"],
      onSelect: () => insert.sectionBreak(),
    },
    {
      id: "insert.divider",
      label: "Divider",
      icon: Minus,
      tab: "Insert",
      group: "Blocks",
      priority: "secondary",
      requires: "edit",
      disabled,
      hint: "A horizontal rule between passages",
      touches: ["body"],
      manifestOps: ["insert_blocks"],
      onSelect: () => insert.divider(),
    },
    {
      id: "insert.taskList",
      label: "Task list",
      icon: ListChecks,
      tab: "Insert",
      group: "Lists",
      priority: "secondary",
      requires: "edit",
      disabled,
      active: insert.taskListActive ?? false,
      hint: "A checklist. Word has no native checkbox, so an exported copy keeps the text and loses the tick.",
      touches: ["lists"],
      manifestOps: ["insert_blocks"],
      onSelect: () => insert.taskList(),
    },
    ...callouts,
    {
      id: "insert.reference",
      label: "Reference a work",
      icon: Link2,
      tab: "Insert",
      group: "Media",
      priority: "advanced",
      requires: "edit",
      disabled,
      hint: "Shows another Spectra work here without copying it",
      manifestOps: ["add_embed"],
      strictNative: {
        available: false,
        reason:
          "A live Spectra reference cannot be represented in a Word file, so it stays unavailable while the original is linked.",
      },
      onSelect: () => insert.reference(),
    },
    {
      id: "insert.citation",
      label: "Citation",
      icon: BookMarked,
      tab: "Insert",
      group: "References",
      priority: "secondary",
      requires: "edit",
      disabled,
      hint: insert.citationHint ?? "Cites a source this document carries",
      touches: ["body"],
      manifestOps: ["add_citation"],
      onSelect: () => insert.citation(),
    },
    {
      id: "insert.footnote",
      label: "Footnote",
      icon: PanelBottom,
      tab: "Insert",
      group: "References",
      priority: "secondary",
      requires: "edit",
      disabled,
      hint: "A numbered note at the foot of the page",
      touches: ["footnotes"],
      manifestOps: ["insert_blocks"],
      onSelect: () => insert.footnote(),
    },
    {
      id: "insert.endnote",
      label: "Endnote",
      icon: PanelTop,
      tab: "Insert",
      group: "References",
      priority: "advanced",
      requires: "edit",
      disabled,
      hint: "A numbered note collected at the end of the document",
      touches: ["footnotes"],
      manifestOps: ["insert_blocks"],
      onSelect: () => insert.endnote(),
    },
    {
      id: "insert.caption",
      label: "Caption",
      icon: TextQuote,
      tab: "Insert",
      group: "References",
      priority: "advanced",
      requires: "edit",
      disabled,
      hint: "A styled caption paragraph. It is text, not a Word SEQ field, so it does not renumber itself.",
      touches: ["body"],
      manifestOps: ["insert_blocks"],
      onSelect: () => insert.caption(),
    },
    {
      id: "insert.toc",
      label: "Table of contents",
      icon: ListTree,
      tab: "Insert",
      group: "References",
      priority: "advanced",
      requires: "edit",
      disabled,
      hint: "Lists the headings as they are now. It is content, not a Word TOC field, so it does not refresh itself.",
      touches: ["fields"],
      manifestOps: ["insert_blocks"],
      onSelect: () => insert.tableOfContents(),
    },
  ];
}

export type DocumentTableHandlers = {
  /** True when the caret is inside a table; drives the contextual tab. */
  active: boolean;
  addRowBefore: () => void;
  addRowAfter: () => void;
  deleteRow: () => void;
  addColumnBefore: () => void;
  addColumnAfter: () => void;
  deleteColumn: () => void;
  mergeCells: () => void;
  splitCell: () => void;
  canMerge?: boolean;
  canSplit?: boolean;
  toggleHeaderRow: () => void;
  headerRowActive?: boolean;
  deleteTable: () => void;
  /**
   * Why a structural change cannot be written to the linked package. Set for a
   * mounted Word file: the lens rewrites cell text safely but cannot yet prove
   * a row or column change leaves the surrounding grid valid.
   */
  nativeStructureReason?: string;
};

export type DocumentImageHandlers = {
  active: boolean;
  wrap?: string;
  setWrap: (wrap: string) => void;
  /** Display width as a percentage of the text column. */
  width?: number;
  setWidth: (percent: number) => void;
  alt?: string;
  editAlt: () => void;
  replace: () => void;
  remove: () => void;
};

export type DocumentEquationHandlers = {
  active: boolean;
  display?: "inline" | "block";
  setDisplay: (display: string) => void;
  alignment?: string;
  setAlignment: (alignment: string) => void;
  edit: () => void;
  remove: () => void;
};

/**
 * The three contextual tabs.
 *
 * A contextual tab exists because the selection changed, so its commands are
 * declared with `contextualTab` and are absent — not greyed — until the caret is
 * actually in a table, an image or an equation. Table structure carries the one
 * honest exception in this file: on a mounted Word file the row and column verbs
 * are disabled with the lens's own reason, because Spectra can rewrite cell text
 * safely but cannot yet prove a topology change keeps the grid valid.
 */
function tableBindings(handlers: DocumentCommandHandlers): CommandBinding[] {
  const table = handlers.table;
  if (!table.active) return [];
  const structural = table.nativeStructureReason
    ? { available: false, reason: DOCUMENT_NATIVE_REASONS.tableStructure }
    : undefined;
  const structure = (
    id: string,
    label: string,
    icon: CommandBinding["icon"],
    run: () => void,
    hint: string,
    extra?: Partial<CommandBinding>,
  ): CommandBinding => ({
    id,
    label,
    icon,
    contextualTab: "Table",
    group: "Structure",
    priority: "essential",
    requires: "edit",
    hint,
    touches: ["tableStructure"],
    ...(structural ? { strictNative: structural } : {}),
    ...extra,
    onSelect: run,
  });
  return [
    structure("table.row.after", "Row below", Plus, () => table.addRowAfter(), "Adds a row under the caret"),
    structure("table.column.after", "Column right", Plus, () => table.addColumnAfter(), "Adds a column to the right"),
    structure("table.row.before", "Row above", Plus, () => table.addRowBefore(), "Adds a row over the caret", {
      priority: "secondary",
    }),
    structure("table.column.before", "Column left", Plus, () => table.addColumnBefore(), "Adds a column to the left", {
      priority: "secondary",
    }),
    structure("table.merge", "Merge cells", Merge, () => table.mergeCells(), "Joins the selected cells into one", {
      priority: "essential",
      disabled: table.canMerge === false || undefined,
    }),
    structure("table.split", "Split cell", Split, () => table.splitCell(), "Returns a merged cell to separate cells", {
      priority: "essential",
      disabled: table.canSplit === false || undefined,
    }),
    structure("table.headerRow", "Header row", Rows3, () => table.toggleHeaderRow(), "Treats the first row as headings", {
      priority: "secondary",
      active: table.headerRowActive ?? false,
    }),
    structure("table.row.delete", "Delete row", Minus, () => table.deleteRow(), "Removes the row the caret is in", {
      priority: "secondary",
      risk: "confirm",
    }),
    structure("table.column.delete", "Delete column", Minus, () => table.deleteColumn(), "Removes the column the caret is in", {
      priority: "secondary",
      risk: "confirm",
    }),
    structure("table.delete", "Delete table", Trash2, () => table.deleteTable(), "Removes the whole table and its contents", {
      priority: "advanced",
      risk: "destructive",
    }),
  ];
}

function imageBindings(handlers: DocumentCommandHandlers): CommandBinding[] {
  const image = handlers.image;
  if (!image.active) return [];
  return [
    {
      id: "image.wrap",
      label: "Text wrapping",
      icon: AlignLeft,
      contextualTab: "Image",
      group: "Arrange",
      priority: "essential",
      requires: "edit",
      hint: "How the text flows around this picture",
      touches: ["images"],
      control: {
        kind: "select",
        options: DOCUMENT_IMAGE_WRAP,
        value: image.wrap ?? "inline",
        width: "10.5rem",
      },
      onSelect: (value) => {
        if (typeof value === "string") image.setWrap(value);
      },
    },
    {
      id: "image.width",
      label: "Width",
      icon: Frame,
      contextualTab: "Image",
      group: "Arrange",
      priority: "essential",
      requires: "edit",
      hint: "Width as a percentage of the text column",
      touches: ["images"],
      control: {
        kind: "numeric",
        value: image.width ?? 100,
        min: 10,
        max: 100,
        step: 5,
        suffix: "%",
        presets: [25, 33, 50, 66, 75, 100],
      },
      onSelect: (value) => {
        const next = typeof value === "number" ? value : Number(value);
        if (Number.isFinite(next)) image.setWidth(Math.min(100, Math.max(10, next)));
      },
    },
    {
      id: "image.alt",
      label: "Alternative text",
      icon: Text,
      contextualTab: "Image",
      group: "Accessibility",
      priority: "essential",
      requires: "edit",
      hint: image.alt
        ? `Described as "${image.alt.slice(0, 48)}"`
        : "No description yet — screen readers will skip this picture",
      touches: ["images"],
      onSelect: () => image.editAlt(),
    },
    {
      id: "image.replace",
      label: "Replace picture",
      icon: ImageIcon,
      contextualTab: "Image",
      group: "Arrange",
      priority: "secondary",
      requires: "edit",
      risk: "confirm",
      hint: "Choose another PNG or JPEG for this picture",
      touches: ["images"],
      onSelect: () => image.replace(),
    },
    {
      id: "image.caption",
      label: "Add caption",
      icon: TextQuote,
      contextualTab: "Image",
      group: "Accessibility",
      priority: "secondary",
      requires: "edit",
      hint: "A styled caption paragraph under the picture",
      touches: ["body"],
      onSelect: () => handlers.insert.caption(),
    },
    {
      id: "image.remove",
      label: "Delete image",
      icon: Trash2,
      contextualTab: "Image",
      group: "Arrange",
      priority: "advanced",
      requires: "edit",
      risk: "confirm",
      hint: "Removes the picture from the document",
      touches: ["images"],
      nativeDelta: "delete-image",
      onSelect: () => image.remove(),
    },
  ];
}

function equationBindings(handlers: DocumentCommandHandlers): CommandBinding[] {
  const equation = handlers.equation;
  if (!equation.active) return [];
  return [
    {
      id: "equation.edit",
      capabilityId: "document.equation.edit",
      label: "Edit equation",
      icon: Sigma,
      contextualTab: "Equation",
      group: "Math",
      priority: "essential",
      requires: "edit",
      hint: "Opens the LaTeX source for this equation",
      touches: ["equations"],
      nativeDelta: "replace-paragraph",
      onSelect: () => equation.edit(),
    },
    {
      id: "equation.display",
      label: "Placement",
      icon: Superscript,
      contextualTab: "Equation",
      group: "Math",
      priority: "essential",
      requires: "edit",
      hint: "In the sentence, or on its own line",
      touches: ["equations"],
      nativeDelta: "set-equation-layout",
      control: {
        kind: "segmented",
        value: equation.display ?? "block",
        options: [
          { value: "inline", label: "Inline" },
          { value: "block", label: "Own line" },
        ],
      },
      onSelect: (value) => {
        if (typeof value === "string") equation.setDisplay(value);
      },
    },
    {
      id: "equation.align",
      label: "Alignment",
      icon: AlignLeft,
      contextualTab: "Equation",
      group: "Math",
      priority: "secondary",
      requires: "edit",
      hint: "Where the equation sits across the column",
      touches: ["equations"],
      nativeDelta: "set-equation-layout",
      control: {
        kind: "segmented",
        value: equation.alignment ?? "center",
        options: [
          { value: "left", label: "Left" },
          { value: "center", label: "Centre" },
          { value: "right", label: "Right" },
        ],
      },
      onSelect: (value) => {
        if (typeof value === "string") equation.setAlignment(value);
      },
    },
    {
      id: "equation.remove",
      label: "Delete equation",
      icon: Trash2,
      contextualTab: "Equation",
      group: "Math",
      priority: "advanced",
      requires: "edit",
      risk: "confirm",
      hint: "Removes this equation from the document",
      touches: ["equations"],
      onSelect: () => equation.remove(),
    },
  ];
}

export type DocumentPageHandlers = {
  size?: string;
  setSize: (size: string) => void;
  orientation?: "portrait" | "landscape";
  setOrientation: (orientation: string) => void;
  margins?: string;
  setMargins: (preset: string) => void;
  columns?: number;
  setColumns: (columns: number) => void;
  /** Opens the header band for editing, and says whether one exists. */
  editHeader: () => void;
  headerText?: string;
  editFooter: () => void;
  footerText?: string;
  /**
   * Page canvas, pages laid side by side like an open book, or one continuous
   * scroll. A view state, not page setup.
   */
  canvas: "page" | "spread" | "continuous";
  setCanvas: (canvas: "page" | "spread" | "continuous") => void;
  /** Why pages cannot lie side by side here, e.g. in the narrow side panel. */
  spreadReason?: string;
  focus: boolean;
  toggleFocus: () => void;
  previewAsReader?: () => void;
  templates?: readonly { id: string; label: string }[];
  applyTemplate?: (id: string) => void;
};

/**
 * Layout.
 *
 * Page setup is real Spectra geometry: it drives the page canvas, print, and the
 * PDF copy. On a mounted Word file the section properties are preserved rather
 * than rewritten, so these commands declare `sections` and the shared
 * availability path disables them with the preservation reason — the setup a
 * reader sees stays the setup Word wrote.
 */
function layoutBindings(handlers: DocumentCommandHandlers): CommandBinding[] {
  const page = handlers.page;
  const disabled = !handlers.editable || undefined;
  const bindings: CommandBinding[] = [
    {
      id: "layout.pageSize",
      label: "Page size",
      icon: FileText,
      tab: "Layout",
      group: "Page",
      priority: "essential",
      requires: "edit",
      disabled,
      hint: "Paper size for the page canvas, print and the PDF copy",
      touches: ["sections"],
      control: {
        kind: "select",
        options: DOCUMENT_PAGE_SIZES,
        value: page.size ?? "a4",
        width: "7.5rem",
      },
      onSelect: (value) => {
        if (typeof value === "string") page.setSize(value);
      },
    },
    {
      id: "layout.orientation",
      label: "Orientation",
      icon: Frame,
      tab: "Layout",
      group: "Page",
      priority: "essential",
      requires: "edit",
      disabled,
      touches: ["sections"],
      control: {
        kind: "segmented",
        value: page.orientation ?? "portrait",
        options: [
          { value: "portrait", label: "Portrait" },
          { value: "landscape", label: "Landscape" },
        ],
      },
      onSelect: (value) => {
        if (typeof value === "string") page.setOrientation(value);
      },
    },
    {
      id: "layout.margins",
      label: "Margins",
      icon: Indent,
      tab: "Layout",
      group: "Page",
      priority: "essential",
      requires: "edit",
      disabled,
      hint: "Space around the text on every page",
      touches: ["sections"],
      control: {
        kind: "menu",
        options: DOCUMENT_MARGIN_PRESETS,
        value: page.margins ?? "normal",
      },
      onSelect: (value) => {
        if (typeof value === "string") page.setMargins(value);
      },
    },
    {
      id: "layout.columns",
      label: "Columns",
      icon: Columns3,
      tab: "Layout",
      group: "Page",
      priority: "secondary",
      requires: "edit",
      disabled,
      hint: "Text columns across the page",
      touches: ["sections"],
      control: {
        kind: "segmented",
        value: String(page.columns ?? 1),
        options: [
          { value: "1", label: "One" },
          { value: "2", label: "Two" },
          { value: "3", label: "Three" },
        ],
      },
      onSelect: (value) => {
        const next = Number(value);
        if (Number.isFinite(next)) page.setColumns(Math.min(3, Math.max(1, next)));
      },
    },
    {
      id: "layout.header",
      label: "Header",
      icon: PanelTop,
      tab: "Layout",
      group: "Page",
      priority: "secondary",
      requires: "edit",
      disabled,
      hint: page.headerText
        ? `Currently "${page.headerText.slice(0, 40)}"`
        : "Text repeated at the top of every page",
      touches: ["headersFooters"],
      onSelect: () => page.editHeader(),
    },
    {
      id: "layout.footer",
      label: "Footer",
      icon: PanelBottom,
      tab: "Layout",
      group: "Page",
      priority: "secondary",
      requires: "edit",
      disabled,
      hint: page.footerText
        ? `Currently "${page.footerText.slice(0, 40)}"`
        : "Text repeated at the bottom of every page",
      touches: ["headersFooters"],
      onSelect: () => page.editFooter(),
    },
    {
      id: "layout.pageCanvas",
      label: page.canvas === "continuous" ? "Page canvas" : "Continuous canvas",
      icon: FileText,
      tab: "Layout",
      group: "View",
      priority: "essential",
      active: page.canvas !== "continuous",
      hint:
        page.canvas !== "continuous"
          ? "Back to one continuous surface"
          : "Show the page edges as they will print",
      undo: "none(explain)",
      onSelect: () => page.setCanvas(page.canvas === "continuous" ? "page" : "continuous"),
    },
    {
      id: "layout.pagesSideBySide",
      label: "Pages side by side",
      icon: Columns2,
      tab: "Layout",
      group: "View",
      priority: "secondary",
      active: page.canvas === "spread",
      disabled: Boolean(page.spreadReason) || undefined,
      hint:
        page.spreadReason ??
        (page.canvas === "spread"
          ? "Back to one page at a time"
          : "Lay the pages out across the screen, as many as fit"),
      undo: "none(explain)",
      onSelect: () => page.setCanvas(page.canvas === "spread" ? "page" : "spread"),
    },
    {
      id: "layout.focus",
      label: "Focus",
      icon: Focus,
      tab: "Layout",
      group: "View",
      priority: "essential",
      active: page.focus,
      hint: "Hides everything except the text. Escape returns.",
      undo: "none(explain)",
      onSelect: () => page.toggleFocus(),
    },
  ];
  if (page.previewAsReader) {
    bindings.push({
      id: "layout.previewReader",
      label: "Preview as reader",
      icon: Eye,
      tab: "Layout",
      group: "View",
      priority: "secondary",
      hint: "Reads the document the way a shared viewer sees it",
      undo: "none(explain)",
      onSelect: () => page.previewAsReader?.(),
    });
  }
  for (const template of page.templates ?? []) {
    bindings.push({
      id: `layout.template.${template.id}`,
      label: template.label,
      icon: LayoutTemplate,
      tab: "Layout",
      group: "Templates",
      priority: "advanced",
      requires: "edit",
      disabled,
      risk: "confirm",
      hint: "Replaces everything in this document with a fresh structure",
      manifestOps: ["apply_template"],
      strictNative: {
        available: false,
        reason:
          "Templates replace the whole document and are unavailable for a linked Word file.",
      },
      onSelect: () => page.applyTemplate?.(template.id),
    });
  }
  return bindings;
}

export type DocumentReferenceHandlers = {
  sources: { toggle: () => void; open?: boolean; unresolved?: number; count?: number };
  /** Rebuilds the References section from the citations in the text. */
  insertBibliography: () => void;
  citationStyle?: string;
  setCitationStyle: (style: string) => void;
  addSource: () => void;
  /**
   * Set while a source cannot be created here. Supplied bibliographic metadata
   * is distinct from a verified research source with stored evidence handles.
   */
  addSourceReason?: string;
  /** A cross-reference to a heading in this document. */
  crossReference: () => void;
};

export type DocumentReviewHandlers = {
  editNote?: (key?: string) => void;
  moveNote?: (key?: string) => void;
  deleteNote?: (key?: string) => void;
  editWordComment?: (key?: string) => void;
  editCitation?: (key?: string) => void;
  removeCitation?: (key?: string) => void;
  addWordComment?: () => void;
  proposeText?: () => void;
  acceptRevision?: (key?: string) => void;
  rejectRevision?: (key?: string) => void;
  deleteWordComment?: (id: string) => void;
  /** Opens the tracked-change review rail. Reading revisions, never resolving. */
  showTrackedChanges: () => void;
  trackedChangesOpen?: boolean;
  trackedChangeCount?: number;
  /**
   * Set when the linked package carries revision marks Spectra preserves. The
   * accept/reject pair is registered so it can say why it is unavailable rather
   * than leaving a writer guessing.
   */
  revisionsPreservedReason?: string;
  acceptRevisions?: () => void;
  rejectRevisions?: () => void;
  updateFields?: () => void;
  fieldsPreservedReason?: string;
};

/**
 * References, and the review surface that belongs beside it.
 *
 * Spectra's bibliography is regenerated from the citations that are actually in
 * the text. Native citations retain their source tags and evidence mapping;
 * regeneration writes Word Sources XML and genuine bibliography fields.
 */
function referenceBindings(handlers: DocumentCommandHandlers): CommandBinding[] {
  const references = handlers.references;
  const review = handlers.review;
  const disabled = !handlers.editable || undefined;
  const bindings: CommandBinding[] = [
    ...([
      ["notes.edit", "Edit note", "Edits a note body while retaining supported formatting", "footnotes", review.editNote],
      ["notes.move", "Move note reference", "Select a destination in the text, then move a note from the review panel", "footnotes", review.moveNote],
      ["notes.delete", "Delete note", "Deletes the chosen note and its reference", "footnotes", review.deleteNote],
      ["review.comment.edit", "Edit Word comment", "Edits a classic native comment without moving its anchor", "comments", review.editWordComment],
      ["references.citation.edit", "Edit Word citation", "Edits citation pages and the metadata shared by every use of its source", "body", review.editCitation],
      ["references.citation.remove", "Remove Word citation", "Removes the chosen citation field; the source remains available for reuse", "body", review.removeCitation],
    ] as const).map(([id, label, hint, region, action]) => ({ id, label, hint, icon: Pencil, tab: "References", group: "Review", priority: "advanced" as const, requires: "edit" as const, disabled, touches: [region], onSelect: (key: unknown) => action?.(typeof key === "string" ? key : undefined) })),
    { id: "review.comment.add", label: "Comment in Word", icon: MessageSquare, tab: "References", group: "Review", priority: "secondary", requires: "edit", disabled, hint: "Annotates the selected range as a native Word comment; Spectra conversations stay separate", touches: ["comments"], onSelect: () => review.addWordComment?.() },
    { id: "review.trackChanges.propose", label: "Propose text edit", icon: Pencil, tab: "References", group: "Review", priority: "secondary", requires: "edit", disabled, hint: "Keeps the original and proposed text for individual review", touches: ["trackedChanges"], onSelect: () => review.proposeText?.() },
    { id: "review.trackChanges.acceptOne", label: "Accept selected revision", icon: Check, tab: "References", group: "Review", priority: "advanced", requires: "edit", disabled, hint: "Choose one identified insertion or deletion in the review panel", touches: ["trackedChanges"], undo: "operation-inverse", onSelect: (key) => review.acceptRevision?.(typeof key === "string" ? key : undefined) },
    { id: "review.trackChanges.rejectOne", label: "Reject selected revision", icon: X, tab: "References", group: "Review", priority: "advanced", requires: "edit", disabled, hint: "Choose one identified insertion or deletion in the review panel", touches: ["trackedChanges"], undo: "operation-inverse", onSelect: (key) => review.rejectRevision?.(typeof key === "string" ? key : undefined) },
    { id: "review.comment.delete", label: "Delete Word comment", icon: X, tab: "References", group: "Review", priority: "advanced", requires: "edit", disabled, hint: "Deletes the native annotation and its range markers", touches: ["comments"], undo: "operation-inverse", onSelect: (id) => { if (typeof id === "string") review.deleteWordComment?.(id); } },
    {
      id: "references.sources",
      label: "Sources",
      icon: BookOpen,
      tab: "References",
      group: "Sources",
      priority: "essential",
      active: references.sources.open,
      hint: references.sources.unresolved
        ? `${references.sources.unresolved} citation${references.sources.unresolved === 1 ? "" : "s"} to resolve`
        : references.sources.count
          ? `${references.sources.count} source${references.sources.count === 1 ? "" : "s"} in this document`
          : "Cite a source and it appears here",
      undo: "none(explain)",
      manifestOps: ["check_sources"],
      onSelect: () => references.sources.toggle(),
    },
    {
      id: "references.bibliography",
      label: "Insert references",
      icon: ListOrdered,
      tab: "References",
      group: "Bibliography",
      priority: "essential",
      requires: "edit",
      disabled,
      hint: "Rebuilds the References section from the citations in the text",
      touches: ["body"],
      manifestOps: ["insert_blocks"],
      onSelect: () => references.insertBibliography(),
    },
    {
      id: "references.citationStyle",
      label: "Citation style",
      icon: BookMarked,
      tab: "References",
      group: "Bibliography",
      priority: "essential",
      requires: "edit",
      disabled,
      hint: "How citation markers and the reference list are formatted",
      touches: ["body"],
      control: {
        kind: "select",
        options: [
          { value: "numeric", label: "Numeric [1]" },
          { value: "author_date", label: "Author–date" },
        ],
        value: references.citationStyle ?? "numeric",
        width: "9.5rem",
      },
      onSelect: (value) => {
        if (typeof value === "string") references.setCitationStyle(value);
      },
    },
    {
      id: "references.source.add",
      label: "Add a source",
      icon: Plus,
      tab: "References",
      group: "Sources",
      priority: "secondary",
      requires: "edit",
      disabled: Boolean(references.addSourceReason) || disabled,
      hint: references.addSourceReason ?? "Attaches a source this document can cite",
      onSelect: () => references.addSource(),
    },
    {
      id: "references.crossRef",
      label: "Cross-reference",
      icon: Link2,
      tab: "References",
      group: "Links",
      priority: "secondary",
      requires: "edit",
      disabled,
      hint: "Links to a heading in this document. It is a link, not a Word REF field.",
      touches: ["hyperlinks"],
      manifestOps: ["insert_blocks"],
      onSelect: () => references.crossReference(),
    },
    {
      id: "review.trackChanges.show",
      label: "Tracked changes",
      icon: History,
      tab: "References",
      group: "Review",
      priority: "essential",
      active: review.trackedChangesOpen,
      hint: review.trackedChangeCount
        ? `${review.trackedChangeCount} revision${review.trackedChangeCount === 1 ? "" : "s"} from Word; supported text spans can be reviewed individually`
        : "Shows Word revision marks this document carries",
      undo: "none(explain)",
      onSelect: () => review.showTrackedChanges(),
    },
  ];
  if (review.acceptRevisions) {
    bindings.push({
      id: "review.trackChanges.accept",
      label: "Accept revisions",
      icon: Check,
      tab: "References",
      group: "Review",
      priority: "advanced",
      requires: "edit",
      disabled: Boolean(review.revisionsPreservedReason) || disabled,
      hint:
        review.revisionsPreservedReason ??
        "Accepts every tracked revision in this document",
      // Not a region claim. Word revision markup is preserve-only: Spectra keeps
      // `w:ins`/`w:del` byte-identical and never rewrites them, so declaring a
      // write on `trackedChanges` would be a promise the lens cannot keep — and
      // would wrongly block unrelated edits on any file that has revisions.
      // The refusal is stated as a refusal instead, and it is declared rather
      // than computed so a server-side audit sees the same answer the bar shows.
      strictNative: {
        available: false,
        reason:
          "Word revision marks are preserved exactly as Word wrote them, so accepting them has to happen in Word.",
      },
      undo: "operation-inverse",
      onSelect: () => review.acceptRevisions?.(),
    });
  }
  if (review.rejectRevisions) {
    bindings.push({
      id: "review.trackChanges.reject",
      label: "Reject revisions",
      icon: X,
      tab: "References",
      group: "Review",
      priority: "advanced",
      requires: "edit",
      disabled: Boolean(review.revisionsPreservedReason) || disabled,
      hint:
        review.revisionsPreservedReason ??
        "Returns every tracked revision to the original wording",
      strictNative: {
        available: false,
        reason:
          "Word revision marks are preserved exactly as Word wrote them, so rejecting them has to happen in Word.",
      },
      undo: "operation-inverse",
      onSelect: () => review.rejectRevisions?.(),
    });
  }
  if (review.updateFields) {
    bindings.push({
      id: "review.updateFields",
      label: "Update fields",
      icon: RefreshCw,
      tab: "References",
      group: "Review",
      priority: "advanced",
      requires: "edit",
      disabled: Boolean(review.fieldsPreservedReason) || disabled,
      hint:
        review.fieldsPreservedReason ??
        "Recalculates the fields this document carries",
      touches: ["fields"],
      undo: "operation-inverse",
      onSelect: () => review.updateFields?.(),
    });
  }
  return bindings;
}

/**
 * The whole Document command set.
 *
 * Pure: handlers in, bindings out. That is what lets the capability matrix
 * enumerate every visible verb without a browser, and it is why the studio can
 * mount the same array the audit reads.
 */
export function documentCommandBindings(
  handlers: DocumentCommandHandlers,
): CommandBinding[] {
  return projectBindingsFromIr("document", [
    ...foundationBindings(handlers),
    ...paragraphBindings(handlers),
    ...insertBindings(handlers),
    ...layoutBindings(handlers),
    ...referenceBindings(handlers),
    ...tableBindings(handlers),
    ...imageBindings(handlers),
    ...equationBindings(handlers),
    ...placed(
      [
        ...exportBindings(handlers.exportCopies).map((binding) => ({
          ...binding,
          manifestOps: ["prepare_export"],
        })),
        importBinding(handlers.importCopy),
        printBinding(handlers.print, "document"),
      ],
      {
        // Print and Import belong with page setup, not with the export copies.
        // Printing is the last step of laying a page out — it reads the same
        // size, margins and columns the Layout tab sets — and importing a copy
        // produces a new document whose layout is the thing a person is about to
        // fix. Both stay `advanced`, so they live in the Layout overflow rather
        // than competing with margins for bar space.
        "export.print": { tab: "Layout", group: "Export" },
        "import.copy": { tab: "Layout", group: "Export" },
      },
    ),
  ]);
}

const noop = () => undefined;

/**
 * A handler set that performs nothing and reports neutral state.
 *
 * The capability matrix audits the command surface, not the editor, so it needs
 * the set exactly as it ships with every contextual family present. Selection
 * flags are therefore `true` here: a stub with no selection would hide the
 * Table, Image and Equation tabs and the audit would pass by omission.
 */
export function documentStubHandlers(): DocumentCommandHandlers {
  return {
    editable: true,
    history: { undo: noop, redo: noop, canUndo: true, canRedo: true },
    find: { toggle: noop, toggleReplace: noop, matchCount: 0, matchNoun: "match" },
    comments: { toggle: noop, openCount: 0 },
    format: {
      style: { options: DOCUMENT_STYLE_OPTIONS, value: "paragraph", set: noop },
      fontFamily: { value: undefined, set: noop },
      fontSize: { value: 11, set: noop },
      bold: { active: false, toggle: noop },
      italic: { active: false, toggle: noop },
      underline: { active: false, toggle: noop },
      strike: { active: false, toggle: noop },
      color: { value: null, set: noop },
      highlight: { value: null, set: noop },
      alignment: { value: "left", set: noop },
      lineHeight: { value: 1.5, set: noop },
      bulletList: { active: false, toggle: noop },
      numberedList: { active: false, toggle: noop },
      indent: { increase: noop, decrease: noop, canDecrease: true },
      clear: noop,
      generalPins: ["fontFamily", "fontSize", "bold", "italic"],
    },
    paragraph: {
      spacingAfter: 0,
      setSpacingAfter: noop,
      border: "none",
      setBorder: noop,
      shading: null,
      setShading: noop,
      quote: { active: false, toggle: noop },
      codeBlock: { active: false, toggle: noop },
      inlineCode: { active: false, toggle: noop },
      inList: true,
      listLevel: 1,
      demote: noop,
      promote: noop,
      canPromote: true,
      moveUp: noop,
      moveDown: noop,
    },
    namedStyles: {
      options: DOCUMENT_STYLE_OPTIONS,
      apply: noop,
      create: noop,
    },
    outline: { toggle: noop, headings: 0 },
    spellcheck: { active: true, toggle: noop },
    insert: {
      table: noop,
      image: noop,
      link: noop,
      linkActive: true,
      unlink: noop,
      equationBlock: noop,
      equationInline: noop,
      callout: noop,
      divider: noop,
      taskList: noop,
      reference: noop,
      citation: noop,
      footnote: noop,
      endnote: noop,
      pageBreak: noop,
      sectionBreak: noop,
      caption: noop,
      tableOfContents: noop,
    },
    table: {
      active: true,
      addRowBefore: noop,
      addRowAfter: noop,
      deleteRow: noop,
      addColumnBefore: noop,
      addColumnAfter: noop,
      deleteColumn: noop,
      mergeCells: noop,
      splitCell: noop,
      canMerge: true,
      canSplit: true,
      toggleHeaderRow: noop,
      deleteTable: noop,
    },
    image: {
      active: true,
      wrap: "inline",
      setWrap: noop,
      width: 100,
      setWidth: noop,
      editAlt: noop,
      replace: noop,
      remove: noop,
    },
    equation: {
      active: true,
      display: "block",
      setDisplay: noop,
      alignment: "center",
      setAlignment: noop,
      edit: noop,
      remove: noop,
    },
    page: {
      size: "a4",
      setSize: noop,
      orientation: "portrait",
      setOrientation: noop,
      margins: "normal",
      setMargins: noop,
      columns: 1,
      setColumns: noop,
      editHeader: noop,
      editFooter: noop,
      canvas: "continuous",
      setCanvas: noop,
      focus: false,
      toggleFocus: noop,
      previewAsReader: noop,
      templates: [
        { id: "notes", label: "Study notes" },
        { id: "essay", label: "Essay" },
        { id: "lab", label: "Lab report" },
      ],
      applyTemplate: noop,
    },
    references: {
      sources: { toggle: noop, count: 0 },
      insertBibliography: noop,
      citationStyle: "numeric",
      setCitationStyle: noop,
      addSource: noop,
      crossReference: noop,
    },
    review: {
      showTrackedChanges: noop,
      trackedChangeCount: 0,
      acceptRevisions: noop,
      rejectRevisions: noop,
      updateFields: noop,
    },
    exportCopies: {
      noun: "document",
      formats: [...DOCUMENT_EXPORT_COPIES],
      run: noop,
    },
    importCopy: { open: noop, noun: "document" },
    print: noop,
  };
}

/** The same set, frozen, for tests that want a value rather than a factory. */
export const documentCommandStubHandlers: DocumentCommandHandlers =
  documentStubHandlers();
