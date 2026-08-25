import { preservedRegionRefusal } from "../registry";
import { regionsForLensFeature } from "./fidelity-regions";
import type { FidelityRegionKey } from "../types";

/**
 * The preservation promise, checked against the bytes.
 *
 * `commandForBinding` refuses a *control* that would write a preserved region,
 * and `gateOperation` refuses the assistant's *proposal* for the same reason. Both
 * are declarations: they trust a command to have named its regions honestly. This
 * is the check that does not trust anything — it compares the package Spectra
 * produced against the package it opened, part by part, and asks whether anything
 * the lens declared preserved actually moved.
 *
 * It sits on the materialize path because that is where a human edit and an AI
 * edit converge, so neither can be preserved-safe by accident of caller. A
 * declaration bug, a lens regression or a new operation that quietly rewrites the
 * wrong part all surface here, before the payload is queued for the Bridge, and
 * they surface with the same sentence the greyed-out button shows.
 *
 * Two verdicts are deliberately not violations:
 *
 *   `equivalent`  The part was reserialized but is L1-equal — the same XML, in
 *                 different bytes. "Preserved" is a promise about content, and a
 *                 binary part (a macro project, a picture) has no L1 form, so it
 *                 gets byte equality automatically and this exemption cannot
 *                 quietly widen to the parts that matter most.
 *   presence      A part that exists on only one side was added or removed, not
 *                 rewritten. Deleting a slide legitimately orphans its notes
 *                 part, and refusing that would make removal impossible; what
 *                 must never happen is a preserved part surviving with different
 *                 content, which is what this catches.
 */

/** Enough of a comparison row to judge it. Structurally `PackagePartComparison`. */
export type ComparedPart = {
  name: string;
  verdict: string;
  note?: string;
  diffs?: readonly { path: string }[];
};

/** Enough of a lens entry to know what it preserves and where. */
export type PreservationEntry = {
  feature?: unknown;
  class?: unknown;
  partName?: unknown;
  pathPattern?: unknown;
  readOnly?: unknown;
  reason?: unknown;
};

export type PreservationViolation = {
  /** The part as the package stores it, with a leading slash. */
  partName: string;
  /** The lens feature that claimed it, for a message that names something real. */
  feature: string;
  region?: FidelityRegionKey;
  reason: string;
};

/** Notes `comparePackages` uses for a part that exists on only one side. */
const PRESENCE_NOTES = new Set(["only in expected package", "only in actual package"]);

const normalize = (name: string) => (name.startsWith("/") ? name : `/${name}`);

/**
 * Every part the lens promised to preserve that came back with different
 * content. An empty array is the promise kept.
 */
export function preservationViolations(input: {
  entries: readonly PreservationEntry[];
  parts: readonly ComparedPart[];
}): PreservationViolation[] {
  const claimed = new Map<string, { feature: string; pathPattern?: string }>();
  for (const entry of input.entries) {
    const preserved = entry.class === "PRESERVED" || entry.readOnly === true;
    if (!preserved || typeof entry.partName !== "string" || !entry.partName) continue;
    const key = normalize(entry.partName);
    // First claim wins, so the message names one feature rather than a list. Any
    // of them is enough to explain why the part must not change.
    if (!claimed.has(key)) {
      claimed.set(key, {
        feature: typeof entry.feature === "string" ? entry.feature : "",
        ...(typeof entry.pathPattern === "string" && entry.pathPattern
          ? { pathPattern: entry.pathPattern }
          : {}),
      });
    }
  }

  const violations: PreservationViolation[] = [];
  for (const part of input.parts) {
    if (part.verdict !== "different") continue;
    if (part.note && PRESENCE_NOTES.has(part.note)) continue;
    const key = normalize(part.name);
    const claim = claimed.get(key);
    if (claim === undefined) continue;
    if (
      claim.pathPattern &&
      !(part.diffs ?? []).some((diff) =>
        diff.path.split("/").some((segment) => {
          const localName = segment.replace(/\[\d+\]$/, "").split(":").pop();
          return localName === claim.pathPattern;
        }),
      )
    )
      continue;
    const feature = claim.feature;
    const region = regionsForLensFeature(feature)[0];
    violations.push({
      partName: key,
      feature,
      ...(region ? { region } : {}),
      // The same sentence the bar shows, so a person who was told Spectra
      // preserves their macros never sees Spectra having rewritten them.
      reason: region
        ? preservedRegionRefusal(region)
        : `Spectra preserves ${key} in this file but cannot edit it, so this change cannot be written while the original is linked.`,
    });
  }
  return violations;
}

/**
 * The refusal, as one sentence for a person plus a code a caller can branch on.
 * Thrown rather than returned: a payload that has already broken a preservation
 * promise must not reach the Bridge queue, and there is no partial version of
 * this that is safe to save.
 */
export class PreservationViolationError extends Error {
  constructor(public readonly violations: readonly PreservationViolation[]) {
    const first = violations[0];
    super(
      `NATIVE_PRESERVATION_VIOLATION: ${
        first ? first.reason : "This change would rewrite content Spectra promised to preserve."
      }${
        violations.length > 1
          ? ` ${violations.length - 1} other preserved ${
              violations.length === 2 ? "part" : "parts"
            } would also change.`
          : ""
      } Parts: ${violations.map((violation) => violation.partName).join(", ")}.`,
    );
    this.name = "PreservationViolationError";
  }
}

/** Throws when a write would change something the lens promised to preserve. */
export function assertPreservationKept(input: {
  entries: readonly PreservationEntry[];
  parts: readonly ComparedPart[];
}) {
  const violations = preservationViolations(input);
  if (violations.length) throw new PreservationViolationError(violations);
}
