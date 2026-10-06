import type { ReactNode } from "react";
import { Icon, type IconName } from "@/components/icons";
import { cn } from "@/lib/utils";
import { Skeleton } from "./skeleton";

/*
 * The kit's page states (SHELL.md, "Page anatomy"). Each says what is
 * happening in one plain sentence and offers the next step.
 */

type Glyph = IconName | ((props: { size?: number }) => ReactNode);

function glyphOf(icon: Glyph, size: number) {
  if (typeof icon === "string") return <Icon name={icon as IconName} size={size} />;
  const Component = icon;
  return <Component size={size} />;
}

/** Nothing here yet: what this place is for, and how to fill it. */
export function EmptyState({
  icon,
  title,
  detail,
  action,
  compact = false,
  className,
}: {
  icon: Glyph;
  title: string;
  detail?: ReactNode;
  /** The next step: a Button, or a link. */
  action?: ReactNode;
  /** Inside a panel or a section, not a whole page. */
  compact?: boolean;
  className?: string;
}) {
  return (
    <div
      data-empty-state
      className={cn(
        "flex flex-col items-center justify-center px-6 text-center",
        compact ? "min-h-32 py-6" : "min-h-52 py-10",
        className,
      )}
    >
      <span aria-hidden className="grid size-10 place-items-center text-[var(--text-tertiary)]" data-icon-host>
        {glyphOf(icon, compact ? 20 : 24)}
      </span>
      <strong
        className={cn(
          "mt-2 font-semibold text-[var(--text-primary)]",
          compact ? "text-ui" : "font-display text-title",
        )}
      >
        {title}
      </strong>
      {detail ? <p className="mt-1 max-w-sm text-caption leading-5 text-[var(--text-secondary)]">{detail}</p> : null}
      {action ? <div className="mt-4 flex flex-wrap items-center justify-center gap-2">{action}</div> : null}
    </div>
  );
}

/** Something went wrong: what happened, in words, and what to do about it. */
export function ProblemState({
  title,
  detail,
  action,
  compact = false,
  className,
}: {
  title: string;
  detail?: ReactNode;
  /** The way out: Try again, Reconnect, Go back. */
  action?: ReactNode;
  compact?: boolean;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center justify-center px-6 text-center",
        compact ? "min-h-32 py-6" : "min-h-52 py-10",
        className,
      )}
    >
      <span aria-hidden className="grid size-10 place-items-center" data-icon-host>
        <Icon name="problem" size={compact ? 20 : 24} accent="var(--danger)" />
      </span>
      <strong className="mt-2 text-ui font-semibold text-[var(--text-primary)]">{title}</strong>
      {detail ? <p className="mt-1 max-w-md text-caption leading-5 text-[var(--text-secondary)]">{detail}</p> : null}
      {action ? <div className="mt-4 flex flex-wrap items-center justify-center gap-2">{action}</div> : null}
    </div>
  );
}

/** Rows on their way: ghosts at the rows' real places, with a glyph, a title and a meta line. */
export function LoadingRows({ count = 4, label = "Loading", className }: { count?: number; label?: string; className?: string }) {
  return (
    <div role="status" aria-label={label} className={cn("space-y-1", className)}>
      {Array.from({ length: count }, (_, index) => (
        <div key={index} data-life-ghost className="flex min-h-10 items-center gap-2.5 rounded-control px-2.5 py-1.5">
          <Skeleton bar className="size-5 shrink-0" />
          <span className="min-w-0 flex-1 space-y-1.5">
            <Skeleton bar className="h-3.5" style={{ width: `${62 - ((index * 17) % 30)}%` }} />
            <Skeleton bar className="h-3" style={{ width: `${38 - ((index * 11) % 16)}%` }} />
          </span>
        </div>
      ))}
    </div>
  );
}
