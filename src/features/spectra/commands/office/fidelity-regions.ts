import type { FidelityClass, FidelityRegionKey } from "../types";

/**
 * The translation between what a lens reports and what a command declares.
 *
 * A lens describes a native package in the package's own terms: DOCX has
 * `/word/footnotes.xml`, XLSX has a pivot cache part, PPTX has slide masters. A
 * command declares the regions it writes in one shared vocabulary
 * (`FidelityRegionKey`), so the same `touches: ["tables"]` means the same thing
 * in all three editors. Both vocabularies are right for their own job, and the
 * gap between them is exactly where the preservation gate silently stops
 * working: `fidelity["trackedChanges"]` is `undefined` when the lens wrote
 * `fidelity["revision-or-field-paragraph"]`, `regionBlockedBy` finds nothing,
 * and every control in the bar looks live on a file Spectra cannot write. The
 * bug is invisible in tests that build their own fidelity map by hand — which is
 * every test until this module exists.
 *
 * Two rules make the translation safe:
 *
 * **Only region-level facts count.** A lens also emits one entry per paragraph,
 * per cell and per slide. Those describe *one block*, not a region, and folding
 * them in would be a serious over-block: a document with a single tracked-change
 * paragraph would refuse all typing anywhere in the body. Per-block read-only
 * markers already have their own path (`nativeReadOnlyRegionIds`), so anything
 * not named here is deliberately ignored rather than guessed at.
 *
 * **The worst class wins.** A region is only as editable as its least editable
 * contributor, and lenses legitimately report the same region from more than one
 * angle — PPTX classes `media` from the media parts and `images` from the same
 * parts. Merging by "worst" makes the result independent of entry order, so a
 * lens cannot change the gate by reordering its own output.
 */

/**
 * Lens feature names that describe a whole region, and the regions each one
 * speaks for. Features already named in `FidelityRegionKey` pass through
 * unchanged, so a lens that emits region rows directly (DOCX and PPTX both do)
 * needs no entry here.
 *
 * Anything absent is not a hole to fill later — it is a per-block or per-cell
 * fact that must not become a region-wide refusal.
 */
const LENS_FEATURE_REGIONS: Readonly<Record<string, readonly FidelityRegionKey[]>> = {
  // Shared across formats.
  macro: ["macros"],
  macroContainer: ["macros"],
  comment: ["comments"],
  chart: ["charts"],
  unknownExtension: [],
  "unknown-extension": [],

  // DOCX part rules.
  headers: ["headersFooters"],
  footers: ["headersFooters"],
  endnotes: ["footnotes"],
  bibliography: ["fields"],
  // A content control or a text box is Word markup Spectra keeps but cannot
  // author, and both live inside document.xml — so they constrain fields and
  // shapes rather than the body text around them.
  contentControl: ["fields"],
  textBox: ["shapes"],

  // XLSX part rules. This lens reports parts rather than regions, so it is the
  // one that most needs translating.
  pivot: ["pivotTables"],
  "conditional-formatting": ["conditionalFormat"],
  "external-link": ["namedRanges"],
  sparkline: ["charts"],

  // PPTX part rules, alongside the region rows the same lens already emits.
  slide: [],
  master: ["masters"],
  layout: ["layouts"],
  notes: ["speakerNotes"],
  transition: ["transitions"],
  animation: ["animations"],
};

/**
 * How much each class restricts editing, worst last. `PRESERVED` is the only
 * class the gate refuses on, but the order still has to be total so merging is
 * deterministic when a lens reports the same region twice.
 */
const CLASS_SEVERITY: Readonly<Record<FidelityClass, number>> = {
  NATIVE: 0,
  EXTENSION: 1,
  EQUIVALENT: 2,
  PRESERVED: 3,
};

/** The lens classes this layer accepts. Anything else is ignored, not guessed. */
function asFidelityClass(value: unknown): FidelityClass | undefined {
  return value === "NATIVE" || value === "EQUIVALENT" || value === "PRESERVED" || value === "EXTENSION"
    ? value
    : undefined;
}

/**
 * The full region vocabulary, so a lens that already speaks it passes straight
 * through. Listed rather than derived because `FidelityRegionKey` is a type: it
 * does not exist at runtime, and a `Record` keyed by it would be one more place
 * to forget a key.
 */
const REGION_KEYS: ReadonlySet<string> = new Set<FidelityRegionKey>([
  "body", "styles", "lists", "tables", "images", "equations", "headersFooters",
  "footnotes", "fields", "trackedChanges", "sections", "comments", "macros",
  "customXml", "smartArt", "ole", "cells", "formulas", "numberFormats", "charts",
  "pivotTables", "validation", "conditionalFormat", "namedRanges", "slides",
  "masters", "layouts", "transitions", "animations", "media", "speakerNotes",
  "shapes",
]);

/** The regions one lens feature speaks for, or none if it is a per-block fact. */
export function regionsForLensFeature(feature: string): readonly FidelityRegionKey[] {
  if (REGION_KEYS.has(feature)) return [feature as FidelityRegionKey];
  return LENS_FEATURE_REGIONS[feature] ?? [];
}

export type LensFidelityLike = {
  feature?: unknown;
  class?: unknown;
};

/**
 * The fidelity map a command context is gated by, built from a lens's entries.
 *
 * `artifact: "NATIVE"` stays as the base so a surface with no linked package
 * behaves exactly as before. A region absent from the result is editable: the
 * honest default for a native file is that Spectra can write it, and inventing a
 * refusal for a region no lens mentioned would block work on files Spectra
 * handles correctly.
 */
export function fidelityRegionMap(
  entries: readonly LensFidelityLike[],
): Record<string, FidelityClass> {
  const result: Record<string, FidelityClass> = { artifact: "NATIVE" };
  for (const entry of entries) {
    const cls = asFidelityClass(entry.class);
    if (!cls || typeof entry.feature !== "string") continue;
    for (const region of regionsForLensFeature(entry.feature)) {
      const current = result[region];
      if (!current || CLASS_SEVERITY[cls] > CLASS_SEVERITY[current]) result[region] = cls;
    }
  }
  return result;
}
