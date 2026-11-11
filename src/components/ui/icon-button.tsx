"use client";

import * as React from "react";
import { Icon, type IconName } from "@/components/icons";
import { cn } from "@/lib/utils";
import { Tooltip } from "./tooltip";

export type IconButtonProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  /** A Spectra glyph, or a node (editor workbars pass a lucide icon). */
  icon: IconName | React.ReactElement | null;
  /** The name: the accessible label and the tooltip. */
  label: string;
  shortcut?: string;
  /** 28 (compact), 36 (default, the bar's height) or 40 (large). */
  size?: "compact" | "default" | "large";
  /** The glyph's accent colour. */
  accent?: string;
  /** Pressed state, for toggles. */
  pressed?: boolean;
  tooltipSide?: "top" | "bottom" | "right";
};

const SIZES = { compact: "size-7", default: "size-9", large: "size-10" } as const;
const GLYPHS = { compact: 16, default: 18, large: 20 } as const;

/** An icon-only control: always named, always with a tooltip (LANGUAGE.md). */
export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, label, shortcut, size = "default", accent, pressed, tooltipSide = "top", className, type, ...props },
  ref,
) {
  const glyph = typeof icon === "string" ? <Icon name={icon as IconName} size={GLYPHS[size]} accent={accent} /> : icon;
  return (
    <Tooltip label={label} shortcut={shortcut} side={tooltipSide}>
      <button
        ref={ref}
        type={type ?? "button"}
        aria-label={label}
        aria-pressed={pressed}
        aria-keyshortcuts={shortcut}
        className={cn(
          "grid shrink-0 place-items-center rounded-control text-[var(--text-secondary)] outline-none",
          "transition-[color,background-color,transform] duration-[var(--motion-fast)] ease-[var(--ease-standard)]",
          "hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] active:scale-[0.96]",
          "focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]",
          "disabled:pointer-events-none disabled:opacity-45",
          pressed && "bg-[var(--bg-hover)] text-[var(--text-primary)]",
          SIZES[size],
          className,
        )}
        {...props}
      >
        {glyph}
      </button>
    </Tooltip>
  );
});
