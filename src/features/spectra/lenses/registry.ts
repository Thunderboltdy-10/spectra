import {
  DOCX_LENS_DELTA_KINDS,
  PPTX_LENS_DELTA_KINDS,
  XLSX_LENS_DELTA_KINDS,
} from "./projection-contracts";
import { CSV_LENS_DELTA_KINDS, csvLens } from "./csv-lens";
import { docxLens } from "./docx-lens";
import { MD_LENS_DELTA_KINDS, mdLens } from "./md-lens";
import { pptxLens } from "./pptx-lens";
import type { SpectraLens } from "./types";
import { xlsxLens } from "./xlsx-lens";

export type LensWorkType = "document" | "sheets" | "presentation";
type ErasedLens = SpectraLens<unknown, unknown>;

export type LensRegistration = {
  /** The format the concrete lens reports on its own contract. */
  readonly canonicalFormat: string;
  /** Every native file extension that is byte-compatible with this lens. */
  readonly nativeFormats: readonly string[];
  readonly workType: LensWorkType;
  /** Imported from the lens's real Zod delta schema, never source-scanned. */
  readonly deltaKinds: ReadonlySet<string>;
  readonly lens: ErasedLens;
};

function eraseLens<P, D>(lens: SpectraLens<P, D>): ErasedLens {
  return lens as unknown as ErasedLens;
}

function registration<P, D>(input: {
  canonicalFormat: string;
  nativeFormats: readonly string[];
  workType: LensWorkType;
  deltaKinds: readonly string[];
  lens: SpectraLens<P, D>;
}): LensRegistration {
  return {
    ...input,
    deltaKinds: new Set(input.deltaKinds),
    lens: eraseLens(input.lens),
  };
}

/** The one nativeFormat → SpectraLens source used by routes and ghost gates. */
export const LENS_REGISTRATIONS: readonly LensRegistration[] = [
  registration({
    canonicalFormat: "docx",
    nativeFormats: ["docx", "docm", "dotx", "dotm"],
    workType: "document",
    deltaKinds: DOCX_LENS_DELTA_KINDS,
    lens: docxLens,
  }),
  registration({
    canonicalFormat: "xlsx",
    nativeFormats: ["xlsx", "xlsm", "xltx", "xltm", "xlam"],
    workType: "sheets",
    deltaKinds: XLSX_LENS_DELTA_KINDS,
    lens: xlsxLens,
  }),
  registration({
    canonicalFormat: "pptx",
    nativeFormats: ["pptx", "pptm", "potx", "potm", "ppsx", "ppsm", "ppam"],
    workType: "presentation",
    deltaKinds: PPTX_LENS_DELTA_KINDS,
    lens: pptxLens,
  }),
  registration({
    canonicalFormat: "md",
    nativeFormats: ["md", "markdown"],
    workType: "document",
    deltaKinds: MD_LENS_DELTA_KINDS,
    lens: mdLens,
  }),
  registration({
    canonicalFormat: "csv",
    nativeFormats: ["csv"],
    workType: "sheets",
    deltaKinds: CSV_LENS_DELTA_KINDS,
    lens: csvLens,
  }),
];

function normalizeNativeFormat(nativeFormat: string) {
  return nativeFormat.trim().toLowerCase().replace(/^\./u, "");
}

function buildRegistry(registrations: readonly LensRegistration[]) {
  const byFormat = new Map<string, LensRegistration>();
  for (const row of registrations) {
    if (row.lens.format !== row.canonicalFormat) {
      throw new Error(
        `LENS_REGISTRY_CANONICAL_MISMATCH: ${row.canonicalFormat} registered a ${row.lens.format} lens.`,
      );
    }
    if (!row.nativeFormats.length || !row.deltaKinds.size) {
      throw new Error(
        `LENS_REGISTRY_INCOMPLETE: ${row.canonicalFormat} needs native formats and real delta kinds.`,
      );
    }
    for (const nativeFormat of row.nativeFormats) {
      const normalized = normalizeNativeFormat(nativeFormat);
      if (!normalized) {
        throw new Error(
          `LENS_REGISTRY_FORMAT_EMPTY: ${row.canonicalFormat} contains an empty native format.`,
        );
      }
      const existing = byFormat.get(normalized);
      if (existing) {
        throw new Error(
          `LENS_REGISTRY_FORMAT_DUPLICATE: ${normalized} belongs to both ${existing.canonicalFormat} and ${row.canonicalFormat}.`,
        );
      }
      byFormat.set(normalized, row);
    }
  }
  return byFormat;
}

const registry = buildRegistry(LENS_REGISTRATIONS);

export function lensRegistrationFor(nativeFormat: string) {
  return registry.get(normalizeNativeFormat(nativeFormat));
}

export function requireLensRegistration(nativeFormat: string) {
  const row = lensRegistrationFor(nativeFormat);
  if (!row) {
    throw new Error(
      `LENS_FORMAT_UNREGISTERED: Spectra has no lens registered for ${normalizeNativeFormat(nativeFormat) || "this format"}.`,
    );
  }
  return row;
}

export function registeredLens<P, D>(nativeFormat: string): SpectraLens<P, D> {
  return requireLensRegistration(nativeFormat).lens as unknown as SpectraLens<
    P,
    D
  >;
}

export type ConnectorNativeWriteClaim = {
  capabilityId: string;
  workType: LensWorkType;
  nativeFormat: string;
  delta: string;
};

/**
 * Cross-check connector-backed native writes against the same registry routes
 * execute. A format alias with no lens, a wrong artifact family, or a delta
 * absent from the lens schema is a build-time ghost.
 */
export function connectorNativeWriteIssues(
  claims: readonly ConnectorNativeWriteClaim[],
) {
  const issues: string[] = [];
  const seen = new Set<string>();
  for (const claim of claims) {
    const key = `${claim.capabilityId}:${normalizeNativeFormat(claim.nativeFormat)}`;
    if (seen.has(key)) {
      issues.push(
        `${claim.capabilityId}: declares ${claim.nativeFormat} more than once.`,
      );
      continue;
    }
    seen.add(key);
    const row = lensRegistrationFor(claim.nativeFormat);
    if (!row) {
      issues.push(
        `${claim.capabilityId}: claims a connector-backed ${claim.nativeFormat} write, but that native format has no registered lens.`,
      );
      continue;
    }
    if (row.workType !== claim.workType) {
      issues.push(
        `${claim.capabilityId}: claims ${claim.nativeFormat} for ${claim.workType}, but the registry assigns it to ${row.workType}.`,
      );
    }
    if (!row.deltaKinds.has(claim.delta)) {
      issues.push(
        `${claim.capabilityId}: claims connector-backed delta "${claim.delta}" for ${claim.nativeFormat}, but the registered ${row.canonicalFormat} lens does not implement it.`,
      );
    }
  }
  return issues;
}

export const REGISTERED_NATIVE_FORMATS = Object.freeze([...registry.keys()]);
