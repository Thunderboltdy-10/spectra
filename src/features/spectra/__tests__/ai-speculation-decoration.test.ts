// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AiSpeculationDecoration,
  aiSpeculationKey,
  type SpeculativeBlockText,
} from "../editor/ai-speculation-decoration";

/** The text a reader sees: hidden words left out, drawn-in words included. */
function visible(element: Element): string {
  let text = "";
  const walk = (node: Node) => {
    if (node instanceof HTMLElement && node.hasAttribute("data-spectra-unwritten")) return;
    if (node.nodeType === Node.TEXT_NODE) text += node.textContent ?? "";
    node.childNodes.forEach(walk);
  };
  walk(element);
  return text;
}

describe("a collaborator's words while they are still writing", () => {
  let editor: Editor;

  beforeEach(() => {
    const host = document.createElement("div");
    document.body.append(host);
    editor = new Editor({
      element: host,
      extensions: [StarterKit, AiSpeculationDecoration],
      content: "<p>First line.</p><p><strong>Third plain line, edited again.</strong></p><ul><li><p>One</p></li><li><p>Two</p></li></ul>",
    });
  });

  afterEach(() => {
    editor.destroy();
    document.body.innerHTML = "";
  });

  const show = (targets: SpeculativeBlockText[]) =>
    editor.view.dispatch(editor.state.tr.setMeta(aiSpeculationKey, targets));
  const block = (index: number) => editor.view.dom.children[index]!;

  it("draws the block as the writer has it over what the room holds", () => {
    // The room already has the finished line; the writer is half way through typing it.
    show([{ index: 1, text: "Third plain line, ed" }]);
    expect(visible(block(1))).toBe("Third plain line, ed");
    // Drawn-in words keep the marks around them.
    expect(block(1).querySelector("strong .spectra-ai-written, .spectra-ai-written strong")).not.toBeNull();
    // Old words still on their screen are drawn back in.
    show([{ index: 0, text: "First old line." }]);
    expect(visible(block(0))).toBe("First old line.");
    expect(visible(block(1))).toBe("Third plain line, edited again.");
  });

  it("follows list lines and clears when the writer is done", () => {
    show([{ index: 2, text: "One\nTw" }]);
    expect(visible(block(2))).toBe("OneTw");
    show([]);
    expect(editor.view.dom.querySelectorAll(".spectra-ai-written, [data-spectra-unwritten]")).toHaveLength(0);
    expect(visible(block(2))).toBe("OneTwo");
  });

  it("leaves the document itself untouched", () => {
    show([]);
    const before = editor.getJSON();
    show([{ index: 0, text: "Something else entirely." }]);
    expect(editor.getJSON()).toEqual(before);
  });
});
