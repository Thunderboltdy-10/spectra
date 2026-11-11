"use client";

import { useState, type ReactNode } from "react";
import { spectraBus } from "../events";

/*
 * A view-only interactive preview (an embedded graph, a simulation): its
 * controls show but cannot be used here. A press on them says so and offers
 * the work itself, where they do work.
 */
export function ViewOnlyCover({ workId, children }: { workId: string; children: ReactNode }) {
  const [told, setTold] = useState(false);
  return (
    <div className="relative" data-view-only>
      <div className="opacity-90 saturate-[.85]">{children}</div>
      <button
        type="button"
        aria-label="View only. Open this to change it"
        onClick={() => setTold(true)}
        onPointerLeave={() => setTold(false)}
        className="absolute inset-0 cursor-default rounded-card focus-visible:outline-none"
      />
      {told ? (
        <div
          role="status"
          className="island-content-in absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-control border border-[var(--card-border)] bg-[var(--card-paper)] py-1 pl-3 pr-1 text-caption text-[var(--text-primary)] shadow-[var(--shadow-soft)]"
        >
          Open this to change it
          <button
            type="button"
            onClick={() => void spectraBus.command("work.open", { workId, surface: "panel" })}
            className="h-7 rounded-control px-2 font-medium text-[var(--text-secondary)] transition-colors duration-150 hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]"
          >
            Open
          </button>
        </div>
      ) : null}
    </div>
  );
}
