"use client";

import { useState } from "react";
import type { UsageSeriesPoint } from "./api";
import { formatBytes, formatCompact } from "./shared";

/* The usage meters in the words a school uses, shared by school admin and the
   platform pages so both read "AI reading", never "model_input_tokens". */

export const USAGE_METERS = [
  { key: "model_input_tokens", label: "AI reading", unit: "tokens", detail: "Text the AI read to answer" },
  { key: "model_output_tokens", label: "AI writing", unit: "tokens", detail: "Text the AI wrote back" },
  { key: "storage_bytes", label: "Files stored", unit: "bytes", detail: "Everything kept in Spectra" },
  { key: "bandwidth_bytes", label: "Downloads", unit: "bytes", detail: "Files opened and shared" },
  { key: "collaboration_bytes", label: "Live editing", unit: "bytes", detail: "Changes sent while people edit together" },
  { key: "render_milliseconds", label: "Rendering", unit: "time", detail: "Time spent drawing previews and exports" },
] as const;

export type UsageMeter = (typeof USAGE_METERS)[number];

export function formatMeter(value: number | null | undefined, unit: UsageMeter["unit"]) {
  if (unit === "bytes") return formatBytes(value);
  if (unit === "time") {
    if (value === null || value === undefined) return formatCompact(value);
    if (value < 60_000) return `${Math.round(value / 1000)} s`;
    return `${formatCompact(Math.round(value / 60_000))} min`;
  }
  return formatCompact(value);
}

/** "storage_bytes" → "Files stored"; an unknown meter keeps its own words. */
export function meterLabel(key: string) {
  return USAGE_METERS.find((item) => item.key === key)?.label ?? key.replaceAll("_", " ").replace(/^\w/, (letter) => letter.toUpperCase());
}

const chartDay = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", timeZone: "UTC" });

function dayLabel(day: string) {
  return chartDay.format(new Date(`${day}T00:00:00Z`));
}

/** The server only sends days something was counted; a quiet day still gets its (empty) bar. */
function everyDay(series: UsageSeriesPoint[], through?: string) {
  if (!series.length) return series;
  const byDay = new Map(series.map((point) => [point.day, point]));
  const last = through && through > series[series.length - 1].day ? through : series[series.length - 1].day;
  const days: UsageSeriesPoint[] = [];
  for (let at = Date.parse(`${series[0].day}T00:00:00Z`); at <= Date.parse(`${last}T00:00:00Z`); at += 86_400_000) {
    const day = new Date(at).toISOString().slice(0, 10);
    days.push(byDay.get(day) ?? { day, values: {} });
  }
  return days;
}

/** The seven people who used most get a colour each; everyone else shares a grey. */
const PERSON_SLOTS = 7;
const OTHERS = "others";

type Person = { id: string; name: string; slot: number };
type Segment = { id: string; name: string; slot: number | null; value: number };

/*
 * Who gets which colour is decided once across every meter (each person's
 * share of each meter, summed), so switching meters never repaints anyone.
 */
function rankPeople(series: UsageSeriesPoint[], names: Record<string, string>): Person[] {
  const totals: Record<string, Record<string, number>> = {};
  for (const point of series)
    for (const [meter, byPerson] of Object.entries(point.parts ?? {}))
      for (const [id, value] of Object.entries(byPerson)) {
        const row = (totals[meter] ??= {});
        row[id] = (row[id] ?? 0) + value;
      }
  const weight: Record<string, number> = {};
  for (const byPerson of Object.values(totals)) {
    const sum = Object.values(byPerson).reduce((a, b) => a + b, 0) || 1;
    for (const [id, value] of Object.entries(byPerson)) weight[id] = (weight[id] ?? 0) + value / sum;
  }
  // What no single account used ("school") always folds into everyone else.
  return Object.keys(weight)
    .filter((id) => id !== "school")
    .sort((a, b) => weight[b]! - weight[a]! || a.localeCompare(b))
    .slice(0, PERSON_SLOTS)
    .map((id, slot) => ({ id, name: names[id] ?? "Former member", slot }));
}

/** One meter at a time, a bar a day, every bar readable by keyboard. Given `people`, each bar is split by who used it. */
export function UsageDayChart({
  series: counted,
  through,
  people: names,
}: {
  series: UsageSeriesPoint[];
  through?: string;
  people?: Record<string, string>;
}) {
  const series = everyDay(counted, through);
  const [meter, setMeter] = useState<UsageMeter["key"]>("model_input_tokens");
  const [pointed, setPointed] = useState<number | null>(null);
  const chosen = USAGE_METERS.find((item) => item.key === meter) ?? USAGE_METERS[0];
  const values = series.map((point) => point.values[meter] ?? 0);
  const peak = Math.max(0, ...values);
  const split = Boolean(names) && counted.some((point) => point.parts && Object.keys(point.parts).length > 0);
  const coloured = split ? rankPeople(counted, names ?? {}) : [];
  const slotOf = new Map(coloured.map((person) => [person.id, person.slot]));
  const restOf = (byPerson: Record<string, number>) =>
    Object.entries(byPerson)
      .filter(([id]) => !slotOf.has(id))
      .reduce((sum, [, value]) => sum + value, 0);
  // One day's segments, bottom up: the coloured people in slot order, then everyone else.
  const segments = (point: UsageSeriesPoint): Segment[] => {
    const byPerson = point.parts?.[meter] ?? {};
    return [
      ...coloured.map((person) => ({ ...person, value: byPerson[person.id] ?? 0 })),
      { id: OTHERS, name: "Everyone else", slot: null, value: restOf(byPerson) },
    ].filter((segment) => segment.value > 0);
  };
  const legend: Segment[] = split
    ? [
        ...coloured.map((person) => ({
          ...person,
          value: counted.reduce((sum, point) => sum + (point.parts?.[meter]?.[person.id] ?? 0), 0),
        })),
        { id: OTHERS, name: "Everyone else", slot: null, value: counted.reduce((sum, point) => sum + restOf(point.parts?.[meter] ?? {}), 0) },
      ].filter((entry) => entry.id !== OTHERS || entry.value > 0)
    : [];
  const tip = split && pointed !== null ? series[pointed] : null;
  return (
    <>
      <div className="admin-chart-choice" role="group" aria-label="What the chart shows">
        {USAGE_METERS.map((item) => (
          <button key={item.key} type="button" aria-pressed={item.key === meter} onClick={() => setMeter(item.key)}>
            {item.label}
          </button>
        ))}
      </div>
      {series.length ? (
        <figure className="admin-chart" aria-label={`${chosen.label} each day${split ? ", by person" : ""}`}>
          <div className="admin-chart-scale" aria-hidden>
            <span>{formatMeter(peak, chosen.unit)}</span>
            <span>{formatMeter(peak / 2, chosen.unit)}</span>
            <span>0</span>
          </div>
          <div className="admin-chart-bars" onPointerLeave={() => setPointed(null)}>
            {series.map((point, index) => {
              const height = peak ? `${Math.max(values[index] ? 1.5 : 0, (values[index] / peak) * 100)}%` : "0%";
              const total = `${dayLabel(point.day)}: ${formatMeter(values[index], chosen.unit)}`;
              if (!split)
                return (
                  <span key={point.day} className="admin-chart-bar" tabIndex={0} role="img" aria-label={total} title={total} style={{ height }} />
                );
              const parts = segments(point);
              const label = parts.length ? `${total}. ${parts.map((part) => `${part.name} ${formatMeter(part.value, chosen.unit)}`).join(", ")}` : total;
              return (
                <span
                  key={point.day}
                  className="admin-chart-stack"
                  tabIndex={0}
                  role="img"
                  aria-label={label}
                  data-pointed={pointed === index ? "" : undefined}
                  style={{ height }}
                  onPointerEnter={() => setPointed(index)}
                  onFocus={() => setPointed(index)}
                  onBlur={() => setPointed(null)}
                >
                  {parts.map((part) => (
                    <span key={part.id} data-slot={part.slot ?? "rest"} style={{ flexGrow: part.value }} />
                  ))}
                </span>
              );
            })}
            {tip ? (
              <div
                className="admin-chart-tip"
                aria-hidden
                data-side={pointed! >= series.length / 2 ? "left" : "right"}
                style={{ left: `${((pointed! + 0.5) / series.length) * 100}%` }}
              >
                <p>
                  <span>{dayLabel(tip.day)}</span>
                  <strong>{formatMeter(tip.values[meter] ?? 0, chosen.unit)}</strong>
                </p>
                {segments(tip).length ? (
                  <ul>
                    {segments(tip)
                      .sort((a, b) => b.value - a.value)
                      .map((part) => (
                        <li key={part.id}>
                          <i data-slot={part.slot ?? "rest"} />
                          <span>{part.name}</span>
                          <span>{formatMeter(part.value, chosen.unit)}</span>
                        </li>
                      ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
          </div>
          <div className="admin-chart-days" aria-hidden>
            <span>{dayLabel(series[0].day)}</span>
            <span>{dayLabel(series[Math.floor(series.length / 2)].day)}</span>
            <span>{dayLabel(series[series.length - 1].day)}</span>
          </div>
          {legend.length ? (
            <figcaption className="admin-chart-legend">
              <ul aria-label={`${chosen.label} by person over these days`}>
                {legend.map((entry) => (
                  <li key={entry.id}>
                    <i data-slot={entry.slot ?? "rest"} aria-hidden />
                    <span>{entry.name}</span>
                    <span>{formatMeter(entry.value, chosen.unit)}</span>
                  </li>
                ))}
              </ul>
            </figcaption>
          ) : null}
        </figure>
      ) : (
        <p className="admin-ledger-empty">The first full day is still being counted.</p>
      )}
    </>
  );
}
