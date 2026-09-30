// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import type { Editor } from "@tiptap/core";
import * as Y from "yjs";
import { quizYjsAdapter } from "../work/models/yjs/structured-adapters";
import { getBlueprint } from "../artifacts/blueprint-catalog";
import { workYjsOrigins } from "../work/models/yjs/origins";
import { afterEach, expect, it, vi } from "vitest";
import { ArtifactRichTextEditor } from "../components/artifact-rich-text-editor";

const harness = vi.hoisted(() => ({ editor: null as Editor | null }));
vi.mock("@tiptap/react", async original => {
  const actual = await original<typeof import("@tiptap/react")>();
  return { ...actual, useEditor: (...args: Parameters<typeof actual.useEditor>) => {
    const editor = actual.useEditor(...args); harness.editor = editor; return editor;
  } };
});
vi.mock("../components/artifact-studio", async original => ({
  ...await original<typeof import("../components/artifact-studio")>(), RichTextFormatBar: () => null,
}));
afterEach(() => { cleanup(); harness.editor = null; vi.useRealTimers(); });

async function mount() {
  const onChange = vi.fn();
  const view = render(<ArtifactRichTextEditor value="colour" onChange={onChange} />);
  await waitFor(() => expect(harness.editor).toBeTruthy());
  const editor = harness.editor!;
  fireEvent.focus(editor.view.dom);
  act(() => { editor.commands.insertContentAt(7, "s"); });
  return { editor, onChange, ...view };
}

it("publishes typing immediately so the parent can merge before the next remote value", async () => {
  const { onChange } = await mount();
  expect(onChange).toHaveBeenCalledWith("<p>colours</p>");
});

it("accepts merged text while focused and maps the caret without emitting a new edit", async () => {
  const { editor, onChange, rerender } = await mount();
  act(() => { editor.commands.setTextSelection(8); });
  onChange.mockClear();
  rerender(<ArtifactRichTextEditor value="<p>colors</p>" onChange={onChange} />);
  expect(editor.getHTML()).toBe("<p>colors</p>");
  expect(editor.state.selection.head).toBe(7);
  expect(onChange).not.toHaveBeenCalled();
});

it("does not write a stale focused value over a peer's merged edit on blur", async () => {
  const { editor, onChange, rerender } = await mount();
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 300)); });
  onChange.mockClear();
  rerender(<ArtifactRichTextEditor value="<p>colors</p>" onChange={onChange} />);
  fireEvent.blur(editor.view.dom);
  expect(onChange).not.toHaveBeenCalled();
  expect(editor.getHTML()).toBe("<p>colors</p>");
});


it("keeps both edits through focused convergence, blur and a durable Yjs reload", async () => {
  const initial = structuredClone(getBlueprint("quiz")!.defaultContent) as { questions: Array<{ id: string; prompt: string }> };
  initial.questions[0].prompt = "<p>colour</p>";
  const left = quizYjsAdapter.createDocument(initial);
  const right = new Y.Doc(); Y.applyUpdate(right, Y.encodeStateAsUpdate(left));
  const writer = (doc: Y.Doc, id: string) => vi.fn((prompt: string) => {
    const current = quizYjsAdapter.project(doc) as typeof initial;
    quizYjsAdapter.applyProjection(doc, { ...current, questions: current.questions.map((question, index) => index ? question : { ...question, prompt }) }, workYjsOrigins({ kind: "human", clientId: id }).localHuman);
  });
  const onA = writer(left, "a"), onB = writer(right, "b");
  const a = render(<ArtifactRichTextEditor value="colour" onChange={onA} />);
  await waitFor(() => expect(harness.editor).toBeTruthy());
  const editorA = harness.editor!;
  const b = render(<ArtifactRichTextEditor value="colour" onChange={onB} />);
  await waitFor(() => expect(harness.editor).not.toBe(editorA));
  const editorB = harness.editor!;
  fireEvent.focus(editorA.view.dom); fireEvent.focus(editorB.view.dom);
  act(() => { editorA.commands.insertContentAt(7, "s"); editorB.commands.deleteRange({ from: 5, to: 6 }); });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 300)); });
  const toB = Y.encodeStateAsUpdate(left, Y.encodeStateVector(right));
  const toA = Y.encodeStateAsUpdate(right, Y.encodeStateVector(left));
  Y.applyUpdate(right, toB); Y.applyUpdate(left, toA);
  const prompt = (doc: Y.Doc) => (quizYjsAdapter.project(doc) as typeof initial).questions[0].prompt;
  expect(prompt(left)).toBe("<p>colors</p>");
  a.rerender(<ArtifactRichTextEditor value={prompt(left)} onChange={onA} />);
  b.rerender(<ArtifactRichTextEditor value={prompt(right)} onChange={onB} />);
  expect(editorA.getHTML()).toBe("<p>colors</p>");
  expect(editorB.getHTML()).toBe("<p>colors</p>");
  onA.mockClear(); onB.mockClear();
  fireEvent.blur(editorA.view.dom); fireEvent.blur(editorB.view.dom);
  expect(onA).not.toHaveBeenCalled(); expect(onB).not.toHaveBeenCalled();
  const restored = new Y.Doc(); Y.applyUpdate(restored, Y.encodeStateAsUpdate(left));
  expect(prompt(restored)).toBe("<p>colors</p>");
});
