"use client";

import { useState } from "react";
import { X } from "@/components/icons/glyph-icons";

/**
 * Words added one at a time, for tags and standards on any sheet: Enter or a
 * comma files the word, its X takes it away. `max` stops adding at a limit.
 */
export function ChipInput({
  label,
  values,
  onChange,
  disabled,
  max,
  attrs,
}: {
  /** The singular noun: "tag", "standard". */
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
  disabled?: boolean;
  max?: number;
  attrs?: Record<string, unknown>;
}) {
  const [draft, setDraft] = useState("");
  const full = max !== undefined && values.length >= max;
  const add = () => {
    const value = draft.trim().replace(/^#+/, "").replace(/,$/, "");
    setDraft("");
    if (!value || full || values.some((candidate) => candidate.toLowerCase() === value.toLowerCase())) return;
    onChange([...values, value]);
  };
  return (
    <div className="sheet-chips" {...attrs}>
      {values.map((value) => (
        <span key={value} className="sheet-chip-word">
          {value}
          {disabled ? null : (
            <button type="button" aria-label={`Remove ${value} ${label}`} onClick={() => onChange(values.filter((item) => item !== value))}>
              <X className="size-3" />
            </button>
          )}
        </span>
      ))}
      {disabled || full ? null : (
        <input
          value={draft}
          placeholder={values.length ? "Add" : `Add a ${label}`}
          aria-label={`Add ${label}`}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={add}
          onKeyDown={(event) => {
            if (event.key !== "Enter" && event.key !== ",") return;
            event.preventDefault();
            add();
          }}
        />
      )}
      {disabled && !values.length ? <span className="sheet-hint">None</span> : null}
    </div>
  );
}
