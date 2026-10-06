"use client";

import { Node, mergeAttributes } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { useMemo } from "react";
import { EquationPreview } from "./equation-preview";
import { latexToEquation } from "../lenses/equation-interchange";

/** True only when this node is the selection, not when a range merely covers it. */
function isFocusedNode({ editor, getPos }: Pick<NodeViewProps, "editor" | "getPos">) {
  if (!editor || typeof getPos !== "function") return false;
  const pos = getPos();
  if (typeof pos !== "number") return false;
  const { selection } = editor.state;
  return selection instanceof NodeSelection && selection.from === pos;
}

function EquationView({ node, editor, getPos, selected, updateAttributes }: NodeViewProps) {
  const latex = typeof node.attrs.latex === "string" ? node.attrs.latex : "";
  const display = node.attrs.display === "inline" ? "inline" : "block";
  const alignment = ["left", "center", "right"].includes(node.attrs.alignment) ? node.attrs.alignment : "center";
  const focused = node.attrs.nativeReadOnly !== true && Boolean(selected) && isFocusedNode({ editor, getPos });
  const validation = useMemo(
    () => (focused ? latexToEquation(latex, display) : null),
    [display, focused, latex],
  );
  return <NodeViewWrapper as={display === "inline" ? "span" : "div"} className={`spectra-equation spectra-equation-${display} is-${alignment} ${focused ? "is-selected" : ""}`} data-equation="true">
    <EquationPreview latex={latex} displayMode={display === "block"} forceRender={focused} />
    {focused ? <textarea value={latex} onChange={(event) => updateAttributes({ latex: event.target.value })} rows={Math.max(2, latex.split("\n").length)} className="spectra-equation-source" aria-label="LaTeX equation source" placeholder="e.g. E = mc^2" /> : null}
    {focused && validation && !validation.supported ? <div role="alert" className="spectra-equation-feedback">Equation needs attention: {validation.diagnostics[0] ?? "unsupported syntax"}</div> : null}
    {focused ? <div className="spectra-equation-align" role="group" aria-label="Equation alignment">
      {(["left", "center", "right"] as const).map((value) => (
        <button
          key={value}
          type="button"
          data-active={alignment === value || undefined}
          aria-pressed={alignment === value}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => updateAttributes({ alignment: value })}
        >
          {value === "left" ? "Left" : value === "center" ? "Center" : "Right"}
        </button>
      ))}
    </div> : null}
  </NodeViewWrapper>;
}

function InlineEquationView({ node, editor, getPos, selected, updateAttributes }: NodeViewProps) {
  const latex = typeof node.attrs.latex === "string" ? node.attrs.latex : "";
  const focused = node.attrs.nativeReadOnly !== true && Boolean(selected) && isFocusedNode({ editor, getPos });
  const validation = useMemo(
    () => (focused ? latexToEquation(latex, "inline") : null),
    [focused, latex],
  );
  return <NodeViewWrapper as="span" className={`spectra-equation spectra-equation-inline ${focused ? "is-selected" : ""}`} data-inline-equation="true">
    <EquationPreview latex={latex} displayMode={false} forceRender={focused} />
    {focused ? <input value={latex} onChange={(event) => updateAttributes({ latex: event.target.value })} className="spectra-equation-source" aria-label="Inline LaTeX equation source" placeholder="e.g. 2n = 4" /> : null}
    {focused && validation && !validation.supported ? <div role="alert" className="spectra-equation-feedback">Equation needs attention: {validation.diagnostics[0] ?? "unsupported syntax"}</div> : null}
  </NodeViewWrapper>;
}

export const Equation = Node.create({
  name: "equation", group: "block", atom: true, draggable: true, selectable: true,
  addAttributes() { return { latex: { default: "" }, display: { default: "block" }, alignment: { default: "center" }, nativeReadOnly: { default: false } }; },
  parseHTML() { return [{ tag: "div[data-equation]" }, { tag: "span[data-equation]" }]; },
  renderHTML({ HTMLAttributes }) { return [HTMLAttributes.display === "inline" ? "span" : "div", mergeAttributes(HTMLAttributes, { "data-equation": "true" })]; },
  addNodeView() {
    return ReactNodeViewRenderer(EquationView) as never;
  },
});

export const InlineEquation = Node.create({
  name: "inlineEquation", group: "inline", inline: true, atom: true, selectable: true,
  addAttributes() { return { latex: { default: "" }, nativeReadOnly: { default: false } }; },
  parseHTML() { return [{ tag: "span[data-inline-equation]" }]; },
  renderHTML({ HTMLAttributes }) { return ["span", mergeAttributes(HTMLAttributes, { "data-inline-equation": "true" })]; },
  addNodeView() {
    return ReactNodeViewRenderer(InlineEquationView) as never;
  },
});
