/**
 * Native lens/materialize failures must never reach a person as a machine code.
 * The Spectra copy is the source of truth the person just edited; the Office
 * file is a projection of it. Say that, then say what to do.
 */

const CODE_MESSAGES: Array<{ test: RegExp; message: (app: string) => string }> = [
  {
    test: /LOCAL_REPLICA_UNAVAILABLE|LOCAL_REPLICA_MISSING/i,
    message: (app) =>
      `Spectra saved your edit. The ${app} file on this computer was not updated because this file is not open as a local copy. Open it from Library while the Spectra bridge is connected, or keep working here.`,
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
];

export function humanizeNativeError(error: unknown, application = "Office"): string {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  const app = application.trim() || "Office";
  for (const entry of CODE_MESSAGES) {
    if (entry.test.test(raw)) return entry.message(app);
  }
  if (!raw.trim() || /^[A-Z][A-Z0-9_]{4,}$/.test(raw.trim())) {
    return `Spectra saved your edit. The ${app} file on this computer could not be updated. Keep working here, or open the file from Library with the Spectra bridge connected.`;
  }
  if (/typeerror|referenceerror|cannot read propert|stack trace|\.tsx?:\d+/i.test(raw)) {
    return `Spectra saved your edit. The ${app} file on this computer could not be updated.`;
  }
  return raw.replace(/\b[A-Z][A-Z0-9_]{5,}\b/g, "").replace(/\s+/g, " ").trim() ||
    `Spectra saved your edit. The ${app} file on this computer could not be updated.`;
}

export function isNativeCodeError(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  return CODE_MESSAGES.some((entry) => entry.test.test(raw)) ||
    /^[A-Z][A-Z0-9_]{4,}$/.test(raw.trim());
}
