"use client";

import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { OverflowMenu } from "@/components/ui/dropdown-menu";

/**
 * Shared horizontal section navigation, derived from Library's calm tab rail.
 *
 * Used by School, Admin, Superadmin, ManageBac and Settings, so its overflow
 * behaviour is the product's section-nav behaviour. Three rules hold it to the
 * brief:
 *
 * 1. The overflow is a real three-dot menu that overlays. It portals to the
 *    body, so opening it cannot change the rail's height, add `overflow-y`, push
 *    a tab onto a second row, or make the surface jump. It is never a native
 *    `<select>` layered under an icon.
 * 2. Labels are prioritised, never deleted. Under pressure the rail sheds the
 *    lowest-priority *tabs* into the overflow and keeps every surviving tab's
 *    label, so nothing degrades into an unnamed icon.
 * 3. The rail does not clip. `overflow-hidden` used to hide tabs that had no
 *    other way to be reached.
 */
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
  // The active section is always reachable in one click: if it would fall into
  // the overflow, it trades places with the last primary tab.
  const ordered = [...items];
  const activeIndex = ordered.findIndex((item) => item.key === active);
  if (activeIndex >= primaryCount && primaryCount > 0) {
    const [activeItem] = ordered.splice(activeIndex, 1);
    ordered.splice(primaryCount - 1, 0, activeItem);
  }

  const primary = ordered.slice(0, primaryCount);
  const overflow = ordered.slice(primaryCount);

  return (
    <nav
      aria-label={label}
      className={cn(
        "mb-5 flex min-w-0 items-end gap-4 border-b border-[var(--border-default)] sm:gap-6",
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
            className={cn(
              "relative flex h-10 min-w-0 shrink items-center gap-2 px-0.5 text-caption font-medium transition-colors",
              selected
                ? "text-[var(--text-primary)]"
                : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]",
            )}
          >
            <Icon aria-hidden="true" className="size-3.5 shrink-0" />
            <span className="truncate">{item.label}</span>
            {selected ? (
              <span className="absolute inset-x-0 -bottom-px h-0.5 bg-[var(--text-primary)]" />
            ) : null}
          </button>
        );
      })}
      {overflow.length ? (
        <span className="relative ml-auto shrink-0">
          <OverflowMenu
            label={`More ${label}`}
            items={overflow}
            onSelect={onChange}
          />
        </span>
      ) : null}
    </nav>
  );
}
