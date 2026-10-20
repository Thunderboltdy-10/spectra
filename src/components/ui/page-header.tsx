"use client";

import * as React from "react";
import { useLifeLanding } from "@/features/spectra/life/use-life";
import { cn } from "@/lib/utils";
import { AdaptiveBar, type BarCommand, type CollapseStep } from "./adaptive-bar";

/**
 * The header line (SHELL.md, "Page anatomy"): the page's title on the left,
 * set large in the display serif on top-level pages the way Home greets
 * (spectra-desk.css, "A page's greeting"), and its AdaptiveBar on the right.
 * One line, always: the bar folds by its authored plan and the title
 * truncates; nothing wraps to a second row.
 *
 * Reached from the rail, a card or a creation, the header grows out of what
 * was pressed: its dots flow across the field into the title and the line
 * under it (LIFE.md, Go to a page).
 */
export function PageHeader({
  title,
  lead,
  level = "top",
  commands = [],
  plan,
  barLabel,
  description,
  className,
  lifeKey,
}: {
  title: React.ReactNode;
  /** Before the title: a back control, or a breadcrumb that folds a navigation column. */
  lead?: React.ReactNode;
  /**
   * `top` pages title large in the display serif; a `place` inside one (a
   * workspace, a folder) in the same serif a size down; nested pages and
   * sub-views in the UI face.
   */
  level?: "top" | "place" | "nested";
  commands?: readonly BarCommand[];
  plan?: readonly CollapseStep[];
  /** The toolbar's accessible name, e.g. "School commands". */
  barLabel?: string;
  /** One quiet sentence under the line, only when the page needs it. */
  description?: React.ReactNode;
  className?: string;
  /** What the header is the header of, when the title is not a plain string: a new key lands again. */
  lifeKey?: string;
}) {
  const ref = React.useRef<HTMLElement>(null);
  useLifeLanding(ref, lifeKey ?? (typeof title === "string" ? title : barLabel ?? "page"));
  return (
    <header ref={ref} className={cn("min-w-0", className)}>
      <div className="flex min-h-10 min-w-0 items-center gap-3">
        {lead ? <div className="flex min-w-0 shrink items-center gap-1">{lead}</div> : null}
        <h1
          data-panel-title
          className={cn(
            "min-w-0 shrink truncate text-[var(--text-primary)]",
            level === "top"
              ? "page-greeting pb-1"
              : level === "place"
                ? "page-greeting page-greeting--place pb-0.5"
                : "text-title font-semibold leading-tight",
          )}
        >
          {title}
        </h1>
        {commands.length ? (
          <AdaptiveBar commands={commands} plan={plan} label={barLabel ?? "Page commands"} className="min-w-12" />
        ) : null}
      </div>
      {description ? (
        <p className={level !== "nested" ? "page-greeting-line mt-2" : "mt-1.5 max-w-2xl text-caption leading-5 text-[var(--text-secondary)]"}>{description}</p>
      ) : null}
    </header>
  );
}

/**
 * A page's scrolling body: the page gutters, and room under the content to
 * scroll clear of the island (about 88 px, or the island's own band).
 */
export const PageBody = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement> & { width?: "full" | "reading" }>(
  function PageBody({ className, width = "full", ...props }, ref) {
    return (
      <div
        ref={ref}
        className={cn(
          "spectra-page-scroll w-full px-4 pt-5 sm:px-6 lg:px-8 page-title-lane",
          width === "reading" && "mx-auto max-w-4xl",
          className,
        )}
        {...props}
      />
    );
  },
);
