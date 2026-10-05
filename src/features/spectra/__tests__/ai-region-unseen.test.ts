// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AiRegionDecoration, UNSEEN_FALLBACK_MS, aiRegionDecorationKey } from "../editor/ai-region-decoration";

const query = (editor: Editor, selector: string) => editor.view.dom.querySelectorAll(selector);

describe("what Spectra wrote, afterwards", () => {
  let editor: Editor;

  beforeEach(() => {
    vi.useFakeTimers();
    const host = document.createElement("div");
    document.body.append(host);
    editor = new Editor({ element: host, extensions: [StarterKit, AiRegionDecoration], content: "<p>One</p><p>Two</p><p>Three</p>" });
  });

  afterEach(() => {
    editor.destroy();
    document.body.innerHTML = "";
    vi.useRealTimers();
  });

  const write = (indices: number[] | null) =>
    editor.view.dispatch(editor.state.tr.setMeta(aiRegionDecorationKey, indices && { all: false, indices, blockIds: [], lines: [] }));

  it("keeps a faint tint on the blocks it wrote until they have been seen, then fades it", () => {
    write([1]);
    expect(query(editor, "[data-ai-region='true']")).toHaveLength(1);
    expect(query(editor, "[data-ai-unseen]")).toHaveLength(0);

    write(null);
    expect(query(editor, "[data-ai-region='true']")).toHaveLength(0);
    const tinted = query(editor, "[data-ai-unseen='true']");
    expect(tinted).toHaveLength(1);
    expect(tinted[0].textContent).toBe("Two");

    // No way to tell what is in view here: it fades after a while all the same.
    vi.advanceTimersByTime(UNSEEN_FALLBACK_MS + 10);
    expect(query(editor, "[data-ai-unseen='fading']")).toHaveLength(1);
    vi.advanceTimersByTime(1000);
    expect(query(editor, "[data-ai-unseen]")).toHaveLength(0);
  });

  it("follows its block through the user's edits", () => {
    write([2]);
    write(null);
    editor.commands.insertContentAt(0, "<p>Zero</p>");
    const tinted = query(editor, "[data-ai-unseen='true']");
    expect(tinted).toHaveLength(1);
    expect(tinted[0].textContent).toBe("Three");
  });

  it("never stacks two tints on a block written twice", () => {
    write([0]);
    write([0]);
    write(null);
    expect(query(editor, "[data-ai-unseen='true']")).toHaveLength(1);
  });
});
