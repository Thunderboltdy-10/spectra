"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import type { SpectraThread } from "../data/api";
import { ThreadsBrowser, type ThreadsBrowserHandle } from "../threads/threads-view";
import { ThreadPreview } from "./thread-preview";

/** Resting on a row this long shows it; once a sheet is out, it follows at once. */
const PREVIEW_DELAY = 220;

/*
 * The island's thread switcher (ISLAND.md, "Threads"): every thread, one
 * press from anywhere. It rises from the dock's Threads button with the
 * moving threads first, searches by meaning as well as words, and opening a
 * thread takes the student to it. A new thread is the first thing in it, so
 * starting and continuing sit side by side. Resting on a thread shows its
 * last exchange on a sheet beside the list.
 */

export function ThreadSwitcher({
  initialQuery,
  onChoose,
  onNewThread,
  onClose,
}: {
  initialQuery?: string;
  onChoose: (thread: SpectraThread) => void;
  onNewThread: () => void;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const browserRef = useRef<ThreadsBrowserHandle>(null);
  const [preview, setPreview] = useState<SpectraThread | null>(null);
  const previewTimer = useRef(0);
  const point = (thread: SpectraThread) => {
    window.clearTimeout(previewTimer.current);
    if (preview) setPreview(thread);
    else previewTimer.current = window.setTimeout(() => setPreview(thread), PREVIEW_DELAY);
  };
  useEffect(() => () => window.clearTimeout(previewTimer.current), []);

  useEffect(() => {
    browserRef.current?.focusSearch();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      onClose();
    };
    const onDown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (panelRef.current?.contains(target as Node) || target?.closest?.("[data-island-threads]")) return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown, true);
    };
  }, [onClose]);

  return (
    <div ref={panelRef} role="dialog" aria-label="Threads" className="pointer-events-auto relative" onPointerLeave={() => window.clearTimeout(previewTimer.current)}>
      <div className="island-switcher flex h-[min(560px,62vh)] w-[min(440px,calc(100vw-32px))] flex-col overflow-hidden rounded-[var(--radius-xl)] border border-[var(--card-border)] bg-[var(--card-paper)] shadow-[var(--shadow-lg)]">
        <div className="flex shrink-0 items-center gap-2 px-4 pb-2 pt-3.5">
          <h2 className="min-w-0 flex-1 font-display text-heading font-medium leading-none text-[var(--text-primary)]">Threads</h2>
          <button
            type="button"
            onClick={onNewThread}
            className="inline-flex h-8 items-center gap-1.5 rounded-full bg-[var(--text-primary)] pl-2.5 pr-3 text-caption font-medium [color:var(--bg-primary)] outline-none transition-transform duration-[var(--motion-fast)] hover:-translate-y-px focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)] focus-visible:ring-offset-2"
          >
            <Icon name="add" size={14} />
            New thread
          </button>
        </div>
        <ThreadsBrowser ref={browserRef} initialQuery={initialQuery} onChoose={(thread) => onChoose(thread)} onPoint={point} className="min-h-0 flex-1" listClassName="pb-3" />
      </div>
      {preview ? (
        <div className="island-preview absolute bottom-0 left-[calc(100%+12px)] h-[min(440px,52vh)] w-[min(420px,30vw)] overflow-hidden rounded-[var(--radius-xl)] border border-[var(--card-border)] bg-[var(--card-paper)] shadow-[var(--shadow-lg)] max-[1279px]:hidden">
          <ThreadPreview thread={preview} />
        </div>
      ) : null}
    </div>
  );
}
