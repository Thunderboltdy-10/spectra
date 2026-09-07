import { describe, expect, it } from "vitest";

import { requireBlueprint } from "../artifacts/blueprint-catalog";
import { applyPresentationLayout } from "../presentation/layouts";
import {
  createDefaultPresentationContent,
  createPresentationObject,
  normalizePresentationContent,
  producePresentationContent,
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
        tokens: { background: "#fbfaf5" },
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
