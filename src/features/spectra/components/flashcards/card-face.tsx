"use client";

import { useRef, type ReactNode } from "react";
import { EyeOff } from "@/components/icons/glyph-icons";
import { targetAttrs } from "../../collaboration/target-attributes";
import { isStoredHtml, plainTextFromStored } from "../../rich-content";
import { aiRegionAttr } from "../ai-region-path";
import { clozeParts, clozePrompt } from "../artifact-content-model";
import { ArtifactRichTextEditor } from "../artifact-rich-text-editor";

/*
 * One side of a card (EDITORS.md, "Flashcards"). Both sides are the same
 * plain card with the words set in the middle, the way they are read when
 * studying; the back carries a hint underneath. A cloze front is plain text the owner marks, with what the learner
 * will actually see printed underneath.
 */

type Note = {
  value: string;
  onChange: (value: string) => void;
  aiActive?: boolean;
  path?: string;
};

export function CardFace({
  side,
  value,
  placeholder,
  onChange,
  onFocus,
  cloze = false,
  disabled = false,
  aiActive = false,
  path,
  note,
  picture,
  turn,
}: {
  side: "front" | "back";
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  onFocus?: () => void;
  cloze?: boolean;
  /** The viewer lacks `edit`. The face still reads; it does not accept typing. */
  disabled?: boolean;
  aiActive?: boolean;
  /** Canonical pointer for the face, e.g. `/cards/2/front`. */
  path?: string;
  /** The hint line on the back. */
  note?: Note;
  /** The card's image, when it is placed on this side. */
  picture?: ReactNode;
  /** Bumped by Swap sides, so both faces turn over together. */
  turn?: number;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // A cloze front is plain text; one written as rich text is read as its words.
  const clozeText = cloze && isStoredHtml(value) ? plainTextFromStored(value) : value;
  const deletions = cloze ? clozeParts(clozeText).length : 0;

  function markCloze() {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = clozeText.slice(start, end) || "answer";
    const nextIndex = Math.max(0, ...clozeParts(clozeText).map((part) => part.index)) + 1;
    onChange(`${clozeText.slice(0, start)}{{c${nextIndex}::${selected}}}${clozeText.slice(end)}`);
    requestAnimationFrame(() => {
      textarea.focus();
      const selectionStart = start + `{{c${nextIndex}::`.length;
      textarea.setSelectionRange(selectionStart, selectionStart + selected.length);
    });
  }

  return (
    <section className="index-card" data-card-face={side} data-turn={turn ? turn % 2 : undefined} aria-label={side === "front" ? "Front" : "Back"}>
      <header className="index-card-head">
        <span className="index-card-side">{side === "front" ? "Front" : "Back"}</span>
        {cloze ? (
          <>
            <span className="index-card-count">
              {deletions} {deletions === 1 ? "blank" : "blanks"}
            </span>
            {disabled ? null : (
              <button type="button" className="sheet-quiet index-card-cloze" onClick={markCloze} title="Select words, then hide them">
                <EyeOff className="size-3.5" /> Hide selection
              </button>
            )}
          </>
        ) : null}
      </header>
      <div
        className="index-card-body"
        data-ai-region={aiRegionAttr(aiActive)}
        onMouseDown={(event) => {
          // The whole card is the field: a press on its blank paper writes on it.
          if (disabled || (event.target as HTMLElement).closest("[contenteditable], textarea, button, img")) return;
          event.preventDefault();
          event.currentTarget.querySelector<HTMLElement>("[contenteditable='true'], textarea")?.focus();
        }}
      >
        {cloze ? (
          <textarea
            ref={textareaRef}
            className="index-card-cloze-text"
            value={clozeText}
            onChange={(event) => onChange(event.target.value)}
            onFocus={() => onFocus?.()}
            {...(path ? targetAttrs(path) : {})}
            readOnly={disabled}
            autoFocus={!disabled && !clozeText}
            placeholder={placeholder}
            aria-label="Front"
          />
        ) : (
          <ArtifactRichTextEditor
            value={value}
            onChange={onChange}
            onFocus={onFocus}
            path={path}
            placeholder={placeholder}
            label={side === "front" ? "Front" : "Back"}
            variant="bare"
            disabled={disabled}
            // A blank card opens ready to write its prompt.
            autoFocus={side === "front" && !disabled && !value}
          />
        )}
        {picture}
      </div>
      {cloze && deletions ? (
        <p className="index-card-preview">
          <span>Studied as</span> {clozePrompt(clozeText)}
        </p>
      ) : null}
      {note ? (
        <input
          className="index-card-note"
          value={note.value}
          onChange={(event) => note.onChange(event.target.value)}
          onFocus={() => onFocus?.()}
          data-ai-region={aiRegionAttr(note.aiActive ?? false)}
          {...(note.path ? targetAttrs(note.path) : {})}
          readOnly={disabled}
          placeholder={disabled ? "" : "Add a hint"}
          aria-label="Note or hint"
        />
      ) : null}
    </section>
  );
}
