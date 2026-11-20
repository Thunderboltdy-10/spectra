import { wordFontStack } from "./word-style-sheet";
import type { AnyExtension } from "@tiptap/core";
import { getSchema } from "@tiptap/core";
import Highlight from "@tiptap/extension-highlight";
import TiptapLink from "@tiptap/extension-link";
import { Table, TableView } from "@tiptap/extension-table";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { TableRow } from "@tiptap/extension-table-row";
import { TaskItem } from "@tiptap/extension-task-item";
import { TaskList } from "@tiptap/extension-task-list";
import TextAlign from "@tiptap/extension-text-align";
import { Color, FontFamily, FontSize, TextStyle } from "@tiptap/extension-text-style";
import Underline from "@tiptap/extension-underline";
import StarterKit from "@tiptap/starter-kit";
import type { Schema } from "@tiptap/pm/model";
import { Callout } from "./callout-node";
import { DocumentImage, NativeDocxImage } from "./document-image";
import { Endnote, Footnote, SpectraNotes } from "./document-notes";
import {
  AllCaps,
  PageBreak,
  ParagraphFrame,
  SectionBreak,
  SmallCaps,
  Subscript,
  Superscript,
} from "./document-structure";
import { Equation, InlineEquation } from "./equation-node";
import {
  SpectraCitationNode,
  SpectraReferenceNode,
  WordCommentBoundary,
  WordRevision,
  WordField,
} from "./reference-citation-nodes";
import { StableBlockId } from "./stable-block-id";
import { WordChart } from "./word-chart";

/** How a table's lines are drawn: every line, the rows only, the outside only, or none. */
export const TABLE_LINES: readonly unknown[] = ["grid", "horizontal", "outer", "none"];
const HEX = /^#[0-9a-f]{6}$/i;

/** A cell's fill from Word, drawn as its background. */
function cellFill(this: { parent?: () => Record<string, unknown> }) {
  return {
    ...this.parent?.(),
    background: {
      default: null,
      parseHTML: (element: HTMLElement) => {
        const value = element.getAttribute("data-background");
        return value && /^#[0-9a-f]{6}$/i.test(value) ? value : null;
      },
      renderHTML: (attributes: Record<string, unknown>) =>
        typeof attributes.background === "string" && /^#[0-9a-f]{6}$/i.test(attributes.background)
          ? { "data-background": attributes.background, style: `--cell-fill: ${attributes.background}` }
          : {},
    },
  };
}

/**
 * The editor's table view, drawing the Word look a table carries: no lines
 * for a layout table, and Word's own space inside its cells. TipTap's view
 * draws only column widths, so these attributes are applied here too.
 */
class WordTableView extends TableView {
  constructor(node: ProseMirrorNode, cellMinWidth: number, view?: unknown, HTMLAttributes?: Record<string, unknown>) {
    super(node, cellMinWidth, view as never, HTMLAttributes as never);
    this.applyLook(node);
  }

  update(node: ProseMirrorNode) {
    if (!super.update(node)) return false;
    this.applyLook(node);
    return true;
  }

  private applyLook(node: ProseMirrorNode) {
    this.table.toggleAttribute("data-borderless", Boolean(node.attrs.borderless) || node.attrs.lines === "none");
    this.table.toggleAttribute("data-fills-set", Boolean(node.attrs.fillsSet));
    if (TABLE_LINES.includes(node.attrs.lines) && node.attrs.lines !== "none") this.table.setAttribute("data-lines", node.attrs.lines);
    else this.table.removeAttribute("data-lines");
    if (typeof node.attrs.lineColor === "string" && HEX.test(node.attrs.lineColor)) this.table.style.setProperty("--table-line", node.attrs.lineColor);
    else this.table.style.removeProperty("--table-line");
    const padding = typeof node.attrs.cellPadding === "string" && /^(?:[\d.]+pt ?){4}$/.test(node.attrs.cellPadding)
      ? node.attrs.cellPadding
      : "";
    if (padding) this.table.style.setProperty("--cell-padding", padding);
    else this.table.style.removeProperty("--cell-padding");
  }
}

/**
 * A run's font as Word names it, drawn with its open twin behind it so text in
 * Calibri measures as Calibri where Calibri isn't installed. The mark keeps the
 * one name Word wrote.
 */
const WordFontFamily = FontFamily.extend({
  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          fontFamily: {
            default: null,
            parseHTML: (element) => {
              const family = element.style.fontFamily.split(",")[0]?.trim().replace(/^["']|["']$/g, "");
              return family || null;
            },
            renderHTML: (attributes) =>
              typeof attributes.fontFamily === "string" && attributes.fontFamily
                ? { style: `font-family: ${wordFontStack(attributes.fontFamily) ?? attributes.fontFamily}` }
                : {},
          },
        },
      },
    ];
  },
});

/** Heading levels a document holds; Word has nine, the editor shows six. */
export const DOCUMENT_HEADING_LEVELS = [1, 2, 3, 4, 5, 6] as const;

export type DocumentSchemaOptions = {
  /** Undo comes from Yjs when the editor is bound to a shared document. */
  collaborative?: boolean;
  nativeReadOnlyBlockIds?: string[];
};

/**
 * Every extension that defines the Document artifact's schema: its nodes, marks
 * and attributes. The editor adds interaction-only extensions (menus, AI
 * decorations, the slash menu) on top; tests and server code build the same
 * schema from this list, so the stored shape can't drift from the editor's.
 */
export function documentSchemaExtensions(options: DocumentSchemaOptions = {}): AnyExtension[] {
  return [
    StarterKit.configure({
      heading: { levels: [...DOCUMENT_HEADING_LEVELS] },
      link: false,
      underline: false,
      ...(options.collaborative ? { undoRedo: false } : {}),
      trailingNode: false,
    }),
    Underline,
    TiptapLink.configure({ openOnClick: false, autolink: true, defaultProtocol: "https" }),
    Table.extend({
      addAttributes() {
        return {
          ...this.parent?.(),
          spectraAuthored: {
            default: false,
            parseHTML: (element: HTMLElement) =>
              element.getAttribute("data-spectra-authored") === "true",
            renderHTML: (attributes: Record<string, unknown>) =>
              attributes.spectraAuthored ? { "data-spectra-authored": "true" } : {},
          },
          // The space Word leaves inside this table's cells ("5pt 5pt 5pt 5pt").
          cellPadding: {
            default: null,
            parseHTML: (element: HTMLElement) => element.style.getPropertyValue("--cell-padding").trim() || null,
            renderHTML: (attributes: Record<string, unknown>) =>
              typeof attributes.cellPadding === "string" && /^(?:[\d.]+pt ?){4}$/.test(attributes.cellPadding)
                ? { style: `--cell-padding: ${attributes.cellPadding}` }
                : {},
          },
          // The lines chosen for this table, and their colour.
          lines: {
            default: null,
            parseHTML: (element: HTMLElement) => {
              const value = element.getAttribute("data-lines");
              return TABLE_LINES.includes(value) ? value : null;
            },
            renderHTML: (attributes: Record<string, unknown>) =>
              TABLE_LINES.includes(attributes.lines) ? { "data-lines": attributes.lines } : {},
          },
          lineColor: {
            default: null,
            parseHTML: (element: HTMLElement) => {
              const value = element.style.getPropertyValue("--table-line").trim();
              return HEX.test(value) ? value : null;
            },
            renderHTML: (attributes: Record<string, unknown>) =>
              typeof attributes.lineColor === "string" && HEX.test(attributes.lineColor)
                ? { style: `--table-line: ${attributes.lineColor}` }
                : {},
          },
          // Its cell fills were set in Spectra, so none is a choice too.
          fillsSet: {
            default: false,
            parseHTML: (element: HTMLElement) => element.hasAttribute("data-fills-set"),
            renderHTML: (attributes: Record<string, unknown>) => attributes.fillsSet ? { "data-fills-set": "" } : {},
          },
          // A Word table drawn without lines (a layout table).
          borderless: {
            default: false,
            parseHTML: (element: HTMLElement) => element.hasAttribute("data-borderless"),
            renderHTML: (attributes: Record<string, unknown>) =>
              attributes.borderless ? { "data-borderless": "" } : {},
          },
        };
      },
    }).configure({ resizable: true, lastColumnResizable: true, View: WordTableView as unknown as typeof TableView }),
    TableRow,
    TableCell.extend({ addAttributes: cellFill }),
    TableHeader.extend({ addAttributes: cellFill }),
    TaskList,
    TaskItem.configure({ nested: true }),
    // DOCX pictures are inline image nodes inside their source paragraph; a
    // block image would make schema parsing drop the whole paragraph.
    DocumentImage.configure({ allowBase64: true, inline: true }),
    NativeDocxImage,
    TextAlign.configure({ types: ["heading", "paragraph"] }),
    Highlight.configure({ multicolor: true }),
    TextStyle,
    WordFontFamily,
    FontSize,
    Color,
    PageBreak,
    SectionBreak,
    ParagraphFrame,
    Superscript,
    Subscript,
    SmallCaps,
    AllCaps,
    Footnote,
    Endnote,
    SpectraNotes,
    Callout,
    Equation,
    InlineEquation,
    SpectraReferenceNode,
    SpectraCitationNode,
    WordCommentBoundary,
    WordRevision,
    WordField,
    WordChart,
    StableBlockId.configure({ nativeReadOnlyBlockIds: options.nativeReadOnlyBlockIds ?? [] }),
  ] as AnyExtension[];
}

let cachedSchema: Schema | null = null;

/** The Document artifact's ProseMirror schema, for tests and server-side checks. */
export function documentSchema(): Schema {
  cachedSchema ??= getSchema(documentSchemaExtensions());
  return cachedSchema;
}
