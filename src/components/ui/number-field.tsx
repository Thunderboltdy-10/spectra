"use client";

import * as React from "react";
import { Minus, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Spectra's one number input: the figure, with a minus and a plus beside it
 * in place of the browser's own spinner, which is a tiny white box on every
 * platform and cannot be styled.
 *
 * `className` frames the whole field (a call site's own field look, such as
 * `.sheet-input`); the input inside stays bare. The steps move the input as
 * the browser's arrows would (`stepUp`, within `min`, `max` and `step`) and
 * report it through the input's own `onChange`, so callers handle a typed
 * figure and a stepped one the same way.
 */
export const NumberField = React.forwardRef<HTMLInputElement, Omit<React.ComponentProps<"input">, "type"> & { inputClassName?: string }>(
  function NumberField({ className, inputClassName, disabled, readOnly, "aria-label": label, ...props }, forwarded) {
    const inner = React.useRef<HTMLInputElement>(null);
    React.useImperativeHandle(forwarded, () => inner.current as HTMLInputElement);
    const step = (direction: 1 | -1) => {
      const input = inner.current;
      if (!input) return;
      const before = input.value;
      try {
        if (direction > 0) input.stepUp();
        else input.stepDown();
      } catch {
        return;
      }
      if (input.value !== before) input.dispatchEvent(new Event("input", { bubbles: true }));
    };
    const still = disabled || readOnly;
    const name = typeof label === "string" ? label : "the number";
    return (
      <span className={cn("number-field", className)} data-disabled={disabled || undefined}>
        <input ref={inner} type="number" inputMode="decimal" disabled={disabled} readOnly={readOnly} aria-label={label} className={cn("number-field-input", inputClassName)} {...props} />
        {still ? null : (
          <span className="number-field-steps">
            <button type="button" tabIndex={-1} aria-label={`Decrease ${name}`} onClick={() => step(-1)}>
              <Minus aria-hidden />
            </button>
            <button type="button" tabIndex={-1} aria-label={`Increase ${name}`} onClick={() => step(1)}>
              <Plus aria-hidden />
            </button>
          </span>
        )}
      </span>
    );
  },
);
