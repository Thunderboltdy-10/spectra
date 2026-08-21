export type LensCompatibilityProfile =
  | "strict-native"
  | "enhanced"
  | "spectra-native";

export type LensFidelityClass =
  | "NATIVE"
  | "EQUIVALENT"
  | "PRESERVED"
  | "EXTENSION";

export type LensFidelityEntry = {
  regionId: string;
  feature: string;
  class: LensFidelityClass;
  partName?: string;
  readOnly?: boolean;
  reason?: string;
};

export type LensFidelityMap = {
  version: 1;
  profile: LensCompatibilityProfile;
  entries: LensFidelityEntry[];
};

export type LensPreservedCarry<P = unknown> = {
  version: 1;
  format: string;
  profile: LensCompatibilityProfile;
  basePayloadHash: string;
  payload: Uint8Array;
  projection: P;
};

export type LensCapability = {
  id: string;
  available: boolean;
  reason?: string;
};

export type LensCapabilitySet = {
  profile: LensCompatibilityProfile;
  human: LensCapability[];
  aiOperations: string[];
};

export type LensOpenResult<P> = {
  projection: P;
  fidelityMap: LensFidelityMap;
  preservedCarry: LensPreservedCarry<P>;
  capabilities: LensCapabilitySet;
};

export type LensSemanticChange = {
  regionId: string;
  kind: "insert" | "update" | "delete" | "preserved-part-replaced";
  before?: unknown;
  after?: unknown;
  partName?: string;
};

export type LensExternalDiff = {
  changes: LensSemanticChange[];
  changedParts: string[];
  preservedPartChanges: string[];
};

export interface SpectraLens<P, D> {
  readonly format: string;
  open(
    payload: Uint8Array,
    profile?: LensCompatibilityProfile,
  ): Promise<LensOpenResult<P>>;
  mutate(carry: LensPreservedCarry<P>, delta: D): Promise<Uint8Array>;
  diffExternal(
    payloadA: Uint8Array,
    payloadB: Uint8Array,
  ): Promise<LensExternalDiff>;
  materialize(input: {
    projection: P;
    carry: LensPreservedCarry<P>;
  }): Promise<Uint8Array>;
  capabilities(
    profile: LensCompatibilityProfile,
    fidelityMap: LensFidelityMap,
  ): LensCapabilitySet;
}

