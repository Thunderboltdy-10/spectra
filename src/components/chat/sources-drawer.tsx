"use client";

import { FileText, Globe, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Citation } from "@/types";

type SourcesDrawerProps = {
  open: boolean;
  onClose: () => void;
  citations: Citation[];
};

function hrefForCitation(citation: Citation) {
  if (citation.url) return citation.url;
  if (citation.resourceId) return `/api/resources/${citation.resourceId}/download`;
  return undefined;
}

export function SourcesDrawer({ open, onClose, citations }: SourcesDrawerProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50">
      <button
        type="button"
        className="absolute inset-0 bg-black/35"
        onClick={onClose}
        aria-label="Close sources drawer"
      />
      <aside className="absolute inset-y-0 right-0 w-[92vw] max-w-xl overflow-y-auto border-l border-[var(--border-default)] bg-[var(--bg-primary)] p-4 shadow-[var(--shadow-soft)]">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.12em] text-[var(--text-secondary)]">Sources</p>
            <h3 className="font-display text-2xl text-[var(--text-primary)]">Citation Details</h3>
          </div>
          <Button type="button" variant="ghost" size="icon" onClick={onClose} aria-label="Close sources drawer">
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="space-y-3">
          {citations.length === 0 ? (
            <p className="text-sm text-[var(--text-secondary)]">No sources available for this response.</p>
          ) : (
            citations.map((citation, index) => {
              const href = hrefForCitation(citation);
              const isSearch = citation.sourceType === "search";

              return (
                <article
                  key={`${citation.filename}-${index}`}
                  className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-3"
                >
                  <div className="mb-2 flex items-center gap-2 text-xs text-[var(--text-secondary)]">
                    {isSearch ? <Globe className="h-3.5 w-3.5" /> : <FileText className="h-3.5 w-3.5" />}
                    <span className="uppercase tracking-[0.08em]">[{index + 1}] {citation.sourceType}</span>
                  </div>

                  <p className="font-medium text-[var(--text-primary)]">{citation.filename}</p>
                  {citation.page ? (
                    <p className="mt-1 text-xs text-[var(--text-secondary)]">Page {citation.page}</p>
                  ) : null}

                  {citation.snippet ? (
                    <p className="mt-2 text-xs leading-relaxed text-[var(--text-secondary)]">{citation.snippet}</p>
                  ) : (
                    <p className="mt-2 text-xs leading-relaxed text-[var(--text-secondary)]">
                      No preview snippet available for this source.
                    </p>
                  )}

                  {href ? (
                    <a
                      href={href}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-3 inline-flex cursor-pointer rounded-full border border-[var(--border-default)] px-2.5 py-1 text-xs text-[var(--text-secondary)] transition hover:bg-[var(--bg-hover)]"
                    >
                      {citation.url ? "Open source URL" : "Download source"}
                    </a>
                  ) : null}
                </article>
              );
            })
          )}
        </div>
      </aside>
    </div>
  );
}
