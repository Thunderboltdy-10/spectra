// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Editor } from "@tiptap/core";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PresentationStudio } from "../components/presentation-studio";
import {
  StudioContractProvider,
  type StudioContract,
} from "../components/artifact-studio-shell";
import { normalizePresentationContent } from "../presentation/model";

const editors = vi.hoisted(() => [] as Editor[]);
vi.mock("@tiptap/react", async (original) => {
  const actual = await original<typeof import("@tiptap/react")>();
  return {
    ...actual,
    useEditor: (...args: Parameters<typeof actual.useEditor>) => {
      const editor = actual.useEditor(...args);
      if (editor && !editors.includes(editor)) editors.push(editor);
      return editor;
    },
  };
});

vi.mock("../settings/preference-store", () => ({
  useSpectraPreferences: () => ({
    preferences: { workbar: {}, writing: { smartCompletion: false } },
    hydrated: true,
    update: () => {},
    replace: () => {},
    reset: () => {},
  }),
}));

const contract: StudioContract = {
  artifactId: "deck-1",
  type: "presentation",
  role: "edit",
  can: () => true,
  modes: [{ id: "slides", label: "Slides" } as never],
  readOnly: false,
  surface: "full",
  sync: { state: "saved", label: "Saved" },
  responsive: {
    minInlineSize: 320,
    preferredInlineSize: 960,
    supportsPanel: true,
    supportsTile: true,
    supportsCompact: true,
    toolbarPriorities: [],
    canvasExtent: "infinite",
  },
  density: "comfortable",
  compatibilityProfile: "spectra-native",
  fidelity: { artifact: "NATIVE" },
  inspector: { open: null, show: () => {}, hide: () => {} },
};

function textObject(id: string, text: string) {
  return { id, type: "text", x: 80, y: 80, width: 600, height: 120, content: { text } };
}
const initialDeck = normalizePresentationContent({
  slides: [
    { id: "slide-1", title: "One", objects: [textObject("text-1", "Hello")] },
    { id: "slide-2", title: "Two", objects: [textObject("text-2", "Second")] },
  ],
});

type Harness = { content: unknown; setContent: (next: unknown) => void; changes: number };
function Host({ harness }: { harness: Harness }) {
  const [content, setContent] = useState<unknown>(initialDeck);
  harness.content = content;
  harness.setContent = setContent;
  return (
    <StudioContractProvider value={contract}>
      <PresentationStudio
        artifactId="deck-1"
        artifacts={[]}
        content={content}
        onChange={(next) => {
          harness.changes += 1;
          setContent(next);
        }}
        readOnly={false}
        synchronizationReady
      />
    </StudioContractProvider>
  );
}

/** The slide's text box: the shared rich field, written in place. */
async function editableBox(value: string) {
  await waitFor(() =>
    expect(
      editors.find((editor) => !editor.isDestroyed && editor.isEditable && editor.getText() === value),
    ).toBeTruthy(),
  );
  const editor = editors.find(
    (candidate) => !candidate.isDestroyed && candidate.isEditable && candidate.getText() === value,
  )!;
  expect(screen.getAllByLabelText("Slide text")).toContain(editor.view.dom);
  return editor;
}

function focus(editor: Editor) {
  fireEvent.focus(editor.view.dom);
}

function type(editor: Editor, text: string) {
  act(() => {
    editor.commands.insertContentAt(editor.state.doc.content.size - 1, text);
  });
}

function blur(editor: Editor) {
  fireEvent.blur(editor.view.dom);
}

function slideText(content: unknown, slide: number) {
  const deck = normalizePresentationContent(content);
  return (deck.slides[slide]!.objects[0]!.content as { text: string }).text;
}

beforeEach(() => {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
});
afterEach(() => {
  cleanup();
  editors.length = 0;
  vi.unstubAllGlobals();
});

describe("presentation text editing", () => {
  it("commits slide text while typing, before the box loses focus", async () => {
    const harness: Harness = { content: null, setContent: () => {}, changes: 0 };
    render(<Host harness={harness} />);
    const box = await editableBox("Hello");
    focus(box);
    type(box, " world");
    expect(slideText(harness.content, 0)).toBe("Hello world");
  });

  it("keeps a collaborator's edit to another slide made while this student typed", async () => {
    const harness: Harness = { content: null, setContent: () => {}, changes: 0 };
    render(<Host harness={harness} />);
    const box = await editableBox("Hello");
    focus(box);
    type(box, " there");
    act(() => {
      const deck = normalizePresentationContent(harness.content);
      harness.setContent({
        ...deck,
        slides: deck.slides.map((slide, index) =>
          index === 1
            ? { ...slide, objects: [{ ...slide.objects[0]!, content: { text: "Peer edit" } }] }
            : slide,
        ),
      });
    });
    type(box, "!");
    blur(box);
    expect(slideText(harness.content, 0)).toBe("Hello there!");
    expect(slideText(harness.content, 1)).toBe("Peer edit");
  });

  it("undoes the student's typing without reverting a collaborator's later edit", async () => {
    const harness: Harness = { content: null, setContent: () => {}, changes: 0 };
    render(<Host harness={harness} />);
    const box = await editableBox("Hello");
    focus(box);
    type(box, " class");
    blur(box);
    act(() => {
      const deck = normalizePresentationContent(harness.content);
      harness.setContent({
        ...deck,
        slides: deck.slides.map((slide, index) =>
          index === 1
            ? { ...slide, objects: [{ ...slide.objects[0]!, content: { text: "Peer edit" } }] }
            : slide,
        ),
      });
    });
    fireEvent.keyDown(document.body, { key: "z", ctrlKey: true });
    expect(slideText(harness.content, 0)).toBe("Hello");
    expect(slideText(harness.content, 1)).toBe("Peer edit");
  });

  it("undoes the typing without reverting a collaborator's edit made while it went on", async () => {
    const harness: Harness = { content: null, setContent: () => {}, changes: 0 };
    render(<Host harness={harness} />);
    const box = await editableBox("Hello");
    focus(box);
    type(box, " class");
    act(() => {
      const deck = normalizePresentationContent(harness.content);
      harness.setContent({
        ...deck,
        slides: deck.slides.map((slide, index) =>
          index === 1
            ? { ...slide, objects: [{ ...slide.objects[0]!, content: { text: "Peer edit" } }] }
            : slide,
        ),
      });
    });
    type(box, "!");
    blur(box);
    fireEvent.keyDown(document.body, { key: "z", ctrlKey: true });
    expect(slideText(harness.content, 0)).toBe("Hello");
    expect(slideText(harness.content, 1)).toBe("Peer edit");
  });
});

describe("speaker notes", () => {
  function notes(content: unknown) {
    return normalizePresentationContent(content).slides[0]!.speakerNotes ?? "";
  }

  it("undoes a typing session in the notes as one step", () => {
    const harness: Harness = { content: null, setContent: () => {}, changes: 0 };
    render(<Host harness={harness} />);
    fireEvent.click(screen.getByRole("button", { name: /Speaker notes/ }));
    const field = screen.getByLabelText("Speaker notes for slide 1");
    fireEvent.focus(field);
    for (const value of ["S", "Sa", "Say", "Say hi"])
      fireEvent.change(field, { target: { value } });
    expect(notes(harness.content)).toBe("Say hi");
    fireEvent.blur(field);
    fireEvent.keyDown(document.body, { key: "z", ctrlKey: true });
    expect(notes(harness.content)).toBe("");
    fireEvent.keyDown(document.body, { key: "z", ctrlKey: true, shiftKey: true });
    expect(notes(harness.content)).toBe("Say hi");
  });
});
