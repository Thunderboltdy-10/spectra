import { Image } from "@tiptap/extension-image";

/**
 * The document image.
 *
 * TipTap's image carries `src`, `alt` and `title`. A document needs two more
 * things a writer reaches for constantly and Word puts in a ribbon tab: how the
 * text flows around the picture, and how wide the picture is relative to the
 * text column. Both are attributes rather than inline pixel styles, so they
 * survive a copy/paste, they are legible in the JSON a reviewer reads, and the
 * Image contextual tab can show the current value instead of guessing.
 *
 * Width is a percentage on purpose. A document is read at several widths — a
 * side panel, a full tab, a printed page — and a pixel width that looked right
 * in one of them is wrong in the others.
 */
export const DocumentImage = Image.extend({
  name: "image",
  addAttributes() {
    return {
      ...this.parent?.(),
      wrap: {
        default: "inline",
        parseHTML: (element) => element.getAttribute("data-wrap") ?? "inline",
        renderHTML: (attributes) =>
          attributes.wrap && attributes.wrap !== "inline"
            ? { "data-wrap": attributes.wrap }
            : {},
      },
      widthPercent: {
        default: null,
        parseHTML: (element) => {
          const value = Number(element.getAttribute("data-width-percent"));
          return Number.isFinite(value) && value > 0 ? value : null;
        },
        renderHTML: (attributes) =>
          attributes.widthPercent
            ? {
                "data-width-percent": String(attributes.widthPercent),
                style: `width:${attributes.widthPercent}%`,
              }
            : {},
      },
    };
  },
});
