import type { ButtonHTMLAttributes, CSSProperties, HTMLAttributes, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

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
  | "selected"
  | "focused"
  | "context"
  | "creating"
  | "updating"
  | "edited"
  | "confirmation"
  | "failed"
  | "disabled"
  | "archived"
  | "continued";

export function spectraCardClass(variant: SpectraCardVariant, className?: string) {
  return cn("spectra-card", `spectra-card--${variant}`, className);
}

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
  return (
    <article
      {...props}
      className={spectraCardClass(variant, className)}
      data-spectra-card={variant}
      data-card-state={state}
      style={{ ...style, ...(accent ? { "--card-accent": accent } : {}) } as CSSProperties}
    >
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
    <button
      {...props}
      type="button"
      className={cn("spectra-icon-action", active && "is-active", danger && "is-danger", className)}
      aria-label={label}
      title={label}
      data-tooltip={label}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
    </button>
  );
}
