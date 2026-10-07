// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Editor } from "@tiptap/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SlideTextField } from "../components/slide-text-field";
import type { PresentationParagraph } from "../presentation/model";

const harness = vi.hoisted(() => ({ editor: null as Editor | null }));
vi.mock("@tiptap/react", async (original) => {
  const actual = await original<typeof import("@tiptap/react")>();
  return {
    ...actual,
    useEditor: (...args: Parameters<typeof actual.useEditor>) => {
      const editor = actual.useEditor(...args);
      harness.editor = editor;
      return editor;
    },
  };
});
vi.mock("../settings/preference-store", () => ({
  useSpectraPreferences: () => ({
    preferences: { workbar: {}, writing: { smartCompletion: false, delayMs: 400 } },
    hydrated: true,
    update: () => {},
    replace: () => {},
    reset: () => {},
  }),
}));

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  harness.editor = null;
  vi.unstubAllGlobals();
});

const deckText: PresentationParagraph[] = [
  { alignment: "center", runs: [{ text: "Plan", fontFamily: "Aptos", fontSizePt: 32 }] },
  { bullet: "bullet", level: 1, runs: [{ text: "first" }] },
];

async function mount(props: { paragraphs?: PresentationParagraph[]; native?: boolean; editable?: boolean } = {}) {
  const onChange = vi.fn();
  const view = render(
    <SlideTextField
      paragraphs={props.paragraphs ?? deckText}
      editable={props.editable ?? true}
      native={props.native ?? false}
      onChange={onChange}
      onFocus={() => {}}
      onBlur={() => {}}
    />,
  );
  await waitFor(() => expect(harness.editor).toBeTruthy());
  const editor = harness.editor!;
  return { editor, onChange, ...view };
}

function last(onChange: ReturnType<typeof vi.fn>) {
  return onChange.mock.lastCall![0] as PresentationParagraph[];
}

describe("slide text on the shared rich field", () => {
  it("shows the deck's paragraphs and runs with their own type", async () => {
    const { editor } = await mount();
    expect(editor.view.dom.getAttribute("aria-label")).toBe("Slide text");
    expect(editor.getText()).toContain("Plan");
    const html = editor.getHTML();
    expect(html).toContain("Aptos");
    expect(html).toContain("calc(var(--rich-pt, 1pt) * 32)");
    expect(html).toContain("text-align: center");
  });

  it("writes typing back as deck paragraphs, keeping what the field does not show", async () => {
    const { editor, onChange } = await mount();
    fireEvent.focus(editor.view.dom);
    act(() => {
      editor.commands.insertContentAt(5, "s");
    });
    const next = last(onChange);
    expect(next[0]).toEqual({
      alignment: "center",
      runs: [{ text: "Plans", fontFamily: "Aptos", fontSizePt: 32 }],
    });
    // The untouched nested bullet keeps its level, with no line added above it.
    expect(next).toHaveLength(2);
    expect(next[1]).toEqual(deckText[1]);
  });

  it("keeps an empty parent bullet, a callout and a code block in its list item through the first edit", async () => {
    const paragraphs: PresentationParagraph[] = [
      { bullet: "bullet", runs: [] },
      { bullet: "bullet", level: 1, runs: [{ text: "Deeper" }] },
      { bullet: "bullet", runs: [{ text: "Run" }] },
      { bullet: "none", block: "code", runs: [{ text: "npm test" }] },
      { block: "callout", tone: "warning", runs: [{ text: "Hot" }] },
    ];
    const { editor, onChange } = await mount({ paragraphs });
    fireEvent.focus(editor.view.dom);
    act(() => {
      editor.chain().focus("end").insertContent(" plate").run();
    });
    expect(last(onChange)).toEqual([...paragraphs.slice(0, 4), { block: "callout", tone: "warning", runs: [{ text: "Hot plate" }] }]);
  });

  it("stores bold, checklists, quotes, code and equations from the same commands as every editor", async () => {
    const { editor, onChange } = await mount({ paragraphs: [{ runs: [{ text: "Hello" }] }] });
    fireEvent.focus(editor.view.dom);
    act(() => {
      editor.chain().setTextSelection({ from: 1, to: 6 }).toggleBold().run();
    });
    expect(last(onChange)[0]!.runs[0]).toMatchObject({ text: "Hello", bold: true });
    act(() => {
      editor.commands.toggleTaskList();
    });
    expect(last(onChange)[0]).toMatchObject({ bullet: "bullet", checked: false });
    act(() => {
      editor.commands.toggleTaskList();
      editor.commands.toggleBlockquote();
    });
    expect(last(onChange)[0]).toMatchObject({ block: "quote" });
  });

  it("keeps a linked PowerPoint box to what DrawingML holds, and says why commands are off", async () => {
    const { editor, onChange } = await mount({ paragraphs: [{ runs: [{ text: "Hello" }] }], native: true });
    fireEvent.focus(editor.view.dom);
    const checklist = await screen.findByRole("button", { name: "Checklist" });
    expect(checklist).toHaveProperty("disabled", true);
    expect(document.getElementById(checklist.getAttribute("aria-describedby")!)?.textContent).toMatch(/PowerPoint/);
    expect(screen.getByRole("button", { name: "Bold" })).toHaveProperty("disabled", false);
    // Text that arrives with a checklist (a paste) is written as PowerPoint text.
    act(() => {
      editor.commands.toggleTaskList();
    });
    const next = last(onChange);
    expect(next[0]!.checked).toBeUndefined();
    expect(next[0]!.runs[0]!.text).toBe("☐ ");
  });

  it("follows someone else's text while focused without writing it back", async () => {
    const { editor, onChange, rerender } = await mount({ paragraphs: [{ runs: [{ text: "colour" }] }] });
    fireEvent.focus(editor.view.dom);
    act(() => {
      editor.commands.setTextSelection(7);
    });
    rerender(
      <SlideTextField
        paragraphs={[{ runs: [{ text: "colours" }] }]}
        editable
        native={false}
        onChange={onChange}
        onFocus={() => {}}
        onBlur={() => {}}
      />,
    );
    expect(editor.getText()).toBe("colours");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("is read-only for a locked box", async () => {
    const { editor } = await mount({ editable: false });
    expect(editor.isEditable).toBe(false);
  });
});
