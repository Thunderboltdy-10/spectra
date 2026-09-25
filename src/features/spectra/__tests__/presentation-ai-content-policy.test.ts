import { describe, expect, it } from "vitest";
import {
  enforceAiPresentationContentPolicy,
  requestedNarrativeSlideCountWithoutReferences,
} from "@/features/spectra/presentation/ai-content-policy";
import { BIBLIOGRAPHY_SLIDE_MARKER } from "@/features/spectra/presentation/bibliography";
import type { PresentationContent } from "@/features/spectra/presentation/model";

const request =
  "Make the deck exactly six narrative slides. Remove the separate References slide and keep citations in native speaker notes or citation metadata.";

function deckWithGeneratedReferences() {
  return {
    settings: {},
    theme: { tokens: {} },
    slides: [
      ...Array.from({ length: 6 }, (_, index) => ({
        id: `slide-${index + 1}`,
        title: `Narrative ${index + 1}`,
        objects: [],
        accessibility: { readingOrder: [] },
        speakerNotes: "",
        sourceRefs:
          index === 0 ? ["evidence:source-1"] : [],
        citations:
          index === 0
            ? [
                {
                  id: "citation-source-1",
                  label: "Urban heat reading, page 1",
                  sourceRefs: ["evidence:source-1"],
                },
              ]
            : [],
      })),
      {
        id: "bibliography",
        title: "References",
        objects: [],
        accessibility: {
          label: BIBLIOGRAPHY_SLIDE_MARKER,
          readingOrder: [],
        },
        speakerNotes: "",
        sourceRefs: [],
        citations: [],
      },
    ],
  } as unknown as PresentationContent;
}

describe("AI presentation citation policy", () => {
  it("keeps an explicitly requested narrative slide count without losing verified citations", () => {
    const deck = deckWithGeneratedReferences();

    expect(requestedNarrativeSlideCountWithoutReferences(request)).toBe(6);
    expect(enforceAiPresentationContentPolicy(deck, request).slides).toHaveLength(6);
    expect(deck.slides[0]?.citations?.[0]?.sourceRefs).toEqual([
      "evidence:source-1",
    ]);
    expect(deck.slides.some((slide) => slide.title === "References")).toBe(
      false,
    );
  });

  it.each([
    "The deck must have exactly six narrative slides and no separate References slide, with citations in metadata.",
    "Make exactly six slides without a separate References slide; retain citations in speaker notes.",
    "Create exactly six narrative slides. Do not include a separate References slide; keep citation metadata.",
  ])("recognizes natural no-reference wording: %s", (prompt) => {
    expect(requestedNarrativeSlideCountWithoutReferences(prompt)).toBe(6);
  });

  it("keeps generated bibliography behavior unless the user explicitly requests otherwise", () => {
    expect(
      requestedNarrativeSlideCountWithoutReferences(
        "Update the deck and keep the citations.",
      ),
    ).toBeNull();
  });
});
