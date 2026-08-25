"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Spectra's one labelled input row (ARCHITECTURE-PLATFORM §3).
 *
 * The label is always a real `<label htmlFor>` — never a placeholder standing
 * in for a name. Descriptions sit above the control, errors below it, and the
 * error replaces the description in `aria-describedby` so a screen reader
 * hears the thing that went wrong, not stale help text.
 *
 * The field owns focus visibility for its control by contract: the global
 * `input:focus-visible` suppression that made 221 of 222 inputs keyboard-
 * invisible (DS-4) is deleted, and `Input` itself carries the restored ring,
 * so a bare `<Input>` is honest even outside a Field. Field exists so label,
 * help and error wiring never has to be re-rolled per surface.
 */
export const Field = React.forwardRef<
  HTMLDivElement,
  {
    label: React.ReactNode;
    description?: string;
    error?: string;
    required?: boolean;
    className?: string;
    children: React.ReactElement<{
      id?: string;
      "aria-invalid"?: boolean | "true" | "false";
      "aria-describedby"?: string;
    }>;
  }
>(({ label, description, error, required, className, children }, ref) => {
  const id = React.useId();
  const descriptionId = `${id}-description`;
  const errorId = `${id}-error`;
  const describedBy = error ? errorId : description ? descriptionId : undefined;

  const control = React.cloneElement(children, {
    id: children.props.id ?? id,
    "aria-invalid": error ? true : children.props["aria-invalid"],
    "aria-describedby": cn(children.props["aria-describedby"], describedBy),
  });

  return (
    <div ref={ref} className={cn("flex flex-col gap-1.5", className)}>
      <label
        htmlFor={children.props.id ?? id}
        className="text-caption font-semibold text-[var(--text-primary)]"
      >
        {label}
        {required ? (
          <span aria-hidden="true" className="ml-0.5 text-[var(--danger)]">
            *
          </span>
        ) : null}
      </label>
      {description && !error ? (
        <p
          id={descriptionId}
          className="text-micro text-[var(--text-secondary)]"
        >
          {description}
        </p>
      ) : null}
      {control}
      {error ? (
        <p
          id={errorId}
          role="alert"
          className="text-micro text-[var(--danger)]"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
});
Field.displayName = "Field";
