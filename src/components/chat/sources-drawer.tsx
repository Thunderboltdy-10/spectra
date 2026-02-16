"use client";

import { useEffect, useState } from "react";
import { ChevronDown, FileText, Globe, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Citation } from "@/types";
import { useCompactSheet } from "@/hooks/use-compact-sheet";
import { RichText } from "@/components/chat/rich-text";
import { useRightPanelDock } from "@/hooks/use-right-panel-dock";

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
  const compact = useCompactSheet(860);
  const docked = useRightPanelDock({ id: "sources-drawer", open, compact, maxWidthPx: 576 });
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCollapsed(compact);
  }, [open, compact]);

  useEffect(() => {
    if (!compact) {
      setCollapsed(false);
    }
  }, [compact]);

  if (!open) return null;

  return (
    <div className={`fixed z-50 ${docked ? "inset-y-0 right-0 pointer-events-none" : "inset-0"}`} style={docked ? { width: "var(--right-panel-space, 576px)" } : undefined}>
      {!docked ? (
        <button
          type="button"
          className="absolute inset-0 bg-transparent"
          onClick={onClose}
          aria-label="Close sources drawer"
        />
      ) : null}
      <aside
        className={`right-panel-shell pointer-events-auto absolute border-[var(--border-default)] bg-[var(--bg-sidebar)] p-4 shadow-[var(--shadow-soft)] ${
          docked ? "right-panel-shell--docked" : "right-panel-shell--sheet"
        } ${
          compact
            ? "bottom-3 left-3 right-3 max-h-[78vh] rounded-2xl border"
            : "inset-y-0 right-0 w-[92vw] max-w-xl border-l"
        }`}
      >
        <div className="mb-4 flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.12em] text-[var(--text-secondary)]">Sources</p>
            <h3 className="font-display text-2xl text-[var(--text-primary)]">Citation Details</h3>
          </div>
          <div className="flex items-center gap-1.5">
            {compact ? (
              <Button
                type="button"
                variant="secondary"
                size="icon"
                onClick={() => setCollapsed((prev) => !prev)}
                aria-label={collapsed ? "Expand sources" : "Collapse sources"}
              >
                <ChevronDown className={`h-4 w-4 transition ${collapsed ? "-rotate-90" : "rotate-0"}`} />
              </Button>
            ) : null}
            <Button type="button" variant="ghost" size="icon" onClick={onClose} aria-label="Close sources drawer">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {!collapsed ? (
          <div className={`right-panel-content ${compact ? "max-h-[calc(78vh-4rem)]" : "max-h-[calc(100vh-6rem)]"} space-y-3 overflow-y-auto pr-1`}>
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
                    <RichText content={citation.snippet} className="mt-2 text-xs leading-relaxed text-[var(--text-secondary)]" />
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
        ) : null}
      </aside>
    </div>
  );
}
