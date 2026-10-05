// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AiRegionDecoration, aiRegionDecorationKey } from "../editor/ai-region-decoration";
import { NATIVE_PROJECTION_TRANSACTION_META } from "../editor/collaboration-change";
import { AiTextResolve, MAX_RESOLVE_CHARS, RESOLVE_MS } from "../editor/ai-text-resolve";

describe("Spectra's words in a work", () => {
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
