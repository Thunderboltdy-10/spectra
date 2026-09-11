import {
  POLICY_PRESETS,
  type SyncPolicyPreset,
  type SyncPolicyValues,
} from "./sync-policy";

export const BRIDGE_TRUST_PRESET_IDS = [
  "managed-copy",
  "native-sync",
  "advanced",
] as const;

export type BridgeTrustPreset = (typeof BRIDGE_TRUST_PRESET_IDS)[number];

export type BridgeTrustOption = {
  id: BridgeTrustPreset;
  label: string;
  summary: string;
  localPreview: string;
  cloudPreview: string;
  requiresNativeWriteConfirmation: boolean;
};

export const BRIDGE_TRUST_OPTIONS: readonly BridgeTrustOption[] = [
  {
    id: "managed-copy",
    label: "Managed copy",
    summary:
      "The safer starting point. Spectra works from its managed copy and leaves the original file untouched.",
    localPreview:
      "The original stays on this PC. Spectra does not write back to it.",
    cloudPreview: "A full Spectra copy is available on signed-in devices.",
    requiresNativeWriteConfirmation: false,
  },
  {
    id: "native-sync",
    label: "Native write & sync",
    summary:
      "Opt in when Spectra should update an approved file on this PC and keep it in two-way sync.",
    localPreview:
      "Spectra may write approved linked files here. Conflicts stop for review.",
    cloudPreview:
      "The full cloud copy and the approved local file stay in sync.",
    requiresNativeWriteConfirmation: true,
  },
  {
    id: "advanced",
    label: "Advanced controls",
    summary:
      "Keep detailed direction, discovery, structure, timing, filters, and protected-original choices visible.",
    localPreview:
      "Uses the exact local permissions shown below, including any custom filters.",
    cloudPreview: "Uses the exact cloud content and timing shown below.",
    requiresNativeWriteConfirmation: false,
  },
] as const;

export type BridgeTrustPolicy = Pick<
  SyncPolicyValues,
  | "preset"
  | "contentDirection"
  | "discovery"
  | "structure"
  | "cloudContent"
  | "localMirrorGrantId"
  | "includeGlobs"
  | "excludeGlobs"
  | "timing"
  | "protectedOriginal"
>;

function sameArray(left: readonly string[], right: readonly string[]) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function samePolicy(left: BridgeTrustPolicy, right: SyncPolicyValues) {
  return (
    left.preset === right.preset &&
    left.contentDirection === right.contentDirection &&
    left.discovery === right.discovery &&
    left.structure === right.structure &&
    left.cloudContent === right.cloudContent &&
    left.localMirrorGrantId === right.localMirrorGrantId &&
    sameArray(left.includeGlobs, right.includeGlobs) &&
    sameArray(left.excludeGlobs, right.excludeGlobs) &&
    left.timing === right.timing &&
    left.protectedOriginal === right.protectedOriginal
  );
}

/**
 * Trust is deliberately derived from the effective policy. A custom policy,
 * including the protected-original `linked` policy, remains Advanced instead
 * of being silently rewritten into a nearby preset.
 */
export function bridgeTrustPresetForPolicy(
  policy: BridgeTrustPolicy | null | undefined,
): BridgeTrustPreset {
  if (!policy || samePolicy(policy, POLICY_PRESETS.spectra))
    return "managed-copy";
  if (samePolicy(policy, POLICY_PRESETS.both)) return "native-sync";
  return "advanced";
}

export function bridgePolicyForTrustPreset(
  preset: Exclude<BridgeTrustPreset, "advanced">,
): SyncPolicyValues {
  return { ...POLICY_PRESETS[preset === "managed-copy" ? "spectra" : "both"] };
}

export function syncPresetForBridgeTrust(
  preset: Exclude<BridgeTrustPreset, "advanced">,
): SyncPolicyPreset {
  return preset === "managed-copy" ? "spectra" : "both";
}

export function bridgeTrustOption(preset: BridgeTrustPreset) {
  return BRIDGE_TRUST_OPTIONS.find((option) => option.id === preset)!;
}
