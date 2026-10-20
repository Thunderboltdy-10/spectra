"use client";

import { useRef, useState } from "react";
import { Plus } from "@/components/icons/glyph-icons";

/**
 * Writing cards one after another, the way Anki's Add window works: a front,
 * Enter, a back, Enter, and the card is in the deck with the cursor back on
 * the next front. The card being edited above stays where it is, so a deck
 * of forty is forty pairs of lines, not forty trips through the rail.
 */
export function QuickCardEntry({
  onAdd,
}: {
  onAdd: (front: string, back: string) => void;
}) {
  const [front, setFront] = useState("");
  const [back, setBack] = useState("");
  const [added, setAdded] = useState(0);
  const frontRef = useRef<HTMLInputElement>(null);
  const backRef = useRef<HTMLInputElement>(null);

  const add = () => {
    if (!front.trim() && !back.trim()) return;
    onAdd(front.trim(), back.trim());
    setFront("");
    setBack("");
    setAdded((count) => count + 1);
    frontRef.current?.focus();
  };

  return (
    <form
      className="quick-card-entry"
      aria-label="Add cards quickly"
      onSubmit={(event) => {
        event.preventDefault();
        add();
      }}
    >
      <Plus className="size-4 shrink-0 text-[var(--text-tertiary)]" aria-hidden />
      <input
        ref={frontRef}
        value={front}
        onChange={(event) => setFront(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter" || event.shiftKey) return;
          event.preventDefault();
          if (front.trim()) backRef.current?.focus();
        }}
        placeholder="New card: front"
        aria-label="Front of the new card"
      />
      <input
        ref={backRef}
        value={back}
        onChange={(event) => setBack(event.target.value)}
        placeholder="Back, then Enter"
        aria-label="Back of the new card"
      />
      <button type="submit" disabled={!front.trim() && !back.trim()}>
        Add
      </button>
      {added ? (
        <span className="quick-card-entry-count" aria-live="polite">
          {added} added
        </span>
      ) : null}
    </form>
  );
}
