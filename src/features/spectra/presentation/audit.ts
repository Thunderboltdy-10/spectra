import {
  presentationObjectText,
  type PresentationContent,
  type PresentationObject,
  type PresentationSlide,
} from "./model";
import { BIBLIOGRAPHY_SLIDE_MARKER } from "./bibliography";

/**
 * Reading a deck for the things that quietly ruin it in a room.
 *
 * Overflowing text, grey-on-grey headings, a chart nobody can hear described,
 * a stacking order that reads out of sequence, a claim with no source. Each is
 * cheap to check and expensive to discover on stage, so the check is one pure
 * function: the studio calls it from the `design.audit` command, and the AI
 * plane answers `inspect_deck`, `check_overflow`, `check_contrast`,
 * `check_reading_order` and `check_source_coverage` with the same numbers a
 * person sees.
 */

export type DeckAuditFinding = {
  kind: "overflow" | "contrast" | "altText" | "readingOrder" | "sources";
  slideId: string;
  slideIndex: number;
  objectId?: string;
  /** One plain sentence, already fit to show in the status line. */
  message: string;
};

export type DeckAuditReport = {
  findings: readonly DeckAuditFinding[];
  counts: Record<DeckAuditFinding["kind"], number>;
  /** The single sentence the status line shows. */
  summary: string;
};

/** The type ramp the studio draws with, so the estimate matches the stage. */
const AVERAGE_GLYPH_RATIO = 0.52;
const LINE_HEIGHT_RATIO = 1.25;

function styleNumber(object: PresentationObject, key: string, fallback: number) {
  const value = object.style?.[key];
  const next = typeof value === "number" ? value : Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function styleString(object: PresentationObject, key: string) {
  const value = object.style?.[key];
  return typeof value === "string" ? value : undefined;
}

/**
 * Whether the text in a frame needs more lines than the frame has room for.
 * A frame is measured, not guessed at: characters per line come from the frame
 * width and the font size, and the line count from the text itself.
 */
export function estimateTextOverflow(object: PresentationObject) {
  const text = presentationObjectText(object);
  if (!text.trim()) return false;
  const fontSize = styleNumber(object, "fontSize", 21);
  const charsPerLine = Math.max(
    1,
    Math.floor(object.width / (fontSize * AVERAGE_GLYPH_RATIO)),
  );
  const lines = text.split(/\r?\n/).reduce((total, paragraph) => {
    const length = paragraph.trim().length;
    return total + Math.max(1, Math.ceil(length / charsPerLine));
  }, 0);
  const lineHeight = styleNumber(object, "lineHeight", LINE_HEIGHT_RATIO);
  return lines * fontSize * lineHeight > object.height + fontSize * 0.35;
}

function channel(component: number) {
  const value = component / 255;
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

/**
 * Light-scheme paints from `spectra-app.css` `:root`, used only when a deck
 * colour is a `var(--token)` and there is no computed style (audit, Node).
 * Dark remaps stay in CSS; slide paper is authored against this table.
 */
const TOKEN_PAINT: Record<string, string> = {
  "bg-primary": "#fbfaf8",
  "bg-secondary": "#f6f4f0",
  "bg-tertiary": "#efede8",
  "bg-elevated": "#fffefd",
  "text-primary": "#211f1c",
  "text-secondary": "#65615b",
  "text-tertiary": "#716d67",
  "accent-mint": "#159b76",
  "border-strong": "#d4d0c8",
};

function resolvePaint(color: string | undefined) {
  if (!color) return undefined;
  const trimmed = color.trim();
  const token = /^var\(--([\w-]+)\)$/.exec(trimmed);
  if (!token) return trimmed;
  return TOKEN_PAINT[token[1]];
}

/** Relative luminance for a `#rgb` or `#rrggbb` colour, or undefined. */
export function relativeLuminance(color: string | undefined) {
  const resolved = resolvePaint(color);
  if (!resolved) return undefined;
  const hex = resolved.replace("#", "");
  const full =
    hex.length === 3
      ? hex
          .split("")
          .map((digit) => `${digit}${digit}`)
          .join("")
      : hex;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return undefined;
  const red = Number.parseInt(full.slice(0, 2), 16);
  const green = Number.parseInt(full.slice(2, 4), 16);
  const blue = Number.parseInt(full.slice(4, 6), 16);
  return (
    0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue)
  );
}

/** WCAG contrast ratio, or undefined when either colour is not a plain hex or known token. */
export function contrastRatio(foreground?: string, background?: string) {
  const first = relativeLuminance(foreground);
  const second = relativeLuminance(background);
  if (first === undefined || second === undefined) return undefined;
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

function slideBackground(slide: PresentationSlide, deck: PresentationContent) {
  return slide.background ?? deck.theme.tokens?.background ?? "var(--bg-elevated)";
}

/** Objects that carry meaning a screen reader cannot get from their text. */
const NEEDS_ALT_TEXT = new Set(["image", "video", "chart", "table", "embed"]);

export function auditDeck(deck: PresentationContent): DeckAuditReport {
  const findings: DeckAuditFinding[] = [];
  const citationsAnywhere = deck.slides.some((slide) => slide.citations?.length);

  deck.slides.forEach((slide, slideIndex) => {
    const generatedBibliography =
      slide.accessibility?.label === BIBLIOGRAPHY_SLIDE_MARKER;
    const background = slideBackground(slide, deck);
    const visible = slide.objects.filter((object) => !object.hidden);

    for (const object of visible) {
      if (object.type === "text" && estimateTextOverflow(object)) {
        findings.push({
          kind: "overflow",
          slideId: slide.id,
          slideIndex,
          objectId: object.id,
          message: `Slide ${slideIndex + 1} has text that runs past its frame.`,
        });
      }

      if (object.type === "text") {
        const ink =
          styleString(object, "color") ?? deck.theme.tokens?.body ?? "#000000";
        const behind = styleString(object, "fill") ?? background;
        const ratio = contrastRatio(ink, behind);
        const large = styleNumber(object, "fontSize", 21) >= 24;
        const floor = large ? 3 : 4.5;
        if (ratio !== undefined && ratio < floor) {
          findings.push({
            kind: "contrast",
            slideId: slide.id,
            slideIndex,
            objectId: object.id,
            message: `Slide ${slideIndex + 1} has text at ${ratio.toFixed(1)} to 1 against its background, under the ${floor} to 1 this size needs.`,
          });
        }
      }

      if (NEEDS_ALT_TEXT.has(object.type) && !object.altText?.trim()) {
        findings.push({
          kind: "altText",
          slideId: slide.id,
          slideIndex,
          objectId: object.id,
          message: `Slide ${slideIndex + 1} has a ${object.type} with no description.`,
        });
      }
    }

    // Reading order is the stacking order of visible objects. Hidden or parked
    // extras are not part of the spoken sequence.
    const declared = slide.accessibility?.readingOrder ?? [];
    if (visible.length >= 3) {
      const covered =
        declared.length === visible.length &&
        visible.every((object) => declared.includes(object.id));
      if (!covered) {
        findings.push({
          kind: "readingOrder",
          slideId: slide.id,
          slideIndex,
          message: `Slide ${slideIndex + 1} has no confirmed reading order for its ${visible.length} objects.`,
        });
      }
    }

    // Source coverage only means something once the deck cites at all. A deck
    // with no citations anywhere is a different decision, not an omission.
    if (
      citationsAnywhere &&
      !generatedBibliography &&
      !slide.citations?.length
    ) {
      const hasClaim = visible.some(
        (object) => presentationObjectText(object).trim().length > 60,
      );
      if (hasClaim) {
        findings.push({
          kind: "sources",
          slideId: slide.id,
          slideIndex,
          message: `Slide ${slideIndex + 1} makes a claim with no source attached.`,
        });
      }
    }
  });

  const counts: Record<DeckAuditFinding["kind"], number> = {
    overflow: 0,
    contrast: 0,
    altText: 0,
    readingOrder: 0,
    sources: 0,
  };
  for (const finding of findings) counts[finding.kind] += 1;

  const parts: string[] = [];
  if (counts.overflow) parts.push(`${counts.overflow} overflowing`);
  if (counts.contrast) parts.push(`${counts.contrast} low contrast`);
  if (counts.altText) parts.push(`${counts.altText} undescribed`);
  if (counts.readingOrder) parts.push(`${counts.readingOrder} unordered`);
  if (counts.sources) parts.push(`${counts.sources} uncited`);

  const summary = findings.length
    ? `${deck.slides.length} slides checked: ${parts.join(", ")}.`
    : `${deck.slides.length} slides checked. Nothing to fix.`;

  return { findings, counts, summary };
}
