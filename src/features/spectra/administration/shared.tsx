"use client";

import type { ReactNode } from "react";
import {
  AlertCircle,
  ArrowUpRight,
  CheckCircle2,
  LoaderCircle,
  X,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

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
        "rounded-[8px] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] shadow-[0_1px_2px_rgba(30,26,20,.025)]",
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
        <h2 className="font-[var(--font-serif)] text-[15px] font-medium tracking-[-.01em] text-[var(--text-primary)]">
          {title}
        </h2>
        {detail ? (
          <p className="mt-0.5 text-[10px] leading-4 text-[var(--text-tertiary)]">
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
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  detail: string;
  tone?: "green" | "violet" | "orange" | "blue";
  action?: ReactNode;
}) {
  const toneClass = {
    green: "bg-[#e9f6f0] text-[#15906b]",
    violet: "bg-[#f1ecff] text-[#7a58ee]",
    orange: "bg-[#fff0e5] text-[#ef7c2e]",
    blue: "bg-[#edf3ff] text-[#537fe7]",
  }[tone];
  return (
    <AdminCard className="min-w-0 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] text-[var(--text-secondary)]">{label}</p>
          <strong className="mt-2 block truncate font-sans text-[26px] font-normal leading-none tracking-[-.02em] text-[var(--text-primary)]">
            {value}
          </strong>
          <p
            className={cn(
              "mt-2 text-[10px]",
              tone === "orange"
                ? "text-[#d96f24]"
                : "text-[var(--success,#27876b)]",
            )}
          >
            {detail}
          </p>
        </div>
        <span
          className={cn(
            "grid size-9 shrink-0 place-items-center rounded-[10px]",
            toneClass,
          )}
        >
          <Icon size={17} strokeWidth={1.8} />
        </span>
      </div>
      {action ? <div className="mt-4">{action}</div> : null}
    </AdminCard>
  );
}

export function StatusBadge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "good" | "warn" | "danger" | "blue" | "neutral";
}) {
  return (
    <span
      className={cn(
        "inline-flex min-h-5 items-center rounded-[5px] px-2 text-[9px] font-semibold capitalize",
        tone === "good" && "bg-[#e5f5ee] text-[#278066]",
        tone === "warn" && "bg-[#fff3df] text-[#a9651f]",
        tone === "danger" && "bg-[#fff0ed] text-[#b54a3d]",
        tone === "blue" && "bg-[#edf3ff] text-[#4b72c8]",
        tone === "neutral" &&
          "bg-[var(--bg-secondary)] text-[var(--text-secondary)]",
      )}
    >
      {children}
    </span>
  );
}

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
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex min-h-9 items-center justify-center gap-2 rounded-[7px] border px-3 text-[11px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] disabled:cursor-not-allowed disabled:opacity-50",
        tone === "neutral" &&
          "border-[var(--border-default)] bg-[var(--bg-elevated)] text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]",
        tone === "primary" &&
          "border-[var(--text-primary)] bg-[var(--text-primary)] text-[var(--bg-primary)] hover:opacity-90",
        tone === "danger" &&
          "border-[#e8b8b2] bg-[#fff5f3] text-[#a84035] hover:bg-[#ffece8]",
        tone === "ghost" &&
          "border-transparent bg-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]",
        className,
      )}
    >
      {children}
    </button>
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
      <span className="mb-1.5 block text-[10px] font-medium text-[var(--text-secondary)]">
        {label}
      </span>
      <input
        type={type}
        value={value}
        required={required}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="h-10 w-full rounded-[7px] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 text-[12px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-placeholder)] focus:border-[var(--brand-primary)]"
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
      <span className="mb-1.5 block text-[10px] font-medium text-[var(--text-secondary)]">
        {label}
      </span>
      <textarea
        value={value}
        rows={rows}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="w-full resize-y rounded-[7px] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2.5 text-[12px] leading-5 text-[var(--text-primary)] outline-none placeholder:text-[var(--text-placeholder)] focus:border-[var(--brand-primary)]"
      />
    </label>
  );
}

export function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[10px] font-medium text-[var(--text-secondary)]">
        {label}
      </span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full rounded-[7px] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 text-[12px] text-[var(--text-primary)] outline-none focus:border-[var(--brand-primary)]"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
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
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[120] grid place-items-center bg-[rgba(28,25,21,.28)] p-4 backdrop-blur-[2px]"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="max-h-[min(86dvh,760px)] w-full max-w-[540px] overflow-hidden rounded-[14px] border border-[var(--border-default)] bg-[var(--bg-elevated)] shadow-[0_30px_90px_rgba(31,25,18,.22)]"
      >
        <header className="flex items-start justify-between gap-4 border-b border-[var(--border-subtle)] px-5 py-4">
          <div className="flex gap-3">
            {danger ? (
              <span className="grid size-9 shrink-0 place-items-center rounded-[9px] bg-[#fff0ed] text-[#b54a3d]">
                <AlertCircle size={17} />
              </span>
            ) : null}
            <div>
              <h2 className="font-[var(--font-serif)] text-[19px] font-medium text-[var(--text-primary)]">
                {title}
              </h2>
              {detail ? (
                <p className="mt-1 max-w-md text-[11px] leading-5 text-[var(--text-tertiary)]">
                  {detail}
                </p>
              ) : null}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid size-8 place-items-center rounded-[8px] text-[var(--text-tertiary)] hover:bg-[var(--bg-secondary)]"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </header>
        <div className="max-h-[calc(min(86dvh,760px)-150px)] overflow-y-auto px-5 py-4">
          {children}
        </div>
        {footer ? (
          <footer className="flex items-center justify-end gap-2 border-t border-[var(--border-subtle)] px-5 py-3">
            {footer}
          </footer>
        ) : null}
      </section>
    </div>
  );
}

export function LoadingPanel({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex min-h-56 items-center justify-center gap-2 text-[12px] text-[var(--text-tertiary)]">
      <LoaderCircle size={16} className="animate-spin" />
      {label}
    </div>
  );
}

export function EmptyPanel({
  icon: Icon,
  title,
  detail,
  action,
}: {
  icon: LucideIcon;
  title: string;
  detail: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex min-h-52 flex-col items-center justify-center px-6 text-center">
      <span className="grid size-10 place-items-center rounded-[10px] bg-[var(--bg-secondary)] text-[var(--text-tertiary)]">
        <Icon size={17} />
      </span>
      <strong className="mt-3 font-[var(--font-serif)] text-[16px] font-medium text-[var(--text-primary)]">
        {title}
      </strong>
      <p className="mt-1 max-w-sm text-[11px] leading-5 text-[var(--text-tertiary)]">
        {detail}
      </p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function ErrorPanel({
  message,
  retry,
}: {
  message: string;
  retry: () => void;
}) {
  return (
    <div className="flex min-h-52 flex-col items-center justify-center px-6 text-center">
      <span className="grid size-10 place-items-center rounded-[10px] bg-[#fff0ed] text-[#b54a3d]">
        <AlertCircle size={18} />
      </span>
      <strong className="mt-3 text-[13px] font-semibold text-[var(--text-primary)]">
        Administration data is unavailable
      </strong>
      <p className="mt-1 max-w-md text-[11px] leading-5 text-[var(--text-tertiary)]">
        {message}
      </p>
      <AdminButton className="mt-4" onClick={retry}>
        Try again
      </AdminButton>
    </div>
  );
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
      className="inline-flex items-center gap-1 text-[10px] font-medium text-[#705df2] hover:underline"
    >
      {children}
      <ArrowUpRight size={11} />
    </button>
  );
}

export function PrivacyNotice({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-[7px] border border-[#dbeae4] bg-[#f2faf6] px-3 py-2.5 text-[10px] leading-4 text-[#3b705f]">
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
  color = "#29a17a",
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
