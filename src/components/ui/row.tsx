"use client";

import * as React from "react";
import { Icon, type IconName } from "@/components/icons";
import { useLifeArrival, useLifeDeparture, useLifeEntrance, useLifeJoin } from "@/features/spectra/life/use-life";
import { cn } from "@/lib/utils";

/**
 * A list item (LANGUAGE.md): a leading glyph, a title, a meta line and
 * trailing actions. Life comes built in: a row made just now (`fresh`) forms
 * out of the field where it appears, and a row that is removed parts there.
 * With a `lifeKey`, a row that moves (another group, another list) travels
 * there instead, and anything that departs under the same key flows into it;
 * a row that joins its list later forms from the press that made it, or
 * arrives from the prism while Spectra works (LIFE.md, Join any list).
 */
const ROW_FIGURE = { bars: "[data-row-title], [data-row-meta]" };

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
    /** What the row shows, stable across lists: it travels when it moves (LIFE.md, Move). */
    lifeKey?: string;
  }
>(function Row({ glyph, accent, title, meta, actions, actionsVisible, selected, fresh, lifeKey, className, ...props }, forwarded) {
  const ref = React.useRef<HTMLDivElement>(null);
  React.useImperativeHandle(forwarded, () => ref.current!);
  useLifeEntrance(ref, { enabled: Boolean(fresh) && !lifeKey, ...ROW_FIGURE });
  useLifeArrival(ref, lifeKey, fresh ? "human" : undefined, ROW_FIGURE);
  useLifeJoin(ref, lifeKey ?? "", ROW_FIGURE);
  useLifeDeparture(ref, true, ROW_FIGURE, lifeKey);
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
