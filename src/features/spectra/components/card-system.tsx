"use client";

import { type GlyphIcon } from "@/components/icons/glyph-icons";
import { useRef } from "react";
import type { ButtonHTMLAttributes, CSSProperties, HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Tooltip } from "@/components/ui/tooltip";
import { useLifeArrival, useLifeDeparture, useLifeGlow, type ArrivalKind } from "../life/use-life";

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

/** States in which Spectra is working on the card, so the field glows around it (LIFE.md, glow). */
const CARD_WORKING: ReadonlySet<SpectraCardState> = new Set(["creating", "updating"]);

export function SpectraCard({
  variant,
  state = "normal",
  accent,
  lifeKey,
  arrival,
  className,
  style,
  children,
  ...props
}: HTMLAttributes<HTMLElement> & {
  variant: SpectraCardVariant;
  state?: SpectraCardState;
  accent?: string;
  /** Who it is, for the field: a card new since the page opened forms, and a card removed parts (LIFE.md). */
  lifeKey?: string;
  /** Who made it, when it is new: Spectra's light travels from the prism; the user's forms where they acted. */
  arrival?: ArrivalKind;
  children: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  useLifeGlow(ref, CARD_WORKING.has(state));
  useLifeArrival(ref, lifeKey, arrival);
  useLifeDeparture(ref, Boolean(lifeKey), undefined, lifeKey);

  return (
    <article
      {...props}
      ref={ref}
      className={spectraCardClass(variant, className)}
      data-spectra-card={variant}
      data-life-key={lifeKey}
      data-card-state={state}
      style={{ ...style, ...(accent ? { "--card-accent": accent } : {}) } as CSSProperties}
    >
      {children}
    </article>
  );
}

export function CardTypeIcon({ icon: Icon, color, className }: { icon: GlyphIcon; color: string; className?: string }) {
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
  icon: GlyphIcon;
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
