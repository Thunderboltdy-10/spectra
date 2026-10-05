"use client";

import * as React from "react";
import { Icon, type IconName } from "@/components/icons";
import { useLifeDeparture, useLifeEntrance } from "@/features/spectra/life/use-life";
import { cn } from "@/lib/utils";

/**
 * A list item (LANGUAGE.md): a leading glyph, a title, a meta line and
 * trailing actions. Life comes built in: a row made just now (`fresh`) forms
 * out of the field where it appears, and a row that is removed parts there.
 */
export const Row = React.forwardRef<
  HTMLDivElement,
  Omit<React.HTMLAttributes<HTMLDivElement>, "title"> & {
    glyph?: IconName | React.ReactNode;
    /** The glyph's accent: the artifact type's hue. */
    accent?: string;
    title: React.ReactNode;
    meta?: React.ReactNode;
    /** Trailing actions, revealed on hover and focus unless `actionsVisible`. */
    actions?: React.ReactNode;
    actionsVisible?: boolean;
    selected?: boolean;
    /** Made just now, by the user or by Spectra: it forms out of the field. */
    fresh?: boolean;
  }
>(function Row({ glyph, accent, title, meta, actions, actionsVisible, selected, fresh, className, ...props }, forwarded) {
  const ref = React.useRef<HTMLDivElement>(null);
  React.useImperativeHandle(forwarded, () => ref.current!);
  useLifeEntrance(ref, { enabled: Boolean(fresh), bars: "[data-row-title], [data-row-meta]" });
  useLifeDeparture(ref, true, { bars: "[data-row-title], [data-row-meta]" });
  return (
    <div
      ref={ref}
      data-icon-host
      aria-selected={selected}
      className={cn(
        "group/row relative flex min-h-10 items-center gap-2.5 rounded-control px-2.5 py-1.5 text-ui outline-none",
        "transition-colors duration-[var(--motion-fast)] hover:bg-[var(--bg-hover)] focus-within:bg-[var(--bg-hover)]",
        selected && "bg-[var(--bg-hover)]",
        className,
      )}
      {...props}
    >
      {glyph ? (
        <span className="grid size-5 shrink-0 place-items-center text-[var(--text-secondary)]">
          {typeof glyph === "string" ? <Icon name={glyph as IconName} size={16} accent={accent} /> : glyph}
        </span>
      ) : null}
      <span className="min-w-0 flex-1">
        <span data-row-title className="block truncate font-medium text-[var(--text-primary)]">
          {title}
        </span>
        {meta ? (
          <span data-row-meta className="block truncate text-caption text-[var(--text-tertiary)]">
            {meta}
          </span>
        ) : null}
      </span>
      {actions ? (
        <span
          className={cn(
            "flex shrink-0 items-center gap-0.5 transition-opacity duration-[var(--motion-fast)]",
            !actionsVisible && "opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100",
          )}
        >
          {actions}
        </span>
      ) : null}
    </div>
  );
});
