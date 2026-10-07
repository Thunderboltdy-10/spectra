"use client";

import { fileViewKind } from "./file-kind";
import type { ViewedFile } from "./file-viewer";

/** What an import history row knows about the file it was made from. */
export type ImportedOriginal = { jobId: string; format: string; name?: string; bytes?: number };

/**
 * An imported file's original: read it in place where Spectra has a reader
 * for its format, or download it.
 */
export function ImportOriginal({
  entry,
  downloadUrl,
  onView,
  className,
}: {
  entry: ImportedOriginal;
  downloadUrl: string;
  onView: (file: ViewedFile) => void;
  className?: string;
}) {
  const kind = fileViewKind(undefined, `original.${entry.format}`);
  const name = entry.name || `Original.${entry.format}`;
  return (
    <span className={className}>
      {kind && kind !== "legacy" ? (
        <button
          type="button"
          aria-label={`View the original ${name}`}
          onClick={() => onView({ key: entry.jobId, filename: name, kind, url: downloadUrl, bytes: entry.bytes })}
        >
          View
        </button>
      ) : null}
      <a href={downloadUrl} download>
        Original
      </a>
    </span>
  );
}
