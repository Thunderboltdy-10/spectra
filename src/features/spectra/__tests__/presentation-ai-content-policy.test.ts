import { describe, expect, it } from "vitest";
import { enforceAiPresentationContentPolicy } from "../presentation/ai-content-policy";
import { applyBibliographySlides, BIBLIOGRAPHY_SLIDE_MARKER } from "../presentation/bibliography";
import { normalizePresentationContent } from "../presentation/model";

function citedDeck() {
  return normalizePresentationContent({
    slides: [{
      id: "finding", title: "Shade reduced heat", speakerNotes: "Explain the measurement limits.",
      accessibility: { readingOrder: ["claim"] },
      sourceRefs: ["evidence:reading-p2"],
      citations: [{ id: "reading", label: "Courtyard study, p. 2", sourceRefs: ["evidence:reading-p2"] }],
      objects: [{ id: "claim", type: "text", content: { text: "The shaded surface was cooler." } }],
    }],
  });
}

describe("AI presentation content policy", () => {
  it.each([
    "Make a one-slide summary from the reading.",
    "Keep citations in notes, with no bibliography page.",
    "Resume la lectura en una diapositiva.",
    "Révise uniquement les notes de présentation.",
  ])("does not add slides to cited work: %s", (prompt) => {
    const deck = citedDeck();
    const before = structuredClone(deck);
    expect(enforceAiPresentationContentPolicy(deck, prompt)).toEqual(before);
  });

  it("accepts creative work without inventing a source requirement", () => {
    const deck = normalizePresentationContent({ slides: [{ id: "story", title: "The lost umbrella", objects: [] }] });
    expect(() => enforceAiPresentationContentPolicy(deck,
      "Make exactly one slide. No References slide; keep my performance cues in speaker notes.",
    )).not.toThrow();
    expect(deck.slides).toHaveLength(1);
    expect(deck.slides[0]!.citations ?? []).toEqual([]);
  });

  it("preserves an explicitly generated bibliography through unrelated edits, even without citations", () => {
    const deck = citedDeck();
    applyBibliographySlides(deck);
    const bibliography = structuredClone(deck.slides[1]);
    deck.slides[0]!.citations = [];
    deck.slides[0]!.speakerNotes = "A revised delivery cue.";
    enforceAiPresentationContentPolicy(deck, "Update the speaker notes.");
    expect(deck.slides[1]).toEqual(bibliography);
    expect(deck.slides[0]!.speakerNotes).toBe("A revised delivery cue.");
  });

  it("does not resurrect a removed generated slide on later writes or replay", () => {
    const deck = citedDeck();
    applyBibliographySlides(deck);
    deck.slides = deck.slides.filter((slide) => slide.accessibility?.label !== BIBLIOGRAPHY_SLIDE_MARKER);
    enforceAiPresentationContentPolicy(deck, "Remove the separate source slide.");
    expect(deck.slides).toHaveLength(1);
    const saved = JSON.parse(JSON.stringify(deck));
    enforceAiPresentationContentPolicy(saved, "Make the title shorter.");
    expect(saved.slides).toHaveLength(1);
    enforceAiPresentationContentPolicy(saved, "Make the title shorter.");
    expect(saved).toEqual(deck);
    expect(saved.slides[0].citations[0].sourceRefs).toEqual(["evidence:reading-p2"]);
  });

  it("does not mistake a narrative title for a generated bibliography", () => {
    const deck = citedDeck();
    deck.slides[0]!.title = "References in JavaScript";
    expect(() => enforceAiPresentationContentPolicy(deck,
      "Make exactly one slide without a References slide and keep citations in metadata.",
    )).not.toThrow();
    expect(deck.slides[0]!.title).toBe("References in JavaScript");
  });
});
