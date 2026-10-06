import type { AnyExtension } from "@tiptap/core";
import { getStyleProperty } from "@tiptap/core";
import TiptapLink from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { TaskItem } from "@tiptap/extension-task-item";
import { TaskList } from "@tiptap/extension-task-list";
import TextAlign from "@tiptap/extension-text-align";
import { Color, FontFamily, FontSize, TextStyle } from "@tiptap/extension-text-style";
import Underline from "@tiptap/extension-underline";
import StarterKit from "@tiptap/starter-kit";
import { AiTextResolve } from "./ai-text-resolve";
import { Callout } from "./callout-node";
import { Equation, InlineEquation } from "./equation-node";

/** A change that came in through a field's value: someone else's text (a peer's, or Spectra's). */
export const INCOMING_META = "spectraIncomingValue";

const SCALED_SIZE = /^calc\(var\(--rich-pt,\s*1pt\)\s*\*\s*([\d.]+)\)$/;

/**
 * A run's size in points of the surface it is on. A slide drawn smaller than
 * its own size (a thumbnail, the canvas in a narrow window) sets `--rich-pt`
 * to one of its points, so a 24pt run is 24 of them wherever it is shown, as
 * the shared renderer draws it. The stored value stays `24pt`.
 */
export const ScaledFontSize = FontSize.extend({
  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          fontSize: {
            default: null,
            parseHTML: (element) => {
              const value = getStyleProperty(element, "font-size") ?? element.style.fontSize;
              const scaled = typeof value === "string" ? value.match(SCALED_SIZE) : null;
              return scaled ? `${scaled[1]}pt` : value || null;
            },
            renderHTML: (attributes) => {
              const size = typeof attributes.fontSize === "string" ? attributes.fontSize : "";
              if (!size) return {};
              const points = size.match(/^([\d.]+)pt$/);
              return { style: `font-size: ${points ? `calc(var(--rich-pt, 1pt) * ${points[1]})` : size}` };
            },
          },
        },
      },
    ];
  },
});

export type FieldExtensionOptions = {
  placeholder: string;
  /** Where the field is: Spectra's words resolve from a blur while it writes the region around it. */
  host: () => Element | null;
  /**
   * A text box rather than a page: no headings or rules (its size is the
   * box's), and no empty line kept after a closing list or quote, which a box
   * would store as a paragraph of its own.
   */
  box?: boolean;
};

/**
 * The text schema every field shares with a document: the same marks, lists,
 * checklists, callouts, styled runs, alignment and equations, so nothing a
 * field is given is dropped when it opens.
 */
export function fieldExtensions({ placeholder, host, box = false }: FieldExtensionOptions): AnyExtension[] {
  return [
    StarterKit.configure({ link: false, underline: false, ...(box ? { heading: false, horizontalRule: false, trailingNode: false } : {}) }),
    Underline,
    TiptapLink.configure({ openOnClick: false, autolink: true }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Callout,
    TextStyle,
    FontFamily,
    ScaledFontSize,
    Color,
    TextAlign.configure({ types: ["heading", "paragraph"] }),
    Equation,
    InlineEquation,
    Placeholder.configure({ placeholder }),
    // Spectra's words resolve from a slight blur while it writes this field (MOTION.md).
    AiTextResolve.configure({
      writing: () => Boolean(host()?.closest('[data-ai-region="true"]')),
      remote: (transaction) => transaction.getMeta(INCOMING_META) === true,
    }),
  ] as AnyExtension[];
}
