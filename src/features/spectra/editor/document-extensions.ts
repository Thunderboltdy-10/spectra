import type { AnyExtension } from "@tiptap/core";
import { getSchema } from "@tiptap/core";
import Highlight from "@tiptap/extension-highlight";
import TiptapLink from "@tiptap/extension-link";
import { Table } from "@tiptap/extension-table";
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
} from "./reference-citation-nodes";
import { StableBlockId } from "./stable-block-id";

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
        };
      },
    }).configure({ resizable: true, lastColumnResizable: true }),
    TableRow,
    TableCell,
    TableHeader,
    TaskList,
    TaskItem.configure({ nested: true }),
    // DOCX pictures are inline image nodes inside their source paragraph; a
    // block image would make schema parsing drop the whole paragraph.
    DocumentImage.configure({ allowBase64: true, inline: true }),
    NativeDocxImage,
    TextAlign.configure({ types: ["heading", "paragraph"] }),
    Highlight.configure({ multicolor: true }),
    TextStyle,
    FontFamily,
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
    StableBlockId.configure({ nativeReadOnlyBlockIds: options.nativeReadOnlyBlockIds ?? [] }),
  ] as AnyExtension[];
}

let cachedSchema: Schema | null = null;

/** The Document artifact's ProseMirror schema, for tests and server-side checks. */
export function documentSchema(): Schema {
  cachedSchema ??= getSchema(documentSchemaExtensions());
  return cachedSchema;
}
