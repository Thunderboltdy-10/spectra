"use client";

import { Node, mergeAttributes } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import katex from "katex";
import { useMemo } from "react";

function EquationView({ node, selected, updateAttributes }: NodeViewProps) {
  const latex = typeof node.attrs.latex === "string" ? node.attrs.latex : "";
  const display = node.attrs.display === "inline" ? "inline" : "block";
  const alignment = ["left", "center", "right"].includes(node.attrs.alignment) ? node.attrs.alignment : "center";
  const html = useMemo(() => katex.renderToString(latex || "\\text{New equation}", { throwOnError: false, displayMode: display === "block", strict: "ignore" }), [display, latex]);
  return <NodeViewWrapper as={display === "inline" ? "span" : "div"} className={`spectra-equation spectra-equation-${display} is-${alignment} ${selected ? "is-selected" : ""}`} data-equation="true">
    <span className="spectra-equation-preview" dangerouslySetInnerHTML={{ __html: html }} />
    {selected ? <textarea value={latex} onChange={(event) => updateAttributes({ latex: event.target.value })} rows={Math.max(2, latex.split("\n").length)} className="spectra-equation-source" aria-label="LaTeX equation source" placeholder="e.g. E = mc^2" /> : null}
  </NodeViewWrapper>;
}

export const Equation = Node.create({
  name: "equation",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes() {
    return {
      latex: { default: "" },
      display: { default: "block" },
      alignment: { default: "center" },
    };
  },
  parseHTML() { return [{ tag: "div[data-equation]" }, { tag: "span[data-equation]" }]; },
  renderHTML({ HTMLAttributes }) { return [HTMLAttributes.display === "inline" ? "span" : "div", mergeAttributes(HTMLAttributes, { "data-equation": "true" })]; },
  addNodeView() { return ReactNodeViewRenderer(EquationView); },
});
