import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Spectra's one text input.
 *
 * The focus ring is the contract: a 2px `--focus-ring-color` ring plus a
 * hardened border. This file previously rendered `focus-visible:ring-0` with
 * only a border-colour change — and the global stylesheet suppressed even the
 * browser default for every bare input (DS-4), leaving most fields keyboard-
 * invisible. Both suppressions are gone; this ring must never be softened back
 * to a tint.
 */
const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-10 w-full rounded-control border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2 text-body text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus-visible:border-[color-mix(in_oklab,var(--brand-primary)_45%,var(--border-default))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)] disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-[color-mix(in_oklab,var(--danger)_45%,var(--border-default))]",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
