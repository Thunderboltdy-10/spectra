"use client";

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Clock } from "@/components/icons/glyph-icons";
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { addDays, formatTimeOfDay, monthWeeks, parseTimeOfDay, sameMonth, todayKey, type DayKey } from "./when";

/*
 * Choosing a day and a time of day, the same way everywhere a student sets
 * when something happens. A day is picked on a month laid out in weeks; a time
 * is typed the way people say it ("9", "930", "9.30pm") or picked from the
 * quarter hours, which open at the one chosen. Both read and write plain
 * "YYYY-MM-DD" and "HH:MM" strings, so the zone they mean stays the caller's.
 */

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7].map((day) =>
  new Intl.DateTimeFormat(undefined, { weekday: "narrow", timeZone: "UTC" }).format(new Date(Date.UTC(2024, 0, day))),
);

function dayLabel(day: DayKey, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat(undefined, { ...options, timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`));
}

export function DayField({
  value,
  onChange,
  min,
  label,
  placeholder = "Pick a day",
  className,
}: {
  value: DayKey | "";
  onChange: (day: DayKey) => void;
  /** The first day that can be picked. */
  min?: DayKey;
  /** What the field is called, for assistive technology. */
  label: string;
  placeholder?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const today = todayKey();
  const [month, setMonth] = useState<DayKey>(value || today);
  const [focused, setFocused] = useState<DayKey>(value || today);
  const grid = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setMonth(value || today);
    setFocused(value || today);
  }, [open, value, today]);

  useEffect(() => {
    if (open) grid.current?.querySelector<HTMLButtonElement>(`[data-day="${focused}"]`)?.focus();
  }, [open, focused, month]);

  const move = (to: DayKey) => {
    setFocused(to);
    if (!sameMonth(to, month)) setMonth(to);
  };
  const pick = (day: DayKey) => {
    if (min && day < min) return;
    onChange(day);
    setOpen(false);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7, PageUp: -28, PageDown: 28 }[event.key];
    if (step === undefined) return;
    event.preventDefault();
    move(addDays(focused, step));
  };
  const shift = (months: number) => {
    const [year, monthIndex] = month.split("-").map(Number);
    const next = new Date(Date.UTC(year!, monthIndex! - 1 + months, 1)).toISOString().slice(0, 10);
    setMonth(next);
    setFocused(next);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" aria-label={`${label}: ${value ? dayLabel(value, { dateStyle: "full" }) : "none"}`} className={cn("when-field", className)} data-empty={!value || undefined}>
          <CalendarDays className="size-3.5" aria-hidden />
          <span>{value ? dayLabel(value, { weekday: "short", day: "numeric", month: "short", year: value.slice(0, 4) === today.slice(0, 4) ? undefined : "numeric" }) : placeholder}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="when-month" onOpenAutoFocus={(event) => event.preventDefault()}>
        <div className="when-month-head">
          <strong>{dayLabel(month, { month: "long", year: "numeric" })}</strong>
          <button type="button" aria-label="Previous month" onClick={() => shift(-1)}>
            <ChevronLeft className="size-4" aria-hidden />
          </button>
          <button type="button" aria-label="Next month" onClick={() => shift(1)}>
            <ChevronRight className="size-4" aria-hidden />
          </button>
        </div>
        <div ref={grid} role="grid" aria-label={dayLabel(month, { month: "long", year: "numeric" })} className="when-month-grid" onKeyDown={onKeyDown}>
          <div role="row" className="when-month-week">
            {WEEKDAYS.map((weekday, index) => (
              <span key={index} role="columnheader" className="when-month-weekday">
                {weekday}
              </span>
            ))}
          </div>
          {monthWeeks(month).map((week) => (
            <div key={week[0]} role="row" className="when-month-week">
              {week.map((day) => (
                <button
                  key={day}
                  type="button"
                  role="gridcell"
                  data-day={day}
                  tabIndex={day === focused ? 0 : -1}
                  disabled={Boolean(min && day < min)}
                  aria-selected={day === value}
                  aria-current={day === today ? "date" : undefined}
                  aria-label={dayLabel(day, { dateStyle: "full" })}
                  data-outside={!sameMonth(day, month) || undefined}
                  onClick={() => pick(day)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      pick(day);
                    }
                  }}
                >
                  {Number(day.slice(8))}
                </button>
              ))}
            </div>
          ))}
        </div>
        <button type="button" className="when-month-today" onClick={() => pick(today)} disabled={Boolean(min && today < min)}>
          Today
        </button>
      </PopoverContent>
    </Popover>
  );
}

const QUARTERS = Array.from({ length: 96 }, (_, index) => `${String(Math.floor(index / 4)).padStart(2, "0")}:${String((index % 4) * 15).padStart(2, "0")}`);

function minutesOf(time: string) {
  const [hour, minute] = time.split(":").map(Number);
  return hour! * 60 + minute!;
}

function lengthFrom(from: string, to: string) {
  const minutes = (minutesOf(to) - minutesOf(from) + 24 * 60) % (24 * 60);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours ? (rest ? `${hours} h ${rest}` : `${hours} h`) : `${rest} min`;
}

export function TimeField({
  value,
  onChange,
  label,
  placeholder = "Add a time",
  from,
  opensAt = "08:00",
  className,
}: {
  value: string;
  /** An empty string clears the time. */
  onChange: (time: string) => void;
  label: string;
  placeholder?: string;
  /** A start this time ends after: the list starts there and says how long each would be. */
  from?: string;
  /** Where the list opens when no time is chosen yet. */
  opensAt?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const listId = useId();
  const slots = useMemo(() => {
    if (!from) return QUARTERS;
    const start = QUARTERS.findIndex((slot) => slot > from);
    return start < 0 ? QUARTERS : [...QUARTERS.slice(start), ...QUARTERS.slice(0, start)];
  }, [from]);

  const showing = draft ?? (value ? formatTimeOfDay(value) : "");
  const commit = (time: string | null) => {
    setDraft(null);
    setActive(null);
    setOpen(false);
    if (time !== null && time !== value) onChange(time);
  };
  const near = (time: string) => slots.reduce((best, slot) => (Math.abs(minutesOf(slot) - minutesOf(time)) < Math.abs(minutesOf(best) - minutesOf(time)) ? slot : best), slots[0]!);

  // A start moving this end changes it just after focus lands here: keep it selected, or typing is appended and lost.
  useLayoutEffect(() => {
    if (draft === null && document.activeElement === input.current) input.current?.select();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  useEffect(() => {
    if (!open) return;
    const target = active ?? (value ? near(value) : from ? slots[0] : opensAt);
    list.current?.querySelector<HTMLElement>(`[data-time="${target}"]`)?.scrollIntoView({ block: active ? "nearest" : "start" });
    // Only where the list stands when it opens or the active slot moves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, active]);

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      const at = slots.indexOf(active ?? (value ? near(value) : slots[0]!));
      setActive(slots[(at + (event.key === "ArrowDown" ? 1 : -1) + slots.length) % slots.length]!);
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (active) commit(active);
      else if (draft !== null) commit(draft.trim() ? parseTimeOfDay(draft) : "");
      else setOpen(false);
    } else if (event.key === "Escape" && open) {
      event.preventDefault();
      event.stopPropagation();
      setDraft(null);
      setActive(null);
      setOpen(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <span className={cn("when-field when-field--time", className)} data-empty={!value || undefined}>
          <Clock className="size-3.5" aria-hidden />
          <input
            ref={input}
            role="combobox"
            aria-label={label}
            aria-expanded={open}
            aria-controls={listId}
            aria-activedescendant={active ? `${listId}-${active}` : undefined}
            autoComplete="off"
            value={showing}
            placeholder={placeholder}
            onFocus={() => setOpen(true)}
            onClick={(event) => { setOpen(true); if (draft === null) event.currentTarget.select(); }}
            onChange={(event) => {
              setDraft(event.target.value);
              setActive(null);
              const parsed = parseTimeOfDay(event.target.value);
              if (parsed) list.current?.querySelector<HTMLElement>(`[data-time="${near(parsed)}"]`)?.scrollIntoView({ block: "nearest" });
            }}
            onBlur={() => {
              if (draft !== null) commit(draft.trim() ? parseTimeOfDay(draft) : "");
            }}
            onKeyDown={onKeyDown}
          />
        </span>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        className="when-times"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
        onInteractOutside={(event) => {
          if (input.current?.contains(event.target as Node)) event.preventDefault();
        }}
      >
        <ul ref={list} id={listId} role="listbox" aria-label={label}>
          {slots.map((slot) => (
            <li
              key={slot}
              id={`${listId}-${slot}`}
              role="option"
              data-time={slot}
              aria-selected={slot === value}
              data-active={slot === active || undefined}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => commit(slot)}
            >
              {formatTimeOfDay(slot)}
              {from ? <span>{lengthFrom(from, slot)}</span> : null}
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
