"use client";

import { Check, ChevronDown } from "lucide-react";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type WorkbarOption<T extends string = string> = {
  value: T;
  label: string;
};

export function WorkbarSelect<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  className,
  disabled,
  align = "start",
}: {
  value: T;
  options: Array<WorkbarOption<T>>;
  onChange: (value: T) => void;
  ariaLabel: string;
  className?: string;
  disabled?: boolean;
  align?: "start" | "end";
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const listId = useId();
  const selected = options.find((option) => option.value === value);

  useEffect(() => {
    if (!open) return;
    function close(event: PointerEvent) {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className={`relative min-w-0 ${className ?? ""}`} ref={ref}>
      <button
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={listId}
        onClick={() => setOpen((current) => !current)}
        className="spectra-workbar-select inline-flex h-8 max-w-[240px] items-center gap-1.5 rounded-[7px] px-2 text-[12px] font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:opacity-45"
      >
        <span className="min-w-0 truncate">{selected?.label ?? "Choose"}</span>
        <ChevronDown className="h-3 w-3 shrink-0 text-[var(--text-tertiary)]" />
      </button>
      {open ? (
        <div
          id={listId}
          role="listbox"
          aria-label={ariaLabel}
          className={`absolute top-[calc(100%+6px)] z-50 max-h-64 min-w-[188px] overflow-y-auto rounded-[9px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-1.5 shadow-[0_14px_32px_rgba(27,20,12,0.13)] ${align === "end" ? "right-0" : "left-0"}`}
        >
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={option.value === value}
              className="flex w-full items-center gap-2 rounded-[7px] px-2.5 py-1.5 text-left text-[13px] font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
            >
              <span className="min-w-0 flex-1 truncate">{option.label}</span>
              {option.value === value ? (
                <Check className="h-3.5 w-3.5 shrink-0 text-[var(--success)]" />
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function WorkbarMenu({
  label,
  open,
  onOpenChange,
  children,
  align = "start",
}: {
  label: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
  align?: "start" | "end";
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function close(event: PointerEvent) {
      if (!ref.current?.contains(event.target as Node)) onOpenChange(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onOpenChange(false);
    }
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [onOpenChange, open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => onOpenChange(!open)}
        className="spectra-workbar-select inline-flex h-8 items-center gap-1 rounded-[7px] px-2 text-[12px] font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
      >
        {label}
        <ChevronDown className="h-3 w-3 text-[var(--text-tertiary)]" />
      </button>
      {open ? (
        <div
          role="menu"
          className={`absolute top-[calc(100%+6px)] z-50 min-w-[210px] overflow-hidden rounded-[9px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-1.5 shadow-[0_14px_32px_rgba(27,20,12,0.13)] ${align === "end" ? "right-0" : "left-0"}`}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}

export function workbarMenuItemClass() {
  return "flex w-full items-center gap-2 rounded-[7px] px-2.5 py-1.5 text-left text-[13px] font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:opacity-45";
}
