// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AiRegionDecoration, aiRegionDecorationKey } from "../editor/ai-region-decoration";
import { NATIVE_PROJECTION_TRANSACTION_META } from "../editor/collaboration-change";
import { AiTextResolve, MAX_RESOLVE_CHARS, RESOLVE_MS } from "../editor/ai-text-resolve";

describe("Spectra's words in an artifact", () => {
  let editor: Editor;

  beforeEach(() => {
    vi.useFakeTimers();
    const host = document.createElement("div");
    document.body.append(host);
    editor = new Editor({ element: host, extensions: [StarterKit, AiRegionDecoration, AiTextResolve], content: "<p>One</p><p>Two</p>" });
  });

  afterEach(() => {
    editor.destroy();
    document.body.innerHTML = "";
    vi.useRealTimers();
  });

  const writing = (on: boolean) =>
    editor.view.dispatch(editor.state.tr.setMeta(aiRegionDecorationKey, on ? { all: false, indices: [1], blockIds: [], lines: [] } : null));
  // Spectra's text reaches the editor from the shared document, not from typing.
  const arrive = (text: string) => editor.view.dispatch(editor.state.tr.insertText(text, 9).setMeta(NATIVE_PROJECTION_TRANSACTION_META, true));
  const resolving = () => [...editor.view.dom.querySelectorAll(".spectra-ai-resolve")].map((node) => node.textContent);

  it("resolves each chunk that arrives while Spectra writes, then lets it be text", () => {
    writing(true);
    arrive(" and a few words");
    expect(resolving()).toEqual([" and a few words"]);
    vi.advanceTimersByTime(RESOLVE_MS * 2 + 10);
    expect(resolving()).toEqual([]);
    expect(editor.getText()).toContain("Two and a few words");
  });

  it("leaves your own typing alone", () => {
    writing(true);
    editor.view.dispatch(editor.state.tr.insertText(" typed", 9));
    expect(resolving()).toEqual([]);
  });

  it("lets text that arrives when Spectra is not writing simply appear", () => {
    arrive(" synced");
    expect(resolving()).toEqual([]);
  });

  it("lets a whole reload appear at once", () => {
    writing(true);
    arrive(" word".repeat(MAX_RESOLVE_CHARS));
    expect(resolving()).toEqual([]);
  });
});

describe("Spectra's words in a field it writes", () => {
  it("resolve when the field says who is writing and what came in", () => {
    vi.useFakeTimers();
    let spectraWriting = false;
    const host = document.createElement("div");
    document.body.append(host);
    const field = new Editor({
      element: host,
      extensions: [StarterKit, AiTextResolve.configure({ writing: () => spectraWriting, remote: (transaction) => transaction.getMeta("incoming") === true })],
      content: "<p>Answer</p>",
    });
    const incoming = (text: string) => field.view.dispatch(field.state.tr.insertText(text, 7).setMeta("incoming", true));
    const resolving = () => [...field.view.dom.querySelectorAll(".spectra-ai-resolve")].map((node) => node.textContent);
    incoming(" synced");
    expect(resolving()).toEqual([]);
    spectraWriting = true;
    incoming(" written");
    expect(resolving()).toEqual([" written"]);
    field.view.dispatch(field.state.tr.insertText(" typed", 1));
    expect(resolving()).toEqual([" written"]);
    field.destroy();
    document.body.innerHTML = "";
    vi.useRealTimers();
  });
});
