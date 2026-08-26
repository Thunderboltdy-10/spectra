import type { SyncPolicyPreset } from "../../../../shared/sync-policy";

/**
 * User-facing storage choices (CANON R14, ARCHITECTURE-TRUTH §6).
 * The engine's four presets and timing modes stay underneath; they never
 * appear as jargon on a control.
 */
export type StorageChoice = "device" | "spectra" | "both";

export type StorageToggle = {
  choice: StorageChoice;
  label: string;
  recommended?: boolean;
  consequence: string;
};

export const STORAGE_TOGGLES: readonly StorageToggle[] = [
  {
    choice: "device",
    label: "Keep on this computer",
    consequence:
      "Lives on this PC. Other devices see it listed but need this PC on to open it.",
  },
  {
    choice: "spectra",
    label: "Keep in Spectra",
    consequence: "Stored in Spectra. Works everywhere; no file on this PC.",
  },
  {
    choice: "both",
    label: "Both",
    recommended: true,
    consequence:
      "Edits anywhere update both. The file on your PC stays a normal file.",
  },
];

export const PROTECTED_ORIGINAL_TOGGLE = {
  label: "Read, don't change",
  consequence: "Spectra can read these files but will never change them.",
} as const;

/** Item-level Spectra choice must not imply the physical file was deleted (P1.I1). */
export function spectraConsequence(hasLocalCopy: boolean): string {
  if (hasLocalCopy) {
    return "Stored in Spectra. Works everywhere. The file on this computer stays on disk; Spectra stops updating it.";
  }
  return "Stored in Spectra. Works everywhere; no file on this PC.";
}

export function consequenceFor(
  choice: StorageChoice,
  hasLocalCopy = false,
): string {
  if (choice === "spectra") return spectraConsequence(hasLocalCopy);
  const row = STORAGE_TOGGLES.find((toggle) => toggle.choice === choice);
  return row?.consequence ?? STORAGE_TOGGLES[2]!.consequence;
}

export function storageChoiceFromPreset(
  preset: SyncPolicyPreset | undefined,
): StorageChoice {
  if (preset === "device" || preset === "linked") return "device";
  if (preset === "both") return "both";
  return "spectra";
}

export function policyPresetFromToggles(
  choice: StorageChoice,
  protectedOriginal: boolean,
): SyncPolicyPreset {
  if (protectedOriginal && choice !== "spectra") return "linked";
  return choice;
}

export function isProtectedOriginalPreset(
  preset: SyncPolicyPreset | undefined,
): boolean {
  return preset === "linked";
}

/**
 * Folder progress is unknown when the Bridge is not live. Zero is never a
 * substitute for "not measured" (WC-3).
 */
export type MountCountTruth =
  | { kind: "hidden" }
  | { kind: "progress"; synced: number; total: number }
  | { kind: "unavailable"; sentence: string };

export function mountCountTruth(input: {
  live: boolean;
  state: string;
  synced: number;
  total: number;
}): MountCountTruth {
  const unavailable =
    !input.live ||
    input.state === "disconnected" ||
    input.state === "unavailable" ||
    input.state === "error" ||
    input.state === "waiting";
  if (unavailable) {
    return {
      kind: "unavailable",
      sentence:
        "This folder is not available until Spectra Bridge is running.",
    };
  }
  if (input.total <= 0) return { kind: "hidden" };
  return { kind: "progress", synced: input.synced, total: input.total };
}

export function formatMountProgress(synced: number, total: number): string {
  return `${synced.toLocaleString()} of ${total.toLocaleString()} files`;
}
