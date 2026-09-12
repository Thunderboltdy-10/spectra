import { Image } from "@tiptap/extension-image";
import { Node, mergeAttributes } from "@tiptap/core";

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
      assetId: { default: null },
      mediaType: { default: null },
      partName: { default: null },
      occurrenceId: { default: null },
      widthEmu: { default: null },
      heightEmu: { default: null },
      placement: { default: "inline" },
      crop: { default: null },
    };
  },
});

/**
 * A retained DOCX drawing inside otherwise ordered paragraph content.
 *
 * This is intentionally a separate node from authorable `image`: it is
 * inline, atomic, and has no mutation UI. The `src` is a small authenticated
 * route to the retained package part, never a base64 copy stored in the
 * collaborative document.
 */
export const NativeDocxImage = Node.create({
  name: "nativeDocxImage",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,
  addAttributes() {
    return {
      src: { default: "" },
      partName: { default: "" },
      occurrenceId: { default: "" },
      assetId: { default: "" },
      mediaType: { default: "" },
      alt: { default: "Word image" },
      widthEmu: { default: null },
      heightEmu: { default: null },
      placement: { default: "inline" },
      nativeReadOnly: { default: true },
    };
  },
  parseHTML() {
    return [{ tag: "img[data-native-docx-image]" }];
  },
  renderHTML({ HTMLAttributes }) {
    const widthEmu = Number(HTMLAttributes.widthEmu);
    const widthPixels =
      Number.isFinite(widthEmu) && widthEmu > 0
        ? Math.max(1, Math.round(widthEmu / 9525))
        : null;
    return [
      "img",
      mergeAttributes(HTMLAttributes, {
        "data-native-docx-image": "true",
        "data-native-read-only": "true",
        contenteditable: "false",
        draggable: "false",
        ...(widthPixels
          ? { style: `width:min(100%, ${widthPixels}px);height:auto` }
          : { style: "max-width:100%;height:auto" }),
      }),
    ];
  },
});
