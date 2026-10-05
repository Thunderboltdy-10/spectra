"use client";

import type { ReactNode } from "react";
import { ArrowUpRight, AlertCircle, CheckCircle2, X, type GlyphIcon } from "@/components/icons/glyph-icons";
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
  detail,
  action,
}: {
  title: string;
  detail?: string;
  action?: ReactNode;
}) {
  return (
    <header className="flex min-h-14 items-start justify-between gap-4 px-4 pb-2 pt-4">
      <div>
        <h2 className="font-[var(--font-serif)] text-subhead font-medium tracking-[-.01em] text-[var(--text-primary)]">
          {title}
        </h2>
        {detail ? (
          <p className="mt-0.5 text-micro leading-4 text-[var(--text-tertiary)]">
            {detail}
          </p>
        ) : null}
      </div>
      {action}
    </header>
  );
}

export function MetricCard({
  icon: Icon,
  label,
  value,
  detail,
  tone = "green",
  action,
  state,
  source,
}: {
  icon: GlyphIcon;
  label: string;
  value: string;
  detail: string;
  tone?: "green" | "violet" | "orange" | "blue";
  action?: ReactNode;
  state?: CapabilityState;
  source?: string;
}) {
  const toneClass = {
    green: "text-[var(--accent-mint)]",
    violet: "text-[var(--accent-violet)]",
    orange: "text-[var(--accent-orange)]",
    blue: "text-[var(--accent-cyan)]",
  }[tone];
  return (
    <section
      className="group min-w-0 rounded-card px-4 py-3 transition-colors hover:bg-[var(--bg-secondary)]"
      title={source ? `Source: ${userFacingMetricSource(source)}` : undefined}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-[var(--text-secondary)]">
            <Icon size={14} className={toneClass} strokeWidth={1.8} />
            <p className="text-micro">{label}</p>
            {state && state.kind !== "available" ? (
              <CapabilityTruthBadge state={state} className="min-h-5 px-2 text-micro" />
            ) : null}
          </div>
          {/* S8: the value is rendered through `MetricValue`, so a capability
              that could not supply a number cannot print one. `/admin` → Usage
              stamping `Collaboration 0 B` as complete is the defect this
              closes at the component level. */}
          <MetricValue
            reading={readingFromCapability(state, value)}
            className="mt-2 flex"
            valueClassName="min-w-0 leading-none"
          />
          <p className="mt-2 text-micro leading-4 text-[var(--text-secondary)]">
            {detail}
          </p>
        </div>
      </div>
      {action ? (
        <div className="mt-3 [&>button]:min-h-7 [&>button]:w-auto [&>button]:border-0 [&>button]:bg-transparent [&>button]:px-0 [&>button]:text-[var(--brand-primary)]">
          {action}
        </div>
      ) : null}
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
              <DialogTitle className="font-[var(--font-serif)] text-heading font-medium text-[var(--text-primary)]">
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

export function InlineLink({
  children,
  onClick,
}: {
  children: ReactNode;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 text-micro font-medium text-[var(--brand-primary)] hover:underline"
    >
      {children}
      <ArrowUpRight size={11} />
    </button>
  );
}

export function PrivacyNotice({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-control border border-[color-mix(in_oklab,var(--success)_18%,var(--border-subtle))] bg-[color-mix(in_oklab,var(--success)_7%,var(--bg-secondary))] px-3 py-2.5 text-micro leading-4 [color:color-mix(in_oklab,var(--success)_78%,var(--text-primary))]">
      <CheckCircle2 size={13} className="mt-0.5 shrink-0" />
      <span>{children}</span>
    </div>
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
