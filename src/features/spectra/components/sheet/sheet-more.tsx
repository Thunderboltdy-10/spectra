"use client";

import type { ReactNode } from "react";
import { ChevronDown } from "@/components/icons/glyph-icons";

/*
 * "More options" at the foot of every editor sheet (EDITORS.md, "The sheet").
 * Folded, its line says what is set away from the defaults, so nothing hides
 * behind it unannounced; open, it unfolds the settings most people never need.
 */
export function SheetMore({
  open,
  onOpenChange,
  summary,
  children,
  toggleAttrs,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  summary?: string;
  children: ReactNode;
  /** Collaboration target attributes for the toggle, when Spectra changed something folded inside. */
  toggleAttrs?: Record<string, unknown>;
}) {
  return (
    <section className="sheet-more" aria-label="More options">
      <button type="button" className="sheet-more-toggle" aria-expanded={open} onClick={() => onOpenChange(!open)} {...toggleAttrs}>
        <ChevronDown className="sheet-more-chevron size-3.5" />
        <span>More options</span>
        {summary && !open ? <span className="sheet-more-summary">{summary}</span> : null}
      </button>
      {open ? children : null}
    </section>
  );
}
