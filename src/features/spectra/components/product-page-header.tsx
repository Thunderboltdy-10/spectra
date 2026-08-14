import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Shared route heading: identity and actions only. Section navigation follows it. */
export function ProductPageHeader({
  eyebrow,
  title,
  description,
  actions,
  className,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "flex min-w-0 flex-wrap items-start justify-between gap-4",
        className,
      )}
    >
      <div className="min-w-0">
        {eyebrow ? (
          <p className="text-micro font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="mt-1 truncate font-display text-[32px] font-semibold leading-none tracking-[-0.03em] text-[var(--text-primary)]">
          {title}
        </h1>
        {description ? (
          <p className="mt-2 max-w-2xl text-[12px] leading-5 text-[var(--text-secondary)]">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  );
}
