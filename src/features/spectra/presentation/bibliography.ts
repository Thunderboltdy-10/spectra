import type {
  PresentationContent,
  PresentationObject,
  PresentationSlide,
} from "./model";

type EditableCitationUse = Omit<DeckCitationUse, "slideNumbers"> & {
  slideNumbers: number[];
  order: number;
};

/**
 * Generated bibliography slides (§11E).
 *
 * The deck already holds a citation list per slide. This module turns those
 * scattered notes into one honest References surface: citations are collected
 * in slide order, deduplicated, given slide provenance and rendered onto
 * generated slides that regenerate in place instead of stacking copies. An
 * entry without a URL is not hidden — it is marked as needing a source,
 * because a silent gap would read as a finished bibliography (INV-09).
 */

export const BIBLIOGRAPHY_SLIDE_MARKER = "spectra:generated-bibliography";

export type DeckCitationUse = {
  citationId: string;
  label: string;
  url?: string;
  /** One-based slide numbers the citation appears on, in deck order. */
  slideNumbers: readonly number[];
  /** The citation names a source the reader could open; without one it cannot
   * be checked and is presented as unverified rather than dropped. */
  verified: boolean;
};

/**
 * Reads every slide citation in deck order. Citations with the same text are
 * one source used in several places, so they merge into a single entry that
 * names every slide it supports.
 */
export function collectDeckCitations(
  deck: PresentationContent,
): readonly DeckCitationUse[] {
  const entries = new Map<string, EditableCitationUse>();
  deck.slides.forEach((slide, slideIndex) => {
    // Generated bibliography slides restate citations; they are not
    // themselves evidence.
    if (slide.accessibility?.label === BIBLIOGRAPHY_SLIDE_MARKER) return;
    for (const citation of slide.citations ?? []) {
      const label = citation.label.trim();
      if (!label) continue;
      const key = `${label.toLowerCase()}\n${(citation.url ?? "").trim().toLowerCase()}`;
      const existing = entries.get(key);
      if (existing) {
        if (!existing.slideNumbers.includes(slideIndex + 1))
          existing.slideNumbers.push(slideIndex + 1);
      } else {
        entries.set(key, {
          citationId: citation.id,
          label,
          ...(citation.url?.trim() ? { url: citation.url.trim() } : {}),
          slideNumbers: [slideIndex + 1],
          verified: Boolean(citation.url?.trim()),
          order: entries.size,
        });
      }
    }
  });
  return [...entries.values()]
    .sort((left, right) => left.order - right.order)
    .map(({ order: _order, ...entry }) => entry);
}

function entryText(entry: DeckCitationUse, index: number) {
  const slides =
    entry.slideNumbers.length === 1
      ? `slide ${entry.slideNumbers[0]}`
      : `slides ${entry.slideNumbers.join(", ")}`;
  const line = `${index + 1}. ${entry.label.replaceAll(/\s+/g, " ").trim()}`;
  const url = entry.url ? ` — ${entry.url}` : "";
  return `${line}${url} (${slides})`;
}

function citationTitle(deck: PresentationContent, ordinal: number) {
  const base = "References";
  return ordinal === 1 ? base : `${base} (${ordinal})`;
}

function bibliographySlideId(deck: PresentationContent, ordinal: number) {
  const suffix = ordinal === 1 ? "" : `-${ordinal}`;
  const wanted = `bibliography${suffix}`;
  const taken = new Set(
    deck.slides
      .filter(
        (slide) => slide.accessibility?.label !== BIBLIOGRAPHY_SLIDE_MARKER,
      )
      .map((slide) => slide.id),
  );
  return taken.has(wanted) ? `${wanted}-${deck.slides.length + 1}` : wanted;
}

/**
 * Lays out one page of the bibliography. Entries share the deck's canvas
 * bounds so the slide exports and presents exactly like authored content.
 */
function buildBibliographySlide(
  deck: PresentationContent,
  entries: readonly DeckCitationUse[],
  startIndex: number,
  ordinal: number,
): PresentationSlide {
  const canvasHeight = deck.settings?.aspectRatio === "4:3" ? 750 : 562.5;
  const titleHeight = 84;
  const entryHeight = 42;
  const top = 128;
  const capacity = Math.max(
    1,
    Math.floor((canvasHeight - top - 60) / entryHeight),
  );
  const page = entries.slice(startIndex, startIndex + capacity);
  const objects: PresentationObject[] = [
    {
      id: `${bibliographySlideId(deck, ordinal)}:title`,
      type: "text",
      x: 80,
      y: 44,
      width: 840,
      height: titleHeight,
      rotation: 0,
      readingOrder: 0,
      content: { text: citationTitle(deck, ordinal) },
      style: { fontSize: 56, fontWeight: 650, align: "left" },
    },
    ...page.map((entry, pageIndex) => {
      const index = startIndex + pageIndex;
      return {
        id: `${bibliographySlideId(deck, ordinal)}:entry-${index + 1}`,
        type: "text" as const,
        x: 80,
        y: top + pageIndex * entryHeight,
        width: 840,
        height: entryHeight - 6,
        rotation: 0,
        readingOrder: index + 1,
        content: { text: entryText(entry, index) },
        style: {
          fontSize: 24,
          fontWeight: 400,
          align: "left",
          ...(entry.verified ? {} : { italic: true }),
        },
        ...(entry.verified
          ? {}
          : { altText: `Unverified citation: ${entry.label}` }),
      };
    }),
    ...(page.length === 0
      ? [
          {
            id: `${bibliographySlideId(deck, ordinal)}:empty`,
            type: "text" as const,
            x: 80,
            y: top,
            width: 840,
            height: 60,
            rotation: 0,
            readingOrder: 1,
            content: {
              text: "Add a citation to a slide and it appears here.",
            },
            style: { fontSize: 26, fontWeight: 400, align: "left" },
          },
        ]
      : []),
  ];
  return {
    id: bibliographySlideId(deck, ordinal),
    title: citationTitle(deck, ordinal),
    objects,
    speakerNotes: page
      .map((entry, pageIndex) => entryText(entry, startIndex + pageIndex))
      .join("\n"),
    accessibility: { label: BIBLIOGRAPHY_SLIDE_MARKER },
    transition: { kind: "fade", durationMs: 350 },
  };
}

export type BibliographyPlan = {
  /** Slides to insert, in order, replacing any existing generated slides. */
  slides: readonly PresentationSlide[];
  /** How many generated slides already exist in the deck. */
  replaces: number;
};

/**
 * Computes the bibliography slides the deck should end with. Keeping planning
 * separate from mutation lets the UI and AI run the same regeneration through
 * one claimed structural operation.
 */
export function planBibliographySlides(
  deck: PresentationContent,
): BibliographyPlan {
  const entries = collectDeckCitations(deck);
  const existing = deck.slides.filter(
    (slide) => slide.accessibility?.label === BIBLIOGRAPHY_SLIDE_MARKER,
  );
  const canvasHeight = deck.settings?.aspectRatio === "4:3" ? 750 : 562.5;
  const capacity = Math.max(1, Math.floor((canvasHeight - 128 - 60) / 42));
  const pageCount = Math.max(1, Math.ceil(entries.length / capacity));
  const slides = Array.from({ length: pageCount }, (_unused, index) =>
    buildBibliographySlide(deck, entries, index * capacity, index + 1),
  );
  return { slides, replaces: existing.length };
}

/**
 * Applies the bibliography plan to a draft of the deck (call inside a content
 * mutation). Generated slides always move to the back so regeneration is
 * idempotent: a stale generated slide, wherever it sits, is replaced rather
 * than duplicated.
 */
export function applyBibliographySlides(deck: PresentationContent) {
  const plan = planBibliographySlides(deck);
  const kept = deck.slides.filter(
    (slide) => slide.accessibility?.label !== BIBLIOGRAPHY_SLIDE_MARKER,
  );
  deck.slides.splice(0, deck.slides.length, ...kept, ...plan.slides);
  return plan;
}

/** Removes generated bibliography slides, e.g. when the user clears all citations. */
export function removeBibliographySlides(deck: PresentationContent) {
  const kept = deck.slides.filter(
    (slide) => slide.accessibility?.label !== BIBLIOGRAPHY_SLIDE_MARKER,
  );
  deck.slides.splice(0, deck.slides.length, ...kept);
}

/** Points record/citation helpers at the slides carrying generated sources. */
export function bibliographySlideIds(deck: PresentationContent) {
  return deck.slides
    .filter((slide) => slide.accessibility?.label === BIBLIOGRAPHY_SLIDE_MARKER)
    .map((slide) => slide.id);
}
