import { Extension, Node, mergeAttributes, type CommandProps } from "@tiptap/core";
import { Selection, TextSelection } from "@tiptap/pm/state";

/**
 * Document structure the page canvas needs.
 *
 * A writer who asks for a page break means *this text starts on the next page*
 * — in the editor, in print, and in the PDF copy. A horizontal rule dressed up
 * as a break is the kind of lie this file exists to avoid, so both breaks are
 * real nodes with real print behaviour (`break-after: page` in
 * `spectra-document.css`), and both are visible while writing.
 *
 * Paragraph frames (border, shading, space after) are global attributes rather
 * than a wrapper node. That matters for fidelity: they are paragraph properties
 * in Word too (`w:pBdr`, `w:shd`, `w:spacing`), so a paragraph keeps its
 * identity — and its stable block id — when a writer boxes or shades it.
 */

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    spectraBreaks: {
      insertPageBreak: () => ReturnType;
      insertSectionBreak: () => ReturnType;
    };
    spectraParagraphFrame: {
      /** `none | all | top | bottom | left` — matches the workbar's options. */
      setParagraphBorder: (border: string) => ReturnType;
      setParagraphShading: (shading: string | null) => ReturnType;
      /** Space after the paragraph, in points. */
      setParagraphSpacing: (points: number) => ReturnType;
      /** Line spacing as a multiple: 1, 1.15, 1.5, 2. */
      setParagraphLineSpacing: (multiple: number) => ReturnType;
      /** The named paragraph style — Word's `w:pStyle` by another name. */
      setParagraphStyle: (style: string | null) => ReturnType;
      /** Moves the whole block one place up (-1) or down (+1). */
      moveBlock: (direction: number) => ReturnType;
      /** Moves the left indent by one step, clamped to 0–8. */
      shiftParagraphIndent: (steps: number) => ReturnType;
    };
  }
}

export const PageBreak = Node.create({
  name: "pageBreak",
  group: "block",
  atom: true,
  selectable: true,
  parseHTML() {
    return [{ tag: "div[data-page-break]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-page-break": "true",
        class: "spectra-page-break",
        role: "separator",
        "aria-label": "Page break",
      }),
    ];
  },
  addCommands() {
    return {
      insertPageBreak:
        () =>
        ({ commands }) =>
          commands.insertContent({ type: this.name }),
    };
  },
  addKeyboardShortcuts() {
    return {
      "Mod-Enter": () => this.editor.commands.insertPageBreak(),
    };
  },
});

export const SectionBreak = Node.create({
  name: "sectionBreak",
  group: "block",
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      // A section can carry its own page setup later; the label is what a
      // writer sees on the break itself so the document explains itself.
      label: {
        default: "New section",
        parseHTML: (element) => element.getAttribute("data-section-label") ?? "New section",
        renderHTML: ({ label }) => ({ "data-section-label": label }),
      },
    };
  },
  parseHTML() {
    return [{ tag: "div[data-section-break]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-section-break": "true",
        class: "spectra-section-break",
        role: "separator",
      }),
    ];
  },
  addCommands() {
    return {
      insertSectionBreak:
        () =>
        ({ commands }) =>
          commands.insertContent({ type: this.name }),
    };
  },
});

const FRAMED_TYPES = ["paragraph", "heading", "blockquote"] as const;

export const ParagraphFrame = Extension.create({
  name: "spectraParagraphFrame",
  addGlobalAttributes() {
    return [
      {
        types: [...FRAMED_TYPES],
        attributes: {
          frameBorder: {
            default: null,
            parseHTML: (element) => element.getAttribute("data-border"),
            renderHTML: (attributes) =>
              attributes.frameBorder && attributes.frameBorder !== "none"
                ? { "data-border": attributes.frameBorder }
                : {},
          },
          frameShading: {
            default: null,
            parseHTML: (element) => element.getAttribute("data-shading"),
            renderHTML: (attributes) =>
              attributes.frameShading
                ? {
                    "data-shading": attributes.frameShading,
                    style: `background-color:${attributes.frameShading}`,
                  }
                : {},
          },
          spacingAfter: {
            default: null,
            parseHTML: (element) => {
              const value = Number(element.getAttribute("data-spacing-after"));
              return Number.isFinite(value) && value > 0 ? value : null;
            },
            renderHTML: (attributes) =>
              attributes.spacingAfter
                ? {
                    "data-spacing-after": String(attributes.spacingAfter),
                    style: `margin-bottom:${attributes.spacingAfter}pt`,
                  }
                : {},
          },
          // Word indents a paragraph with `w:ind`, not with spaces or a nested
          // list, so Spectra does the same: a step count on the paragraph. It
          // survives a copy, it is legible in the JSON, and Increase indent on a
          // plain paragraph stops being the no-op it used to be.
          indentLevel: {
            default: null,
            parseHTML: (element) => {
              const value = Number(element.getAttribute("data-indent"));
              return Number.isFinite(value) && value > 0 ? value : null;
            },
            renderHTML: (attributes) =>
              attributes.indentLevel
                ? { "data-indent": String(attributes.indentLevel) }
                : {},
          },
          // Line spacing is a paragraph property here for the same reason it is
          // one in Word (`w:spacing/@w:line`). TipTap's own line-height sets a
          // text mark, which would leave two halves of a sentence on different
          // leading — a bug a writer would have to undo by hand.
          lineSpacing: {
            default: null,
            parseHTML: (element) => {
              const value = Number(element.getAttribute("data-line-spacing"));
              return Number.isFinite(value) && value > 0 ? value : null;
            },
            renderHTML: (attributes) =>
              attributes.lineSpacing
                ? {
                    "data-line-spacing": String(attributes.lineSpacing),
                    style: `line-height:${attributes.lineSpacing}`,
                  }
                : {},
          },
          // The named style. One attribute, so a caption stays a caption when
          // it is copied, and a style a writer defines is a name the document
          // carries rather than a bundle of inline properties nobody can find
          // again. It is the same idea as `w:pStyle`.
          blockStyle: {
            default: null,
            parseHTML: (element) => element.getAttribute("data-style"),
            renderHTML: (attributes) =>
              attributes.blockStyle ? { "data-style": attributes.blockStyle } : {},
          },
        },
      },
    ];
  },
  addCommands() {
    /** Applies one paragraph property to every framed block in the selection. */
    const patch =
      (attributes: Record<string, unknown>) =>
      ({ state, tr, dispatch }: CommandProps) => {
        const { from, to } = state.selection;
        let touched = false;
        state.doc.nodesBetween(from, to, (node, position) => {
          if (!FRAMED_TYPES.includes(node.type.name as (typeof FRAMED_TYPES)[number])) return;
          tr.setNodeMarkup(position, undefined, { ...node.attrs, ...attributes });
          touched = true;
        });
        if (touched && dispatch) dispatch(tr);
        return touched;
      };
    return {
      setParagraphBorder: (border: string) => patch({ frameBorder: border === "none" ? null : border }),
      setParagraphShading: (shading: string | null) => patch({ frameShading: shading }),
      setParagraphSpacing: (points: number) => patch({ spacingAfter: points > 0 ? points : null }),
      setParagraphLineSpacing: (multiple: number) =>
        patch({ lineSpacing: multiple > 0 && multiple !== 1 ? multiple : null }),
      setParagraphStyle: (style: string | null) => patch({ blockStyle: style }),
      shiftParagraphIndent:
        (steps: number) =>
        ({ state, tr, dispatch }: CommandProps) => {
          const { from, to } = state.selection;
          let touched = false;
          state.doc.nodesBetween(from, to, (node, position) => {
            if (!FRAMED_TYPES.includes(node.type.name as (typeof FRAMED_TYPES)[number])) return;
            const current = Number(node.attrs.indentLevel) || 0;
            // Negative levels are real: a Word style may set the paragraph out
            // into the left margin, and the file keeps that geometry. Clamping
            // the step at zero would drag such a paragraph back on the first
            // click and write the change into the document.
            const next = Math.max(-8, Math.min(8, current + steps));
            if (next === current) return;
            tr.setNodeMarkup(position, undefined, {
              ...node.attrs,
              indentLevel: next !== 0 ? next : null,
            });
            touched = true;
          });
          if (touched && dispatch) dispatch(tr);
          return touched;
        },
      // Reordering by moving one block, rather than by cutting and pasting it.
      // The block keeps its identity — and its stable id — so a comment or an
      // AI change anchored to it survives the move.
      moveBlock:
        (direction: number) =>
        ({ state, tr, dispatch }: CommandProps) => {
          const { $from } = state.selection;
          if ($from.depth < 1) return false;
          const from = $from.before(1);
          const node = state.doc.nodeAt(from);
          if (!node) return false;
          const index = state.doc.resolve(from).index(0);
          const neighbourIndex = index + (direction < 0 ? -1 : 1);
          if (neighbourIndex < 0 || neighbourIndex >= state.doc.childCount) return false;
          const neighbour = state.doc.child(neighbourIndex);
          const target = direction < 0 ? from - neighbour.nodeSize : from + neighbour.nodeSize;
          tr.delete(from, from + node.nodeSize);
          tr.insert(target, node);
          tr.setSelection(TextSelection.near(tr.doc.resolve(target + 1)));
          if (dispatch) dispatch(tr.scrollIntoView());
          return true;
        },
    };
  },
  addKeyboardShortcuts() {
    const boundary = (end: boolean, extend = false) => {
      const { state, view } = this.editor;
      const target = end ? Selection.atEnd(state.doc) : Selection.atStart(state.doc);
      const selection = extend ? TextSelection.between(state.selection.$anchor, target.$head) : target;
      // Keep native document navigation and the editing state in the same
      // transaction, including an Enter pressed immediately afterward.
      view.dispatch(state.tr.setSelection(selection).scrollIntoView());
      return true;
    };
    return {
      "Alt-Shift-ArrowUp": () => this.editor.commands.moveBlock(-1),
      "Alt-Shift-ArrowDown": () => this.editor.commands.moveBlock(1),
      "Mod-Home": () => boundary(false),
      "Mod-End": () => boundary(true),
      "Mod-Shift-Home": () => boundary(false, true),
      "Mod-Shift-End": () => boundary(true, true),
    };
  },
});
