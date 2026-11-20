// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StableBlockId } from "../editor/stable-block-id";
import { WordConflictDecoration, wordConflictKey, type WordConflictChoice } from "../editor/word-conflict-decoration";

describe("a paragraph Word and Spectra both changed, shown where it is", () => {
  let editor: Editor;
  const choose = { current: vi.fn<(regionId: string, choice: WordConflictChoice) => void>() };

  beforeEach(() => {
    const host = document.createElement("div");
    document.body.append(host);
    editor = new Editor({
      element: host,
      extensions: [StarterKit, StableBlockId, WordConflictDecoration.configure({ choose })],
      content: '<p data-block-id="p-one">Untouched.</p><p data-block-id="p-two">My version of the claim.</p>',
    });
  });

  afterEach(() => {
    editor.destroy();
    document.body.innerHTML = "";
    choose.current.mockReset();
  });

  const show = (chosen?: WordConflictChoice) =>
    editor.view.dispatch(editor.state.tr.setMeta(wordConflictKey, {
      application: "Word",
      conflicts: [{
        regionId: "p-two",
        external: { text: "Word's version of the claim.", runs: [{ kind: "text", text: "Word's " }, { kind: "text", text: "version", format: { bold: true } }, { kind: "text", text: " of the claim." }] },
        ...(chosen ? { chosen } : {}),
      }],
    }));

  it("lays Word's version above mine, with its formatting, and leaves mine editable", () => {
    show();
    const slip = editor.view.dom.querySelector<HTMLElement>(".spectra-word-conflict")!;
    expect(slip.dataset.regionId).toBe("p-two");
    expect(slip.textContent).toContain("Word's version of the claim.");
    expect(slip.querySelector("span")?.style.fontWeight).toBe("700");
    expect(slip.nextElementSibling?.classList.contains("spectra-word-conflict-mine")).toBe(true);
    expect(editor.getText()).toBe("Untouched.\n\nMy version of the claim.");
    expect([...slip.querySelectorAll("button")].map((button) => button.textContent)).toEqual(["Keep Word's", "Keep mine", "Keep both"]);
  });

  it("hands a choice to the studio and then says it is on its way", () => {
    show();
    editor.view.dom.querySelector<HTMLButtonElement>('.spectra-word-conflict button[data-choice="both"]')!.click();
    expect(choose.current).toHaveBeenCalledWith("p-two", "both");
    show("both");
    const slip = editor.view.dom.querySelector(".spectra-word-conflict")!;
    expect(slip.querySelector("button")).toBeNull();
    expect(slip.textContent).toContain("Keeping both");
  });

  it("follows the paragraph as the document changes, and clears when resolved", () => {
    show();
    editor.commands.insertContentAt(0, "<p>A new opening.</p>");
    const slip = editor.view.dom.querySelector<HTMLElement>(".spectra-word-conflict")!;
    expect(slip.nextElementSibling?.textContent).toBe("My version of the claim.");
    editor.view.dispatch(editor.state.tr.setMeta(wordConflictKey, { application: "Word", conflicts: [] }));
    expect(editor.view.dom.querySelector(".spectra-word-conflict")).toBeNull();
  });
});
