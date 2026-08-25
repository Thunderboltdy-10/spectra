import * as React from "react";
import { cn } from "@/lib/utils";

const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.ComponentProps<"textarea">
>(({ className, ...props }, ref) => {
  return (
    <textarea
      className={cn(
        "min-h-[90px] w-full rounded-control border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2 text-body text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus-visible:border-[color-mix(in_oklab,var(--brand-primary)_45%,var(--border-default))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)] disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-[color-mix(in_oklab,var(--danger)_45%,var(--border-default))]",
        className,
      )}
      ref={ref}
      {...props}
    />
  );
});
Textarea.displayName = "Textarea";

export { Textarea };
