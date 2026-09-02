"use client";

import { useMemo } from "react";
import type { ButtonHTMLAttributes, CSSProperties, HTMLAttributes, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip } from "@/components/ui/tooltip";
import { SurfaceField, type FieldInfluence } from "../field/surface-field";

export type SpectraCardVariant =
  | "artifact"
  | "inbox"
  | "workspace"
  | "board"
  | "pinned"
  | "timeline"
  | "canvas"
  | "result"
  | "side";

export type SpectraCardState =
  | "normal"
  | "pinned"
  | "selected"
  | "active"
  | "focused"
  | "context"
  | "multi-selected"
  | "creating"
  | "updating"
  | "completed"
  | "edited"
  | "confirmation"
  | "failed"
  | "disabled"
  | "archived"
  | "continued"
  | "drag-preview"
  | "drop-target";

export function spectraCardClass(variant: SpectraCardVariant, className?: string) {
  return cn("spectra-card", `spectra-card--${variant}`, className);
}

/**
 * Which card states wake the surface field, and how.
 *
 * A card is not made colourful because it is selected. Its field changes
 * structure in the lower right, where the card's own weight sits, and takes
 * the colour of whatever is actually happening to it.
 */
const CARD_FIELD: Partial<
  Record<
    SpectraCardState,
    { state: FieldInfluence["state"]; hue: string; strength?: number }
  >
> = {
  selected: { state: "active", hue: "var(--brand-primary)", strength: 0.2 },
  active: { state: "active", hue: "var(--brand-primary)", strength: 0.26 },
  focused: { state: "active", hue: "var(--accent-cyan)", strength: 0.22 },
  context: { state: "active", hue: "var(--brand-primary)", strength: 0.16 },
  "multi-selected": {
    state: "active",
    hue: "var(--brand-primary)",
    strength: 0.24,
  },
  creating: { state: "typing", hue: "var(--brand-primary)" },
  updating: { state: "typing", hue: "var(--accent-cyan)" },
  edited: { state: "success", hue: "var(--success)" },
  completed: { state: "success", hue: "var(--success)" },
  failed: { state: "failure", hue: "var(--danger)" },
  confirmation: { state: "waiting", hue: "var(--warning)" },
  "drag-preview": { state: "drag", hue: "var(--accent-cyan)" },
  "drop-target": { state: "waiting", hue: "var(--accent-cyan)" },
};

export function SpectraCard({
  variant,
  state = "normal",
  accent,
  className,
  style,
  children,
  ...props
}: HTMLAttributes<HTMLElement> & {
  variant: SpectraCardVariant;
  state?: SpectraCardState;
  accent?: string;
  children: ReactNode;
}) {
  const wake = CARD_FIELD[state];
  const influences = useMemo<FieldInfluence[]>(
    () =>
      wake
        ? [
            {
              id: "card",
              x: 0.72,
              y: 0.74,
              radius: 0.78,
              strength:
                wake.strength ?? (wake.state === "typing" ? 0.8 : 0.62),
              hue: wake.hue,
              state: wake.state,
            },
          ]
        : [],
    [wake],
  );

  return (
    <article
      {...props}
      className={spectraCardClass(variant, className)}
      data-spectra-card={variant}
      data-card-state={state}
      style={{ ...style, ...(accent ? { "--card-accent": accent } : {}) } as CSSProperties}
    >
      <SurfaceField influences={influences} scale="card" grain="wave" behind />
      {children}
    </article>
  );
}

export function CardTypeIcon({ icon: Icon, color, className }: { icon: LucideIcon; color: string; className?: string }) {
  return (
    <span className={cn("spectra-card-type-icon", className)} style={{ color, "--card-accent": color } as CSSProperties}>
      <Icon className="h-4 w-4" aria-hidden="true" />
    </span>
  );
}

export function IconAction({
  label,
  icon: Icon,
  active = false,
  danger = false,
  className,
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  label: string;
  icon: LucideIcon;
  active?: boolean;
  danger?: boolean;
}) {
  return (
    <Tooltip label={label}><button
      {...props}
      type="button"
      className={cn("spectra-icon-action", active && "is-active", danger && "is-danger", className)}
      aria-label={label}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
    </button></Tooltip>
  );
}
