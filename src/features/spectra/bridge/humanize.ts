/**
 * One public-language map for sync, Bridge, native, and dock failures (CANON R13).
 * Machine tokens, enum values, and stack fragments never reach a person.
 */

const CODE_MESSAGES: Array<{ test: RegExp; message: (app: string) => string }> = [
  {
    test: /AUTHORITY_PROHIBITED/i,
    message: () =>
      "That action is not something Spectra can do on your behalf.",
  },
  {
    test: /NATIVE_PROMOTION_CONFLICT/i,
    message: () => "Both copies changed. Nothing overwritten.",
  },
  {
    test: /NATIVE_PROMOTION_PROTECTED/i,
    message: () => "Spectra can read this original but will not change it.",
  },
  {
    test: /NATIVE_PROMOTION_CLOUD_ONLY/i,
    message: () =>
      "This file lives on your PC. Open Spectra Bridge on that computer to apply the change to the original.",
  },
  {
    test: /NATIVE_PROMOTION_UNCHANGED|NATIVE_PROMOTION_REFUSED|NATIVE_PROMOTION_FAILED/i,
    message: (app) =>
      `The ${app} file did not receive that change, so Spectra did not keep it in the live document.`,
  },
  {
    test: /NATIVE_MATERIALIZE_SKIPPED|NATIVE_VERIFY_FAILED/i,
    message: (app) =>
      `Spectra saved the edit. The ${app} file on this computer was not updated.`,
  },
  {
    test: /LOCAL_REPLICA_UNAVAILABLE|LOCAL_REPLICA_MISSING/i,
    message: (app) =>
      `Spectra saved your edit. The ${app} file on this computer was not updated because this file is not open as a local copy. Open it from Library while Spectra Bridge is connected, or keep working here.`,
  },
  {
    test: /not-on-this-computer/i,
    message: () =>
      "This copy is not on the computer running Spectra Bridge right now.",
  },
  {
    test: /NATIVE_PAYLOAD_UNAVAILABLE/i,
    message: (app) =>
      `Spectra saved your edit. The original ${app} file could not be read, so the copy on disk was left unchanged.`,
  },
  {
    test: /PPTX_NOTES_PART_MISSING|no notes page/i,
    message: () =>
      "Speaker notes are saved in Spectra. This PowerPoint file has no notes page for that slide, so the notes were not written into the file.",
  },
  {
    test: /PRESERVATION|preserved part/i,
    message: (app) =>
      `Spectra kept a part of this ${app} file untouched because rewriting it would change something Spectra does not edit. Your Spectra copy still has your change.`,
  },
  {
    test: /AI_ARTIFACT_CONNECTION_CLOSED|AI_ARTIFACT_CONNECT_TIMEOUT/i,
    message: () =>
      "Spectra lost the live connection to this work before the change finished. Your draft is still here. Retry when you are ready.",
  },
  {
    test: /AI_ARTIFACT_REGION_QUEUED/i,
    message: () =>
      "Someone else is editing this region. Your change is waiting so nothing is overwritten.",
  },
  {
    test: /BadJsonBody|length limit exceeded|too many bytes/i,
    message: () =>
      "This file is too large to copy into Spectra in one step. It is still on this PC. Open a smaller region, or keep working from the original.",
  },
  {
    test: /too big: expected array|array must contain at most/i,
    message: () =>
      "This change covers more of the workbook than one save can write. Change a smaller region and try again.",
  },
  {
    test: /AI_ARTIFACT_SCHEMA_INVALID|invalid input|expected number/i,
    message: () =>
      "This draft contains an unfinished control that cannot synchronize yet. Your local work is preserved.",
  },
  {
    test: /COLLABORATION_SYNC_TIMEOUT|COLLABORATION_NOT_SYNCHRONIZED|COLLABORATION_NOT_AVAILABLE|ARTIFACT_LIVE_MODEL_UNAVAILABLE|ARTIFACT_LIVE_MODEL_UNINITIALIZED/i,
    message: () =>
      "This edit is still safely held on this device. Spectra will synchronize it when the live connection catches up.",
  },
  {
    test: /COLLABORATION_ACCESS_LOST|COLLABORATION_READ_ONLY/i,
    message: () =>
      "Your editing access changed before this edit could synchronize.",
  },
  {
    test: /BRIDGE_CREDENTIAL_INVALID|device-revoked/i,
    message: () =>
      "This computer is no longer connected to Spectra. Connect it again from Files and devices if you still want copies on this PC.",
  },
  {
    test: /AUTH_OPERATOR_MANAGE_REQUIRED|Re-enter this school with manage access/i,
    message: () =>
      "This operator session is read-only. End it and enter again with manage access to make changes.",
  },
  {
    test: /AUTH_SCHOOL_ADMIN_REQUIRED/i,
    message: () =>
      "School administrator access is required for this change.",
  },
  {
    test: /AUTH_NOT_SIGNED_IN|not authenticated/i,
    message: () =>
      "This device is offline, or Spectra could not confirm you are signed in. You can keep working here.",
  },
  {
    test: /could not find public function|discoverResourcesPage|presentationsForAccount|bridgeSync:/i,
    message: () =>
      "Spectra could not list files in this folder right now. The files on this PC are unchanged.",
  },
  {
    test: /provider-managed folder|conflict windows may be wider/i,
    message: () =>
      "This folder is also managed by another program. Conflicts may take longer to notice.",
  },
  {
    test: /failed to fetch|networkerror|load failed|econnrefused/i,
    message: () =>
      "Spectra Bridge is not running on this PC. Open it, then try again.",
  },
  {
    test: /port .+ unavailable|address already in use|os error 10048/i,
    message: () =>
      "Something else is using the Spectra Bridge connection on this PC. Close the other app, then try again.",
  },
  {
    test: /write-expired|write-failed/i,
    message: () => "The save did not finish. Try again.",
  },
  {
    test: /office-locked/i,
    message: (app) =>
      `${app} still has this file open. Close it there, then try again.`,
  },
  {
    test: /stale-revision|external-save-during-write|readback-revision-mismatch/i,
    message: () =>
      "The file changed before Spectra could verify the save. Nothing was overwritten.",
  },
  {
    test: /target-unavailable|mount-detached|mount-unavailable/i,
    message: () =>
      "The selected folder is not available on this computer right now.",
  },
  {
    test: /payload-unavailable|replica-payload-missing|replica-payload-unverified/i,
    message: () =>
      "Spectra could not read the stored file bytes, so this copy was not updated.",
  },
  {
    test: /strategy-transition-failed|strategy-transition-expired/i,
    message: () =>
      "The last storage change did not finish. The file on this computer was not removed.",
  },
  {
    test: /restoring-from-cloud/i,
    message: () => "Spectra is restoring this file from the copy in Spectra.",
  },
  {
    test: /protected-original/i,
    message: () =>
      "Spectra can read this original file but will not change it until you choose otherwise.",
  },
  {
    test: /CONFLICT_RESOLUTION_WRITE_REQUIRED/i,
    message: (app) =>
      `Spectra could not attach Keep Spectra to a ${app} file update. Nothing was overwritten. Try again.`,
  },
  {
    test: /MATERIALIZATION_BASE_STALE/i,
    message: (app) =>
      `The ${app} file changed again while Spectra was saving. Nothing was overwritten.`,
  },
];

const REPLICA_STATE_WORDS: Record<string, string> = {
  current: "Up to date",
  ahead: "Has newer edits",
  behind: "Waiting for the latest copy",
  diverged: "Does not match",
  pending: "Saving",
  error: "Could not update",
  unavailable: "Not available here",
};

function rawText(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error ?? "");
}

function stripInternalNoise(raw: string): string {
  return raw
    .replace(/\[Request ID:[^\]]*\]/gi, "")
    .replace(/Request ID:\s*[A-Za-z0-9_-]+/gi, "")
    .replace(/['`][a-zA-Z][a-zA-Z0-9]*:[a-zA-Z0-9_]+['`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Cloud listing failed; the folder itself is not broken. */
export function isCloudDiscoveryFailure(error: unknown): boolean {
  const raw = rawText(error);
  if (/AUTH_NOT_SIGNED_IN/i.test(raw)) return false;
  return /could not find public function|discoverResourcesPage|presentationsForAccount|bridgeSync:/i.test(
    raw,
  );
}

/** Words for a replica state. Never the enum itself. */
export function humanizeReplicaState(state: string): string {
  return REPLICA_STATE_WORDS[state] ?? "Needs attention";
}

/** Words for a stored unavailable reason. Never the raw token. */
export function humanizeUnavailableReason(reason: string | undefined): string {
  if (!reason?.trim()) return "The device or selected folder is not available.";
  return humanizePublicFailure(reason);
}

/**
 * Turns any thrown value, stored error code, or dock failure string into a
 * sentence a student can act on. Unknown SNAKE_CASE tokens never pass through.
 */
export function humanizePublicFailure(
  error: unknown,
  application = "Office",
): string {
  const raw = rawText(error).trim();
  const app = application.trim() || "Office";
  for (const entry of CODE_MESSAGES) {
    if (entry.test.test(raw)) return entry.message(app);
  }
  if (isCloudDiscoveryFailure(raw)) {
    return "Spectra could not list files in this folder right now. The files on this PC are unchanged.";
  }
  if (!raw || /^[A-Z][A-Z0-9_]{4,}$/.test(raw) || /[A-Z]{3,}_[A-Z0-9_]{3,}/.test(raw)) {
    return `Spectra could not finish this step. Keep working here, or open the file from Library with Spectra Bridge connected.`;
  }
  if (
    /typeerror|referenceerror|syntaxerror|work_yjs_|stack trace|\.tsx?:\d+|cannot read propert|json\.stringify|could not safely complete/i.test(
      raw,
    )
  ) {
    return `Spectra could not finish this step. Your work on this device is still here.`;
  }
  const stripped = stripInternalNoise(raw)
    .replace(/\b[A-Z][A-Z0-9_]{5,}\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (/convex|public function|request id/i.test(stripped)) {
    return "Spectra could not list files in this folder right now. The files on this PC are unchanged.";
  }
  return stripped || `Spectra could not finish this step. Your work on this device is still here.`;
}

export function humanizeNativeError(error: unknown, application = "Office"): string {
  const raw = rawText(error);
  if (
    /LOCAL_REPLICA|NATIVE_PAYLOAD|PPTX_NOTES_PART|PRESERVATION|preserved part/i.test(
      raw,
    ) ||
    !raw.trim() ||
    /^[A-Z][A-Z0-9_]{4,}$/.test(raw.trim())
  ) {
    return humanizePublicFailure(error, application);
  }
  if (/typeerror|referenceerror|cannot read propert|stack trace|\.tsx?:\d+/i.test(raw)) {
    return `Spectra saved your edit. The ${application.trim() || "Office"} file on this computer could not be updated.`;
  }
  const stripped = raw.replace(/\b[A-Z][A-Z0-9_]{5,}\b/g, "").replace(/\s+/g, " ").trim();
  return (
    stripped ||
    `Spectra saved your edit. The ${application.trim() || "Office"} file on this computer could not be updated.`
  );
}

export function isMachineToken(value: string | undefined): boolean {
  const raw = value?.trim() ?? "";
  return (
    !raw ||
    /^[A-Z][A-Z0-9_]{4,}$/.test(raw) ||
    /[A-Z]{3,}_[A-Z0-9_]{3,}/.test(raw)
  );
}
