import { Node, mergeAttributes } from "@tiptap/core";

export const SpectraReferenceNode = Node.create({
  name: "spectraReference",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return {
      id: { default: null },
      protocolVersion: { default: 2 },
      workId: { default: null },
      workType: { default: null },
      anchor: { default: null },
      view: { default: null },
      state: { default: "collapsed" },
      versionPolicy: { default: "live" },
      width: { default: null },
      height: { default: null },
      status: { default: "ready" },
      displayPreferences: { default: null },
      label: { default: "Referenced work" },
      blockId: { default: null },
    };
  },
  parseHTML() {
    return [{ tag: "div[data-spectra-reference]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-spectra-reference": "",
        "data-reference-id": HTMLAttributes.id,
        "data-reference-state": HTMLAttributes.state,
        role: "group",
        tabindex: "0",
        "aria-label": `${String(HTMLAttributes.label ?? "Referenced work")}, ${String(HTMLAttributes.state ?? "collapsed")}`,
        contenteditable: "false",
      }),
      String(HTMLAttributes.label ?? "Referenced work"),
    ];
  },
  addKeyboardShortcuts() {
    return {
      Enter: () => {
        if (!this.editor.isActive(this.name)) return false;
        const state = this.editor.getAttributes(this.name).state === "expanded" ? "collapsed" : "expanded";
        return this.editor.commands.updateAttributes(this.name, { state });
      },
      Space: () => {
        if (!this.editor.isActive(this.name)) return false;
        const state = this.editor.getAttributes(this.name).state === "expanded" ? "collapsed" : "expanded";
        return this.editor.commands.updateAttributes(this.name, { state });
      },
    };
  },
});

export const SpectraCitationNode = Node.create({
  name: "spectraCitation",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      id: { default: null },
      sourceId: { default: null },
      evidenceSpanId: { default: null },
      label: { default: "Citation" },
    };
  },
  parseHTML() {
    return [{ tag: "span[data-spectra-citation]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-spectra-citation": "",
        contenteditable: "false",
      }),
      String(HTMLAttributes.label ?? "Citation"),
    ];
  },
});
