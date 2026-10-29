"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { AlertCircle, LockKeyhole, X, type GlyphIcon } from "@/components/icons/glyph-icons";
import { cn } from "@/lib/utils";
import type { CapabilityState } from "@/features/spectra/core/capability-truth";
import { CapabilityTruthBadge } from "@/features/spectra/integrations/status/capability-truth";
import { ProductEmptyState, ProductErrorState } from "@/features/spectra/components/product-state";
import { Button } from "@/components/ui/button";
import { LoadingRows } from "@/components/ui/page-state";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { SelectField } from "@/components/ui/select";
import {
  MetricValue,
  readingFromCapability,
} from "@/components/ui/truthful-state";

/* Administration consumes the product primitives; it does not keep its own kit.
   `StatusBadge` and `SelectField` used to be forks living here — a parallel
   status vocabulary and a hand-rolled native `<select>`. Both are now the shared
   primitives, re-exported so existing call sites keep importing from one place. */
export { StatusBadge, statusToneFor, type StatusTone } from "@/components/ui/badge";
export { SelectField };

function userFacingMetricSource(source: string) {
  if (/usageMeters/i.test(source)) return "Daily usage meter";
  if (/operationalCounters/i.test(source)) return "Daily operational counters";
  return "Product records";
}

export function AdminCard({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "rounded-card bg-transparent",
        className,
      )}
    >
      {children}
    </section>
  );
}

export function AdminSectionHeader({
  title,
  count,
  detail,
  action,
}: {
  title: string;
  /** A count set quietly after the title. */
  count?: number | string;
  detail?: string;
  action?: ReactNode;
}) {
  return (
    <header className="admin-head">
      <h2>
        {title}
        {count !== undefined ? <span>{count}</span> : null}
      </h2>
      {action ? <div className="admin-head-actions">{action}</div> : null}
      {detail ? <p>{detail}</p> : null}
    </header>
  );
}

/** Counts laid on one sheet of paper, as Home lays the week open. */
export function TallySheet({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("admin-sheet", className)}>{children}</div>;
}

/**
 * One count on a TallySheet: the number large in the display serif, what it
 * counts above it, a line of detail under it and, when there is one, the
 * place to act on it as an underlined link. A count the meters could not
 * supply says so instead of printing a number.
 */
export function MetricCard({
  icon: Icon,
  label,
  value,
  detail,
  action,
  state,
  source,
  attention,
}: {
  icon?: GlyphIcon;
  label: string;
  value: string;
  detail?: string;
  /** Kept for callers that still pass it; the ink is the same for every count. */
  tone?: "green" | "violet" | "orange" | "blue";
  action?: ReactNode;
  state?: CapabilityState;
  source?: string;
  /** This count is waiting on someone. */
  attention?: boolean;
}) {
  const reading = readingFromCapability(state, value);
  return (
    <section
      className="admin-tally"
      data-tone={attention ? "attention" : undefined}
      title={source ? `Counted from: ${userFacingMetricSource(source)}` : undefined}
    >
      <p className="admin-tally-label">
        {Icon ? <Icon size={14} strokeWidth={1.8} aria-hidden /> : null}
        {label}
        {state && state.kind !== "available" ? (
          <CapabilityTruthBadge state={state} className="min-h-5 px-2 text-micro" />
        ) : null}
      </p>
      {/* The value goes through `MetricValue`, so a capability that could
          not supply a number cannot print one. */}
      <MetricValue reading={reading} className="flex" valueClassName="admin-tally-value min-w-0" />
      {detail ? <p className="admin-tally-detail">{detail}</p> : null}
      {action}
    </section>
  );
}

/** Administration's button is the product button. Tones map onto its variants. */
export function AdminButton({
  children,
  onClick,
  disabled,
  type = "button",
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  type?: "button" | "submit";
  tone?: "neutral" | "primary" | "danger" | "ghost";
  className?: string;
}) {
  return (
    <Button
      type={type}
      onClick={onClick}
      disabled={disabled}
      variant={
        tone === "primary"
          ? "primary"
          : tone === "danger"
            ? "destructive"
            : tone === "ghost"
              ? "ghost"
              : "secondary"
      }
      className={className}
    >
      {children}
    </Button>
  );
}

export function TextField({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  required,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: "text" | "email" | "datetime-local" | "number" | "url";
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-micro font-medium text-[var(--text-secondary)]">
        {label}
      </span>
      <input
        type={type}
        value={value}
        required={required}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="h-10 w-full rounded-control border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 text-caption text-[var(--text-primary)] outline-none placeholder:text-[var(--text-placeholder)] focus:border-[var(--brand-primary)]"
      />
    </label>
  );
}

export function TextAreaField({
  label,
  value,
  onChange,
  placeholder,
  rows = 4,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-micro font-medium text-[var(--text-secondary)]">
        {label}
      </span>
      <textarea
        value={value}
        rows={rows}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="w-full resize-y rounded-control border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2.5 text-caption leading-5 text-[var(--text-primary)] outline-none placeholder:text-[var(--text-placeholder)] focus:border-[var(--brand-primary)]"
      />
    </label>
  );
}

export function AdminDialog({
  open,
  title,
  detail,
  children,
  onClose,
  footer,
  danger,
}: {
  open: boolean;
  title: string;
  detail?: string;
  children: ReactNode;
  onClose: () => void;
  footer?: ReactNode;
  danger?: boolean;
}) {
  // The shared Dialog: one veil, the float entrance, Radix's focus trap and
  // focus return, and — through the host-layer context — select lists and
  // menus that open *above* the dialog. The hand-rolled version sat at the
  // composer-dock layer while its SelectField list opened at `dropdown`,
  // behind the veil, so the invite form's profile picker could not be used.
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent
        layer="composer-dock"
        hideCloseButton
        className="flex max-h-[min(86dvh,760px)] max-w-[540px] flex-col gap-0 overflow-hidden p-0"
      >
        <header className="flex items-start justify-between gap-4 border-b border-[var(--border-subtle)] px-5 py-4">
          <div className="flex gap-3">
            {danger ? (
              <span className="grid size-9 shrink-0 place-items-center rounded-control bg-[color-mix(in_oklab,var(--danger)_10%,var(--bg-secondary))] [color:color-mix(in_oklab,var(--danger)_80%,var(--text-primary))]">
                <AlertCircle size={17} />
              </span>
            ) : null}
            <div>
              <DialogTitle className="font-display text-heading font-medium text-[var(--text-primary)]">
                {title}
              </DialogTitle>
              {detail ? (
                <DialogDescription className="mt-1 max-w-md text-micro leading-5 text-[var(--text-tertiary)]">
                  {detail}
                </DialogDescription>
              ) : null}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid size-8 place-items-center rounded-control text-[var(--text-tertiary)] outline-none hover:bg-[var(--bg-secondary)] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {children}
        </div>
        {footer ? (
          <footer className="flex items-center justify-end gap-2 border-t border-[var(--border-subtle)] px-5 py-3">
            {footer}
          </footer>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export function LoadingPanel({ label = "Loading" }: { label?: string }) {
  return <LoadingRows label={label} count={5} className="px-4 py-3" />;
}

export function EmptyPanel({
  icon: Icon,
  title,
  detail,
  action,
}: {
  icon: GlyphIcon;
  title: string;
  detail: string;
  action?: ReactNode;
}) {
  return <ProductEmptyState icon={Icon} title={title} detail={detail} action={action} />;
}

export function ErrorPanel({
  message,
  retry,
}: {
  message: string;
  retry: () => void;
}) {
  return <ProductErrorState title="This didn’t load" detail={message} action={<AdminButton onClick={retry}>Try again</AdminButton>} />;
}

/** An underlined ink link, as Home's section links. */
export function InlineLink({
  children,
  onClick,
  href,
  disabled,
  title,
  tone,
}: {
  children: ReactNode;
  onClick?: () => void;
  href?: string;
  disabled?: boolean;
  title?: string;
  tone?: "attention";
}) {
  if (href && !disabled)
    return (
      <Link href={href} className="admin-link" data-tone={tone} title={title}>
        {children}
      </Link>
    );
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={title} className="admin-link" data-tone={tone}>
      {children}
    </button>
  );
}

/** What a page can and cannot see, said once, quietly, at its foot. */
export function PrivacyNotice({ children }: { children: ReactNode }) {
  return (
    <p className="admin-footnote">
      <LockKeyhole size={13} aria-hidden />
      <span>{children}</span>
    </p>
  );
}

export function formatCompact(value: number | null | undefined) {
  if (value === null || value === undefined) return "Awaiting meter";
  return new Intl.NumberFormat(undefined, {
    notation: value >= 10_000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(value);
}

export function formatBytes(value: number | null | undefined) {
  if (value === null || value === undefined) return "Awaiting meter";
  if (value === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(
    units.length - 1,
    Math.floor(Math.log(Math.abs(value)) / Math.log(1024)),
  );
  return `${(value / 1024 ** index).toFixed(index > 2 ? 1 : 0)} ${units[index]}`;
}

export function formatRelative(timestamp?: number) {
  if (!timestamp) return "Not yet";
  const delta = Date.now() - timestamp;
  if (delta < 60_000) return "Just now";
  if (delta < 3_600_000) return `${Math.round(delta / 60_000)} min ago`;
  if (delta < 86_400_000) return `${Math.round(delta / 3_600_000)} hr ago`;
  return `${Math.round(delta / 86_400_000)} d ago`;
}

export function Sparkline({
  values,
  color = "var(--accent-mint)",
}: {
  values: number[];
  color?: string;
}) {
  const safe = values.length >= 2 ? values : [0, 0];
  const min = Math.min(...safe);
  const max = Math.max(...safe);
  const span = Math.max(1, max - min);
  const points = safe
    .map(
      (value, index) =>
        `${(index / Math.max(1, safe.length - 1)) * 100},${26 - ((value - min) / span) * 22}`,
    )
    .join(" ");
  return (
    <svg
      viewBox="0 0 100 30"
      preserveAspectRatio="none"
      className="h-7 w-24 overflow-visible"
      aria-hidden="true"
    >
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.6"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
