"use client";

import { lazy, Suspense, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { EmptyState, ProblemState } from "@/components/ui/page-state";
import { fileKindNoun, isOfficeViewKind, type FileViewKind } from "./file-kind";
import { OfficeGhost } from "./office-ghost";

/*
 * One viewer for every file Spectra shows in place: school files, Library
 * resources, Bridge files and the originals behind imported works. Photos
 * and PDFs are drawn by the browser; Word, PowerPoint and Excel files are
 * read by Spectra's own Office lenses, read-only. Whatever cannot show here
 * says so in one line, and the way out (a new tab, or the caller's own next
 * step such as Copy into Library) is always in the footer.
 */

const OfficeView = lazy(() => import("./office-view"));

/** The file being shown. `url` is missing while its bytes are fetched; `bytes` is its size when known. */
export type ViewedFile = { key: string; filename: string; kind: FileViewKind; url?: string; bytes?: number };

export function FileViewer({ file, onClose, actions }: { file: ViewedFile | null; onClose: () => void; actions?: ReactNode }) {
  return (
    <Dialog open={file !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      {file ? <ViewerBody key={`${file.key}:${file.url ?? ""}`} file={file} actions={actions} /> : null}
    </Dialog>
  );
}

const DESCRIPTIONS: Record<FileViewKind, string> = {
  image: "A photo, shown in Spectra.",
  pdf: "A PDF, shown in Spectra.",
  document: "A Word document, shown read-only in Spectra.",
  slides: "A PowerPoint deck, shown read-only in Spectra. Use the arrow keys to move between slides.",
  sheet: "An Excel workbook, shown read-only in Spectra.",
  legacy: "An older Office file that Spectra can't show.",
};

function ViewerBody({ file, actions }: { file: ViewedFile; actions?: ReactNode }) {
  const [failed, setFailed] = useState(false);
  const office = isOfficeViewKind(file.kind) ? file.kind : null;
  return (
    <DialogContent
      className="flex h-[min(88vh,960px)] w-[min(1180px,calc(100vw-32px))] max-w-none flex-col gap-3 p-4"
      data-file-viewer={file.kind}
    >
      <div className="min-w-0 pr-10">
        <DialogTitle className="truncate text-ui">{file.filename}</DialogTitle>
        <DialogDescription className="sr-only">{DESCRIPTIONS[file.kind]}</DialogDescription>
      </div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-card border border-[var(--border-default)] bg-[var(--bg-secondary)]">
        {file.kind === "legacy" ? (
          // No reader for the pre-2007 binary formats: say so, with no viewer.
          <EmptyState
            compact
            icon="document"
            title={`${file.filename} is an ${fileKindNoun("legacy")}.`}
            detail="Spectra shows Word, PowerPoint and Excel files saved as .docx, .pptx or .xlsx. Open it in a new tab, or save it in the newer format and add it again."
          />
        ) : !file.url ? (
          <OfficeGhost kind={office ?? "file"} filename={file.filename} />
        ) : failed ? (
          <ProblemState compact title={`${file.filename} didn't show here.`} detail="Open it in a new tab instead." />
        ) : office ? (
          <Suspense fallback={<OfficeGhost kind={office} filename={file.filename} />}>
            <OfficeView kind={office} url={file.url} filename={file.filename} bytes={file.bytes} />
          </Suspense>
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
