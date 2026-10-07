import { describe, expect, it } from "vitest";

import { requireBlueprint } from "../artifacts/blueprint-catalog";
import { applyPresentationLayout } from "../presentation/layouts";
import {
  createDefaultPresentationContent,
  createPresentationObject,
  nativePresentationParagraphs,
  normalizePresentationContent,
  presentationObjectParagraphs,
  presentationParagraphsAreNative,
  producePresentationContent,
  retextPresentationParagraphs,
  withPresentationObjectParagraphs,
  withPresentationObjectText,
  type PresentationParagraph,
} from "../presentation/model";
import { workYjsAdapter } from "../work/models/yjs/registry";

describe("presentation object insertion", () => {
  it("cascades new layers so successive objects remain discoverable", () => {
    const first = createPresentationObject("text", 1);
    const second = createPresentationObject("text", 2);
    const third = createPresentationObject("shape", 3);

    expect([second.x, second.y]).toEqual([first.x + 22, first.y + 22]);
    expect([third.x, third.y]).toEqual([344, 224]);
  });
});

describe("presentation default deck", () => {
  it("starts New Presentation on a title slide when layout presets exist", () => {
    const deck = createDefaultPresentationContent();
    expect(deck.slides).toHaveLength(1);
    expect(deck.slides[0]?.layoutId).toBe("title-only");
    expect(deck.slides[0]?.objects.length).toBeGreaterThan(0);
    expect(deck.settings?.aspectRatio).toBe("16:9");
    expect(requireBlueprint("presentation").defaultContent).toEqual(deck);
  });

  it("applies title-only to an empty slide when createMissing is set", () => {
    const empty = normalizePresentationContent({
      theme: { id: "spectra-default" },
      slides: [{ id: "slide-1", title: "Empty", objects: [] }],
    });
    const next = producePresentationContent(empty, (draft) => {
      applyPresentationLayout(draft, 0, "title-only", { createMissing: true });
    });
    expect(next.slides[0]?.layoutId).toBe("title-only");
    expect(next.slides[0]?.objects).toHaveLength(1);
  });

  it("keeps React emits comparable to the Yjs projection", () => {
    const local = createDefaultPresentationContent();
    const edited = producePresentationContent(local, (draft) => {
      const object = draft.slides[0]!.objects[0]!;
      object.content = { text: "Opening title" };
    });
    const projected = workYjsAdapter("presentation").project(
      workYjsAdapter("presentation").createDocument(edited),
    );
    expect(projected).toEqual(normalizePresentationContent(edited));
  });

  it("isolates nested theme and object style edits in copy-on-write updates", () => {
    const base = createDefaultPresentationContent();
    const original = normalizePresentationContent({
      ...base,
      theme: {
        ...base.theme,
        tokens: { background: "var(--bg-primary)" },
      },
    });
    const originalColor = original.slides[0]!.objects[0]!.style?.color;

    const next = producePresentationContent(original, (draft) => {
      draft.theme.tokens!.background = "#ffffff";
      draft.slides[0]!.objects[0]!.style!.color = "#111111";
    });

    expect(original.theme.tokens?.background).not.toBe("#ffffff");
    expect(original.slides[0]!.objects[0]!.style?.color).toBe(originalColor);
    expect(next.theme.tokens?.background).toBe("#ffffff");
    expect(next.slides[0]!.objects[0]!.style?.color).toBe("#111111");
    expect(next).not.toBe(original);
  });
});

describe("writing in a text box keeps the deck's formatting", () => {
  const RED = ["#", "C00000"].join("");
  const deck: PresentationParagraph[] = [
    { runs: [{ text: "Bold ", bold: true }, { text: "red", color: RED }], alignment: "center" },
    { runs: [{ text: "First point", fontSizePt: 24 }], bullet: "bullet", level: 1 },
  ];

  it("keeps the runs around a typed letter and leaves other lines alone", () => {
    const next = retextPresentationParagraphs(deck, "Bold reds\nFirst point");
    expect(next[0]).toEqual({ runs: [{ text: "Bold ", bold: true }, { text: "reds", color: RED }], alignment: "center" });
    expect(next[1]).toBe(deck[1]);
  });

  it("gives a new line the bullet, level and style of the line it was split from", () => {
    const next = retextPresentationParagraphs(deck, "Bold red\nFirst point\nSecond");
    expect(next[2]).toEqual({ runs: [{ text: "Second", fontSizePt: 24 }], bullet: "bullet", level: 1 });
    expect(next.slice(0, 2)).toEqual(deck);
  });

  it("drops only the paragraph that was deleted", () => {
    expect(retextPresentationParagraphs(deck, "First point")).toEqual([deck[1]]);
  });

  it("is what a text box edit writes", () => {
    const object = { ...createPresentationObject("text", 1), content: { text: "Bold red", paragraphs: [deck[0]!] } };
    const next = withPresentationObjectText(object, "Bold red!") as typeof object;
    expect(next.content.paragraphs[0]!.runs).toEqual([{ text: "Bold ", bold: true }, { text: "red!", color: RED }]);
    expect(next.content.text).toBe("Bold red!");
  });
});

describe("Spectra-only slide text", () => {
  const paragraphs: PresentationParagraph[] = [
    { runs: [{ text: "Pack", bold: true, hyperlink: { kind: "external", url: "https://a.b" } }], bullet: "bullet", checked: true, level: 1 },
    { runs: [{ text: "Quoted" }, { text: " not italic", italic: false }], block: "quote" },
    { runs: [{ text: "Mind the units" }], bullet: "none", block: "callout", tone: "warning" },
    { runs: [{ text: "let x" }], block: "code" },
    { runs: [{ text: "\\frac{a}\n{b}" }], block: "math" },
    { runs: [{ text: "run " }, { text: "f()", code: true }, { text: "x^2", math: true }] },
  ];

  it("survives the model's own normalisation", () => {
    const object = { ...createPresentationObject("text"), content: { text: "", paragraphs } };
    expect(presentationObjectParagraphs(object)).toEqual(paragraphs);
  });

  it("keeps a tone only on a callout, and only one the editor offers", () => {
    const object = {
      ...createPresentationObject("text"),
      content: {
        text: "",
        paragraphs: [
          { runs: [{ text: "a" }], block: "callout", tone: "loud" },
          { runs: [{ text: "b" }], block: "quote", tone: "tip" },
        ],
      },
    };
    expect(presentationObjectParagraphs(object)).toEqual([
      { runs: [{ text: "a" }], block: "callout" },
      { runs: [{ text: "b" }], block: "quote" },
    ]);
  });

  it("gives PowerPoint the nearest thing DrawingML holds", () => {
    expect(presentationParagraphsAreNative(paragraphs)).toBe(false);
    const native = nativePresentationParagraphs(paragraphs);
    expect(presentationParagraphsAreNative(native)).toBe(true);
    expect(native).toEqual([
      { runs: [{ text: "☑ ", bold: true }, { text: "Pack", bold: true, hyperlink: { kind: "external", url: "https://a.b" } }], bullet: "none", level: 1 },
      { runs: [{ text: "Quoted", italic: true }, { text: " not italic", italic: false }] },
      // A callout reads as a quote in PowerPoint; its tone stays out of the file.
      { runs: [{ text: "Mind the units", italic: true }], bullet: "none" },
      { runs: [{ text: "let x", fontFamily: "Consolas" }] },
      { runs: [{ text: "\\frac{a} {b}", fontFamily: "Cambria Math" }] },
      { runs: [{ text: "run " }, { text: "f()", fontFamily: "Consolas" }, { text: "x^2", fontFamily: "Cambria Math" }] },
    ]);
  });

  it("writes a field's paragraphs with the words beside them", () => {
    const object = withPresentationObjectParagraphs(createPresentationObject("text"), paragraphs.slice(0, 2));
    expect(object.content).toMatchObject({ text: "Pack\nQuoted not italic", paragraphs: paragraphs.slice(0, 2) });
  });
});
