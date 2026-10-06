"use client";

import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { ProblemState } from "@/components/ui/page-state";
import { Skeleton } from "@/components/ui/skeleton";

/** What Spectra can show a school file as, in place. Anything else opens in a new tab or is copied into the Library. */
export type SchoolFileKind = "image" | "pdf";

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp"]);

export function schoolFileKind(mimeType: string | undefined, filename: string): SchoolFileKind | null {
  const type = (mimeType ?? "").toLowerCase();
  const extension = filename.includes(".") ? filename.split(".").pop()!.toLowerCase() : "";
  if (type === "application/pdf" || extension === "pdf") return "pdf";
  // SVG can carry script; it stays out of the in-place viewer.
  if ((type.startsWith("image/") && type !== "image/svg+xml") || IMAGE_EXTENSIONS.has(extension)) return "image";
  return null;
}

/** The file being shown. `url` is missing while the kept copy is fetched. */
export type ViewedSchoolFile = { key: string; filename: string; kind: SchoolFileKind; url?: string };

/** A school file, open inside Spectra: photos as photos, PDFs in the reader, with the way out to a new tab. */
export function SchoolFileViewer({ file, onClose, actions }: { file: ViewedSchoolFile | null; onClose: () => void; actions?: ReactNode }) {
  return (
    <Dialog open={file !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      {file ? <ViewerBody key={`${file.key}:${file.url ?? ""}`} file={file} actions={actions} /> : null}
    </Dialog>
  );
}

function ViewerBody({ file, actions }: { file: ViewedSchoolFile; actions?: ReactNode }) {
  const [failed, setFailed] = useState(false);
  return (
    <DialogContent className="flex h-[min(86vh,920px)] w-[min(980px,calc(100vw-32px))] max-w-none flex-col gap-3 p-4">
      <div className="min-w-0 pr-10">
        <DialogTitle className="truncate text-ui">{file.filename}</DialogTitle>
        <DialogDescription className="sr-only">{file.kind === "pdf" ? "A PDF, shown in Spectra." : "A photo, shown in Spectra."}</DialogDescription>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-card border border-[var(--border-default)] bg-[var(--bg-secondary)]">
        {!file.url ? (
          <div role="status" aria-label={`Opening ${file.filename}`} className="h-full w-full p-4">
            <Skeleton className="h-full w-full" />
          </div>
        ) : failed ? (
          <ProblemState compact title={`${file.filename} didn't show here.`} detail="Open it in a new tab instead." />
        ) : file.kind === "image" ? (
          // A kept copy at a storage address: the image optimizer has nothing to add.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={file.url} alt={file.filename} className="max-h-full max-w-full object-contain" onError={() => setFailed(true)} />
        ) : (
          <iframe title={file.filename} src={file.url} className="h-full w-full border-0 bg-[var(--bg-primary)]" />
        )}
      </div>
      <DialogFooter className="flex-wrap">
        {actions}
        {file.url ? (
          <Button asChild variant="secondary">
            <a href={file.url} target="_blank" rel="noopener noreferrer">
              Open in a new tab
            </a>
          </Button>
        ) : null}
      </DialogFooter>
    </DialogContent>
  );
}
