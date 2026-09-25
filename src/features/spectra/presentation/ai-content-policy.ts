import {
  applyBibliographySlides,
  collectDeckCitations,
  removeBibliographySlides,
  BIBLIOGRAPHY_SLIDE_MARKER,
} from "./bibliography";
import { ensurePresentationReadingOrders } from "./layouts";
import type { PresentationContent } from "./model";

const NUMBER_WORDS: Readonly<Record<string, number>> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
};

/**
 * Return a requested narrative slide count only when the user explicitly asks
 * to remove the separate references slide and retain citations in notes or
 * citation metadata. Ordinary presentation edits keep the bibliography rule.
 */
export function requestedNarrativeSlideCountWithoutReferences(prompt: string) {
  const removesReferences =
    /\b(?:remove|omit|drop|delete)\s+(?:(?:the|a)\s+)?(?:separate\s+)?(?:references?|bibliography|sources?)\s+slide\b|\bno\s+(?:separate\s+)?(?:references?|bibliography|sources?)\s+slide\b|\bwithout\s+(?:(?:the|a)\s+)?(?:separate\s+)?(?:references?|bibliography|sources?)\s+slide\b|\b(?:do\s+not|don't|dont)\s+(?:add|include|create|keep)\s+(?:(?:the|a)\s+)?(?:separate\s+)?(?:references?|bibliography|sources?)\s+slide\b/i.test(
      prompt,
    );
  const retainsCitations =
    /\b(?:speaker\s+notes|citation\s+metadata|metadata)\b/i.test(prompt);
  if (!removesReferences || !retainsCitations) return null;

  const match = prompt.match(
    /\bexactly\s+(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(?:narrative\s+)?slides?\b/i,
  );
  if (!match) return null;
  const rawCount = match[1]!.toLowerCase();
  const count = /^\d+$/.test(rawCount)
    ? Number(rawCount)
    : NUMBER_WORDS[rawCount];
  return Number.isInteger(count) && count! > 0 ? count! : null;
}

export function enforceAiPresentationContentPolicy(
  deck: PresentationContent,
  prompt: string,
) {
  ensurePresentationReadingOrders(deck);
  const requestedNarrativeSlideCount =
    requestedNarrativeSlideCountWithoutReferences(prompt);
  if (requestedNarrativeSlideCount !== null) {
    removeBibliographySlides(deck);
    if (deck.slides.length !== requestedNarrativeSlideCount) {
      throw new Error(
        `PRESENTATION_NARRATIVE_SLIDE_COUNT_MISMATCH: Expected ${requestedNarrativeSlideCount} narrative slides after removing generated references.`,
      );
    }
    if (
      deck.slides.some(
        (slide) =>
          slide.accessibility?.label === BIBLIOGRAPHY_SLIDE_MARKER ||
          /^references(?:\b|\s*[:(])/i.test(slide.title.trim()),
      )
    ) {
      throw new Error(
        "PRESENTATION_REFERENCES_SLIDE_REMAINS: Keep the requested narrative slides and retain citations in notes or citation metadata.",
      );
    }
    const citations = collectDeckCitations(deck);
    if (!citations.length || citations.some((citation) => !citation.verified)) {
      throw new Error(
        "PRESENTATION_CITATION_EVIDENCE_REQUIRED: The requested reference-free deck must retain verified citation metadata on its narrative slides.",
      );
    }
    return deck;
  }

  if (collectDeckCitations(deck).length > 0) {
    applyBibliographySlides(deck);
  } else {
    removeBibliographySlides(deck);
  }
  return deck;
}
