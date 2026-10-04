"use client";

import * as React from "react";
import { Icon } from "@/components/icons";
import { cn } from "@/lib/utils";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./dropdown-menu";
import type { SpectraLayer } from "./layers";

export type SplitButtonItem = {
  key: string;
  /** Short: "Always allow", not "Always allow this tool in this workspace". */
  label: string;
  /** An optional quiet second line. */
  description?: string;
  disabled?: boolean;
};

/**
 * One action with its variants (LANGUAGE.md): a single rounded shape whose
 * menu segment has its own rounded end. The menu portals to the body, so it
 * is never clipped by the bar or card the button sits in.
 */
export function SplitButton({
  label,
  onClick,
  items,
  onSelect,
  menuLabel,
  variant = "primary",
  disabled,
  layer,
  className,
}: {
  label: React.ReactNode;
  onClick: () => void;
  items: readonly SplitButtonItem[];
  onSelect: (key: string) => void;
  /** Accessible name for the menu segment, e.g. "More ways to allow". */
  menuLabel: string;
  variant?: "primary" | "secondary";
  disabled?: boolean;
  layer?: SpectraLayer;
  className?: string;
}) {
  const tone =
    variant === "primary"
      ? "bg-[var(--text-primary)] [color:var(--bg-primary)] hover:opacity-90"
      : "bg-[var(--bg-elevated)] text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] border border-[var(--border-default)]";
  const segment = cn(
    "inline-flex min-h-8 items-center outline-none transition-[opacity,background-color] duration-[var(--motion-fast)]",
    "focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-primary)]",
    "disabled:pointer-events-none disabled:opacity-45",
    tone,
  );
  return (
    <span className={cn("inline-flex shrink-0 items-stretch", className)} data-split-button>
      <button type="button" onClick={onClick} disabled={disabled} className={cn(segment, "whitespace-nowrap rounded-l-control px-3 text-caption font-semibold", variant === "secondary" && "border-r-0")}>
        {label}
      </button>
      <span aria-hidden className={cn("w-px", variant === "primary" ? "bg-[color-mix(in_oklab,var(--bg-primary)_30%,transparent)]" : "bg-[var(--border-default)]")} />
      <DropdownMenu>
        <DropdownMenuTrigger aria-label={menuLabel} disabled={disabled} className={cn(segment, "rounded-r-control px-2", variant === "secondary" && "border-l-0")}>
          <Icon name="chevronDown" size={14} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" layer={layer} className="min-w-[12rem]">
          {items.map((item) => (
            <DropdownMenuItem key={item.key} disabled={item.disabled} onSelect={() => onSelect(item.key)} className="flex-col items-start gap-0.5">
              <span className="font-medium">{item.label}</span>
              {item.description ? <span className="text-micro text-[var(--text-tertiary)]">{item.description}</span> : null}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  );
}
