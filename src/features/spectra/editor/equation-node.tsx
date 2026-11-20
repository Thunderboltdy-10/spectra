"use client";

import { Node, mergeAttributes, type Editor } from "@tiptap/core";
import { NodeSelection, Selection } from "@tiptap/pm/state";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { useEffect, useMemo, useRef } from "react";
import { EquationPreview } from "./equation-preview";
import { MathField, preloadMathField, registerMathEditor, templateAsLatex, useMathSourceMode } from "./math-field";
import { latexToEquation } from "../lenses/equation-interchange";

/*
 * Equations are typed where they sit on the page, as in Word: selecting one
 * turns it into a live maths editor in place, with nothing floating over the
 * page. What is typed is saved as it is typed. LaTeX source mode, switched
 * from the Equation tab, shows the same spot as LaTeX instead.
 */

/** True only when this node is the selection, not when a range merely covers it. */
function isFocusedNode({ editor, getPos }: Pick<NodeViewProps, "editor" | "getPos">) {
  if (!editor || typeof getPos !== "function") return false;
  const pos = getPos();
  if (typeof pos !== "number") return false;
  const { selection } = editor.state;
  return selection instanceof NodeSelection && selection.from === pos;
}

/** Puts the caret just after (or before) the equation and returns to the text. */
function leaveEquation(editor: Editor, getPos: NodeViewProps["getPos"], direction: "forward" | "backward") {
  const pos = typeof getPos === "function" ? getPos() : undefined;
  if (typeof pos !== "number") return;
  const node = editor.state.doc.nodeAt(pos);
  if (!node) return;
  const at = direction === "forward" ? pos + node.nodeSize : pos;
  const selection = Selection.near(editor.state.doc.resolve(at), direction === "forward" ? 1 : -1);
  editor.view.dispatch(editor.state.tr.setSelection(selection).scrollIntoView());
  editor.view.focus();
}

/** Grows the LaTeX source box with its text, so the page never scrolls inside it. */
function useAutoHeight(value: string) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  }, [value]);
  return ref;
}

function SourceEditor({ latex, inline, onChange, onExit }: {
  latex: string;
  inline: boolean;
  onChange: (latex: string) => void;
  onExit: (direction: "forward" | "backward") => void;
}) {
  const textarea = useAutoHeight(latex);
  const input = useRef<HTMLInputElement>(null);
  // The Equation tab's galleries insert at the caret here too, as LaTeX.
  const latest = useRef({ latex, onChange });
  latest.current = { latex, onChange };
  useEffect(() => {
    const element = inline ? input.current : textarea.current;
    element?.focus();
    return registerMathEditor({
      source: true,
      insert: (template) => {
        const target = inline ? input.current : textarea.current;
        const text = templateAsLatex(template);
        const { latex: current, onChange: change } = latest.current;
        const start = target?.selectionStart ?? current.length;
        const end = target?.selectionEnd ?? current.length;
        change(`${current.slice(0, start)}${text}${current.slice(end)}`);
        requestAnimationFrame(() => {
          target?.focus();
          target?.setSelectionRange(start + text.length, start + text.length);
        });
      },
    });
  }, [inline, textarea]);
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape" && !event.defaultPrevented) {
      event.preventDefault();
      onExit("forward");
    }
  };
  return inline
    ? <input ref={input} value={latex} onChange={(event) => onChange(event.target.value)} onKeyDown={onKeyDown} size={Math.max(6, latex.length + 1)} className="spectra-equation-source is-inline" aria-label="Equation as LaTeX" spellCheck={false} placeholder="LaTeX" />
    : <textarea ref={textarea} value={latex} onChange={(event) => onChange(event.target.value)} onKeyDown={onKeyDown} rows={1} className="spectra-equation-source" aria-label="Equation as LaTeX" spellCheck={false} placeholder="e.g. E = mc^2" />;
}

function EquationBody({ props, inline }: { props: NodeViewProps; inline: boolean }) {
  const { node, editor, getPos, selected, updateAttributes } = props;
  const latex = typeof node.attrs.latex === "string" ? node.attrs.latex : "";
  const editing = node.attrs.nativeReadOnly !== true && editor.isEditable && Boolean(selected) && isFocusedNode({ editor, getPos });
  const source = useMathSourceMode();
  const validation = useMemo(
    () => (latex ? latexToEquation(latex, inline ? "inline" : "block") : null),
    [inline, latex],
  );
  const unsupported = validation && !validation.supported ? validation.diagnostics[0] ?? "unsupported syntax" : null;
  const change = (next: string) => updateAttributes({ latex: next });
  const exit = (direction: "forward" | "backward") => leaveEquation(editor, getPos, direction);
  const preview = latex
    ? <EquationPreview latex={latex} displayMode={!inline} forceRender={editing} />
    : <span className="spectra-equation-empty">{inline ? "equation" : "Type equation here"}</span>;
  return <>
    {!editing
      ? preview
      : source
        ? <>
            <SourceEditor latex={latex} inline={inline} onChange={change} onExit={exit} />
            {!inline && latex ? <span className="spectra-equation-source-preview" aria-hidden="true">{preview}</span> : null}
          </>
        : <MathField value={latex} inline={inline} label={inline ? "Equation in the sentence" : "Equation"} onChange={change} onExit={exit} fallback={preview} />}
    {editing && unsupported && !inline
      ? <span className="spectra-equation-note" role="status">Word will show part of this as plain text: {unsupported}</span>
      : null}
  </>;
}

function EquationView(props: NodeViewProps) {
  const { node } = props;
  const display = node.attrs.display === "inline" ? "inline" : "block";
  const alignment = ["left", "center", "right"].includes(node.attrs.alignment) ? node.attrs.alignment : "center";
  const editing = node.attrs.nativeReadOnly !== true && Boolean(props.selected) && isFocusedNode(props);
  return <NodeViewWrapper as={display === "inline" ? "span" : "div"} className={`spectra-equation spectra-equation-${display} is-${alignment} ${editing ? "is-editing" : ""}`} data-equation="true">
    <EquationBody props={props} inline={display === "inline"} />
  </NodeViewWrapper>;
}

function InlineEquationView(props: NodeViewProps) {
  const editing = props.node.attrs.nativeReadOnly !== true && Boolean(props.selected) && isFocusedNode(props);
  return <NodeViewWrapper as="span" className={`spectra-equation spectra-equation-inline ${editing ? "is-editing" : ""}`} data-inline-equation="true">
    <EquationBody props={props} inline />
  </NodeViewWrapper>;
}

/** Keys and clicks inside the maths editor belong to it, not to the page. */
function stopEvent({ event }: { event: Event }) {
  const target = event.target as HTMLElement | null;
  return Boolean(target?.closest?.("math-field, .spectra-equation-source"));
}

const isMac = () => typeof navigator !== "undefined" && /Mac|iP(?:hone|[oa]d)/u.test(navigator.platform);

/**
 * Word's equation key: Alt+= (Ctrl+= on a Mac). Selected text becomes the
 * equation; an empty line takes an equation of its own; anywhere else the
 * equation goes into the sentence. The new equation opens for typing at once.
 */
export function insertEquationAtCaret(editor: Editor, display?: "inline" | "block") {
  const { state } = editor;
  const { selection } = state;
  if (selection instanceof NodeSelection && ["equation", "inlineEquation"].includes(selection.node.type.name)) return true;
  const { $from, empty } = selection;
  const selected = empty ? "" : state.doc.textBetween(selection.from, selection.to, " ").trim();
  const parent = $from.parent;
  const onEmptyLine = empty && parent.isTextblock && parent.content.size === 0;
  // A schema with no in-sentence equation (a field's editor) takes a display one.
  const block = !state.schema.nodes.inlineEquation || (display ? display === "block" : onEmptyLine);
  preloadMathField();
  return editor
    .chain()
    .focus()
    .command(({ tr }) => {
      if (block) {
        const node = state.schema.nodes.equation!.create({ latex: selected, display: "block", alignment: "center" });
        if (onEmptyLine && $from.depth >= 1) {
          const start = $from.before();
          tr.replaceWith(start, $from.after(), node);
          tr.setSelection(NodeSelection.create(tr.doc, start));
        } else {
          tr.replaceSelectionWith(node);
          const at = tr.selection.$from.pos;
          const before = tr.doc.resolve(at).nodeBefore;
          const position = before?.type.name === "equation" ? at - before.nodeSize : at;
          if (tr.doc.nodeAt(position)?.type.name === "equation") tr.setSelection(NodeSelection.create(tr.doc, position));
        }
        return true;
      }
      const from = selection.from;
      tr.replaceWith(from, selection.to, state.schema.nodes.inlineEquation!.create({ latex: selected }));
      tr.setSelection(NodeSelection.create(tr.doc, from));
      return true;
    })
    .scrollIntoView()
    .run();
}

function equationShortcuts(editor: Editor) {
  return {
    "Alt-=": () => insertEquationAtCaret(editor),
    ...(isMac() ? { "Ctrl-=": () => insertEquationAtCaret(editor) } : {}),
  };
}

export const Equation = Node.create({
  name: "equation", group: "block", atom: true, draggable: true, selectable: true,
  addAttributes() { return { latex: { default: "" }, display: { default: "block" }, alignment: { default: "center" }, ommlRef: { default: null, rendered: false }, nativeReadOnly: { default: false } }; },
  parseHTML() { return [{ tag: "div[data-equation]" }, { tag: "span[data-equation]" }]; },
  renderHTML({ HTMLAttributes }) { return [HTMLAttributes.display === "inline" ? "span" : "div", mergeAttributes(HTMLAttributes, { "data-equation": "true" })]; },
  addKeyboardShortcuts() {
    return equationShortcuts(this.editor);
  },
  addNodeView() {
    return ReactNodeViewRenderer(EquationView, { stopEvent }) as never;
  },
});

export const InlineEquation = Node.create({
  name: "inlineEquation", group: "inline", inline: true, atom: true, selectable: true,
  addAttributes() { return { latex: { default: "" }, display: { default: "inline", rendered: false }, ommlRef: { default: null, rendered: false }, nativeReadOnly: { default: false } }; },
  parseHTML() { return [{ tag: "span[data-inline-equation]" }]; },
  renderHTML({ HTMLAttributes }) { return ["span", mergeAttributes(HTMLAttributes, { "data-inline-equation": "true" })]; },
  addNodeView() {
    return ReactNodeViewRenderer(InlineEquationView, { stopEvent }) as never;
  },
});
