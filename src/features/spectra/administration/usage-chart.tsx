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

/** One meter at a time, a bar a day, every bar readable by keyboard. */
export function UsageDayChart({ series: counted, through }: { series: UsageSeriesPoint[]; through?: string }) {
  const series = everyDay(counted, through);
  const [meter, setMeter] = useState<UsageMeter["key"]>("model_input_tokens");
  const chosen = USAGE_METERS.find((item) => item.key === meter) ?? USAGE_METERS[0];
  const values = series.map((point) => point.values[meter] ?? 0);
  const peak = Math.max(0, ...values);
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
        <figure className="admin-chart" aria-label={`${chosen.label} each day`}>
          <div className="admin-chart-scale" aria-hidden>
            <span>{formatMeter(peak, chosen.unit)}</span>
            <span>{formatMeter(peak / 2, chosen.unit)}</span>
            <span>0</span>
          </div>
          <div className="admin-chart-bars">
            {series.map((point, index) => {
              const label = `${dayLabel(point.day)}: ${formatMeter(values[index], chosen.unit)}`;
              return (
                <span
                  key={point.day}
                  className="admin-chart-bar"
                  tabIndex={0}
                  role="img"
                  aria-label={label}
                  title={label}
                  style={{ height: peak ? `${Math.max(values[index] ? 1.5 : 0, (values[index] / peak) * 100)}%` : "0%" }}
                />
              );
            })}
          </div>
          <div className="admin-chart-days" aria-hidden>
            <span>{dayLabel(series[0].day)}</span>
            <span>{dayLabel(series[Math.floor(series.length / 2)].day)}</span>
            <span>{dayLabel(series[series.length - 1].day)}</span>
          </div>
        </figure>
      ) : (
        <p className="admin-ledger-empty">The first full day is still being counted.</p>
      )}
    </>
  );
}
