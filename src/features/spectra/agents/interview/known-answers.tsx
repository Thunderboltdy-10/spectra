"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown } from "@/components/icons/glyph-icons";

/*
 * Everything already answered folds under one line, so the page stays on the
 * question being asked; opening it shows each answer, ready to change.
 */
export function KnownAnswers({ count, children }: { count: number; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  if (!count) return null;
  return (
    <section className="interview-known" data-open={open || undefined}>
      <button type="button" className="interview-known-toggle" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        What it knows so far
        <span className="interview-known-count">{count}</span>
        <ChevronDown size={14} className="interview-known-chevron" />
      </button>
      {open ? <div className="interview-known-list">{children}</div> : null}
    </section>
  );
}
