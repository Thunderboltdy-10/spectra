import * as React from "react";
import { cn } from "@/lib/utils";

const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.ComponentProps<"textarea">
>(({ className, ...props }, ref) => {
  return (
    <textarea
      className={cn(
        "min-h-[90px] w-full rounded-control border border-transparent bg-[var(--bg-secondary)] px-3 py-2 text-body text-[var(--text-primary)] transition-colors duration-[var(--motion-fast)] placeholder:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] focus-visible:border-[color-mix(in_oklab,var(--text-primary)_55%,transparent)] focus-visible:bg-[var(--bg-elevated)] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-[color-mix(in_oklab,var(--danger)_45%,var(--border-default))]",
        className,
      )}
      ref={ref}
      {...props}
    />
  );
});
Textarea.displayName = "Textarea";

export { Textarea };
