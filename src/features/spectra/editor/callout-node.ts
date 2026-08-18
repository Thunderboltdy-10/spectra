import { Node, mergeAttributes } from "@tiptap/core";

export type CalloutType = "info" | "warning" | "tip";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    spectraCallout: {
      setCallout: (attrs?: { type?: CalloutType }) => ReturnType;
      toggleCallout: (attrs?: { type?: CalloutType }) => ReturnType;
    };
  }
}

export const Callout = Node.create({
  name: "callout",
  group: "block",
  content: "block+",
  defining: true,
  addAttributes() {
    return { type: { default: "info", parseHTML: (element) => element.getAttribute("data-callout-type") ?? "info", renderHTML: ({ type }) => ({ "data-callout-type": type }) } };
  },
  parseHTML() {
    return [
      { tag: "aside[data-spectra-callout]" },
      { tag: "div[data-callout]" },
    ];
  },
  renderHTML({ HTMLAttributes }) { return ["aside", mergeAttributes(HTMLAttributes, { "data-spectra-callout": "true", class: `callout callout-${HTMLAttributes["data-callout-type"] ?? "info"}` }), 0]; },
  addCommands() {
    return {
      setCallout: (attrs) => ({ commands }) => commands.wrapIn(this.name, attrs),
      toggleCallout: (attrs) => ({ commands }) => commands.toggleWrap(this.name, attrs),
    };
  },
});
