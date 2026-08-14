"use client";

import { Ellipsis, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** Shared horizontal section navigation, derived from Library's calm tab rail. */
export function ProductSectionNav<T extends string>({
  label,
  items,
  active,
  onChange,
  primaryCount = 5,
  className,
}: {
  label: string;
  items: Array<{ key: T; label: string; icon: LucideIcon }>;
  active: T;
  onChange: (key: T) => void;
  primaryCount?: number;
  className?: string;
}) {
  const primary = items.slice(0, primaryCount);
  const overflow = items.slice(primaryCount);
  const activeOverflow = overflow.some((item) => item.key === active);

  return (
    <nav
      aria-label={label}
      className={cn(
        "mb-5 flex min-w-0 items-end gap-4 overflow-hidden border-b border-[var(--border-default)] sm:gap-6",
        className,
      )}
    >
      {primary.map((item) => {
        const Icon = item.icon;
        const selected = item.key === active;
        return (
          <button
            key={item.key}
            type="button"
            onClick={() => onChange(item.key)}
            aria-current={selected ? "page" : undefined}
            aria-label={item.label}
            title={item.label}
            className={cn(
              "relative flex h-10 shrink-0 items-center gap-2 px-0.5 text-[12px] font-medium transition-colors",
              selected
                ? "text-[var(--text-primary)]"
                : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]",
            )}
          >
            <Icon className="size-3.5" />
            <span className="hidden min-[520px]:inline">{item.label}</span>
            {selected ? (
              <span className="absolute inset-x-0 -bottom-px h-0.5 bg-[var(--text-primary)]" />
            ) : null}
          </button>
        );
      })}
      {overflow.length ? (
        <label
          className={cn(
            "relative ml-auto grid size-10 shrink-0 cursor-pointer place-items-center rounded-lg transition-colors hover:bg-[var(--bg-hover)]",
            activeOverflow ? "text-[var(--text-primary)]" : "text-[var(--text-secondary)]",
          )}
          title={activeOverflow ? overflow.find((item) => item.key === active)?.label : `More ${label}`}
        >
          <span className="sr-only">More {label}</span>
          <Ellipsis className="pointer-events-none size-4" />
          <select
            aria-label={`More ${label}`}
            value={activeOverflow ? active : ""}
            onChange={(event) => {
              if (event.target.value) onChange(event.target.value as T);
            }}
            className="absolute inset-0 h-full w-full cursor-pointer appearance-none opacity-0"
          >
            <option value="">More sections</option>
            {overflow.map((item) => (
              <option key={item.key} value={item.key}>
                {item.label}
              </option>
            ))}
          </select>
          {activeOverflow ? (
            <span className="absolute inset-x-0 -bottom-px h-0.5 bg-[var(--text-primary)]" />
          ) : null}
        </label>
      ) : null}
    </nav>
  );
}
