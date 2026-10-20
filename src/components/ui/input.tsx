import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Spectra's one text input.
 *
 * Fields rest as quiet paper, without a border, and take an ink edge when
 * focused: the edge and the caret are the focus indicator (3:1 against the
 * paper, WCAG 1.4.11). No ring is stacked on top of it; the global
 * stylesheet exempts text entry from the generic focus outline for the same
 * reason.
 */
const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-10 w-full rounded-control border border-transparent bg-[var(--bg-secondary)] px-3 py-2 text-body text-[var(--text-primary)] transition-colors duration-[var(--motion-fast)] placeholder:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] focus-visible:border-[color-mix(in_oklab,var(--text-primary)_55%,transparent)] focus-visible:bg-[var(--bg-elevated)] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-[color-mix(in_oklab,var(--danger)_45%,var(--border-default))]",
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
