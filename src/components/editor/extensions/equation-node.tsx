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

function InlineEquationView({ node, selected, updateAttributes }: NodeViewProps) {
  const latex = typeof node.attrs.latex === "string" ? node.attrs.latex : "";
  const html = useMemo(() => katex.renderToString(latex || "\\text{equation}", { throwOnError: false, displayMode: false, strict: "ignore" }), [latex]);
  return <NodeViewWrapper as="span" className={`spectra-equation spectra-equation-inline ${selected ? "is-selected" : ""}`} data-inline-equation="true">
    <span className="spectra-equation-preview" dangerouslySetInnerHTML={{ __html: html }} />
    {selected ? <input value={latex} onChange={(event) => updateAttributes({ latex: event.target.value })} className="spectra-equation-source" aria-label="Inline LaTeX equation source" placeholder="e.g. 2n = 4" /> : null}
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

export const InlineEquation = Node.create({
  name: "inlineEquation",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() { return { latex: { default: "" } }; },
  parseHTML() { return [{ tag: "span[data-inline-equation]" }]; },
  renderHTML({ HTMLAttributes }) { return ["span", mergeAttributes(HTMLAttributes, { "data-inline-equation": "true" })]; },
  addNodeView() { return ReactNodeViewRenderer(InlineEquationView); },
});
