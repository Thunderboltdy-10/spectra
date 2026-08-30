import { registeredLens, requireLensRegistration } from "./registry";
import type {
  LensFidelityClass,
  LensFidelityMap,
  LensOpenResult,
  LensPreservedCarry,
} from "./types";

export type InterchangeBoundaryEntry = {
  /** A shared fidelity feature/region name such as body, tables, or charts. */
  feature: string;
  /** Conversion can never silently claim native fidelity. */
  class: Exclude<LensFidelityClass, "NATIVE">;
  reason: string;
  readOnly?: boolean;
};

export type InterchangeExport = {
  payload: Uint8Array;
  /** The provider token (etag/version/headRevisionId) that produced the bytes. */
  providerRevision: string;
};

/**
 * A remote provider owns conversion into an already registered interchange
 * format. The lens contract remains unchanged; this shim makes the conversion
 * boundary explicit and composable with that lens's fidelity map.
 */
export interface ProviderInterchangeShim<ProviderNative, ProviderWrite> {
  readonly id: string;
  readonly providerId: string;
  readonly providerNativeFormat: string;
  readonly interchangeFormat: string;
  readonly direction: "read-only" | "round-trip";
  readonly fidelityBoundary: readonly InterchangeBoundaryEntry[];
  toInterchange(input: ProviderNative): Promise<InterchangeExport>;
  fromInterchange?: (
    payload: Uint8Array,
    context: { providerRevision: string },
  ) => Promise<ProviderWrite>;
}

export function interchangeShimIssues(
  shim: ProviderInterchangeShim<unknown, unknown>,
) {
  const issues: string[] = [];
  if (!shim.id.trim()) issues.push("An interchange shim needs a stable id.");
  if (!shim.providerId.trim()) issues.push(`${shim.id}: provider id is empty.`);
  if (!shim.providerNativeFormat.trim()) {
    issues.push(`${shim.id}: provider-native format is empty.`);
  }
  if (!shim.interchangeFormat.trim()) {
    issues.push(`${shim.id}: interchange format is empty.`);
  } else if (!requireLensRegistrationSafe(shim.interchangeFormat)) {
    issues.push(
      `${shim.id}: interchange format ${shim.interchangeFormat} has no registered lens.`,
    );
  }
  if (!shim.fidelityBoundary.length) {
    issues.push(`${shim.id}: conversion fidelity boundary is empty.`);
  }
  const seen = new Set<string>();
  for (const entry of shim.fidelityBoundary) {
    if (!entry.feature.trim()) {
      issues.push(`${shim.id}: conversion boundary contains an empty feature.`);
    }
    if (!entry.reason.trim()) {
      issues.push(
        `${shim.id}:${entry.feature || "unknown"}: conversion boundary has no plain-language reason.`,
      );
    }
    if (seen.has(entry.feature)) {
      issues.push(
        `${shim.id}: conversion boundary declares ${entry.feature} more than once.`,
      );
    }
    seen.add(entry.feature);
  }
  if (shim.direction === "round-trip" && !shim.fromInterchange) {
    issues.push(
      `${shim.id}: claims round-trip conversion but has no interchange-to-provider writer.`,
    );
  }
  if (shim.direction === "read-only" && shim.fromInterchange) {
    issues.push(
      `${shim.id}: is read-only but exposes an interchange-to-provider writer.`,
    );
  }
  return issues;
}

function requireLensRegistrationSafe(nativeFormat: string) {
  try {
    return requireLensRegistration(nativeFormat);
  } catch {
    return undefined;
  }
}

export function assertInterchangeShim(
  shim: ProviderInterchangeShim<unknown, unknown>,
) {
  const issues = interchangeShimIssues(shim);
  if (issues.length) {
    throw new Error(`INTERCHANGE_SHIM_INVALID: ${issues.join(" ")}`);
  }
}

export function withInterchangeBoundary(
  fidelityMap: LensFidelityMap,
  shim: Pick<
    ProviderInterchangeShim<unknown, unknown>,
    "id" | "providerId" | "providerNativeFormat" | "fidelityBoundary"
  >,
): LensFidelityMap {
  return {
    ...fidelityMap,
    entries: [
      ...fidelityMap.entries,
      ...shim.fidelityBoundary.map((entry) => ({
        regionId: `interchange:${shim.providerId}:${shim.id}:${entry.feature}`,
        feature: entry.feature,
        class: entry.class,
        reason: entry.reason,
        ...(entry.readOnly !== undefined
          ? { readOnly: entry.readOnly }
          : entry.class === "PRESERVED"
            ? { readOnly: true }
            : {}),
      })),
    ],
  };
}

export type InterchangeOpenResult<P> = LensOpenResult<P> & {
  interchange: {
    shimId: string;
    providerId: string;
    providerNativeFormat: string;
    interchangeFormat: string;
    providerRevision: string;
  };
};

export async function openThroughInterchange<
  P,
  D,
  ProviderNative,
  ProviderWrite,
>(
  shim: ProviderInterchangeShim<ProviderNative, ProviderWrite>,
  input: ProviderNative,
): Promise<InterchangeOpenResult<P>> {
  assertInterchangeShim(
    shim as unknown as ProviderInterchangeShim<unknown, unknown>,
  );
  const exported = await shim.toInterchange(input);
  if (!exported.providerRevision.trim()) {
    throw new Error(
      `INTERCHANGE_PROVIDER_REVISION_MISSING: ${shim.id} returned bytes without the provider revision that produced them.`,
    );
  }
  const lens = registeredLens<P, D>(shim.interchangeFormat);
  const opened = await lens.open(exported.payload, "strict-native");
  const fidelityMap = withInterchangeBoundary(opened.fidelityMap, shim);
  return {
    ...opened,
    fidelityMap,
    capabilities: lens.capabilities("strict-native", fidelityMap),
    interchange: {
      shimId: shim.id,
      providerId: shim.providerId,
      providerNativeFormat: shim.providerNativeFormat,
      interchangeFormat: shim.interchangeFormat,
      providerRevision: exported.providerRevision,
    },
  };
}

export async function materializeThroughInterchange<
  P,
  D,
  ProviderNative,
  ProviderWrite,
>(input: {
  shim: ProviderInterchangeShim<ProviderNative, ProviderWrite>;
  projection: P;
  carry: LensPreservedCarry<P>;
  providerRevision: string;
}): Promise<ProviderWrite> {
  assertInterchangeShim(
    input.shim as unknown as ProviderInterchangeShim<unknown, unknown>,
  );
  if (!input.shim.fromInterchange) {
    throw new Error(
      `INTERCHANGE_WRITE_UNAVAILABLE: ${input.shim.providerId} is declared read-only for this format.`,
    );
  }
  if (!input.providerRevision.trim()) {
    throw new Error(
      `INTERCHANGE_PROVIDER_REVISION_MISSING: ${input.shim.id} cannot write without the provider revision it is replacing.`,
    );
  }
  const lens = registeredLens<P, D>(input.shim.interchangeFormat);
  const payload = await lens.materialize({
    projection: input.projection,
    carry: input.carry,
  });
  return input.shim.fromInterchange(payload, {
    providerRevision: input.providerRevision,
  });
}
