"use client";

import * as React from "react";
import { Icon } from "@/components/icons";
import { cn } from "@/lib/utils";

/*
 * Every search around the app, in the same treatment as the buttons beside it:
 * a glyph and words on the page, the bar's height and type, no box. Pointing
 * at it or typing in it brings up the same wash a button has, with a hairline
 * while it holds the cursor so the field is never lost.
 */

export type SearchFieldProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange" | "value" | "size"> & {
  value: string;
  onChange: (value: string) => void;
  /** The field's name, read aloud; the placeholder when none is given. */
  label: string;
  /** Shown at the end of the field: a clear button appears there by itself once something is typed. */
  trailing?: React.ReactNode;
  /** A press of Clear also empties the field; off where Escape is handled by the caller. */
  clearable?: boolean;
  className?: string;
};

export const SearchField = React.forwardRef<HTMLInputElement, SearchFieldProps>(function SearchField(
  { value, onChange, label, trailing, clearable = true, className, placeholder, ...input },
  ref,
) {
  return (
    <label
      className={cn(
        "flex h-9 min-w-0 items-center gap-2 rounded-control px-3 text-[var(--text-tertiary)]",
        "transition-[background-color,box-shadow] duration-[var(--motion-fast)] hover:bg-[var(--bg-hover)]",
        "focus-within:bg-[var(--bg-hover)] focus-within:shadow-[inset_0_0_0_1px_var(--border-default)]",
        className,
      )}
    >
      <Icon name="search" size={18} />
      <input
        ref={ref}
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder ?? label}
        aria-label={label}
        className="min-w-0 flex-1 bg-transparent text-ui text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)] [&::-webkit-search-cancel-button]:hidden"
        {...input}
      />
      {trailing}
      {clearable && value ? (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => onChange("")}
          className="-mr-1.5 grid size-6 shrink-0 place-items-center rounded-chip text-[var(--text-tertiary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
        >
          <Icon name="close" size={14} />
        </button>
      ) : null}
    </label>
  );
});
