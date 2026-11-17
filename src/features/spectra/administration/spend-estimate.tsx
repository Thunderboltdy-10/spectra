"use client";

import { useEffect, useState } from "react";
import { AdminButton, AdminSectionHeader, formatBytes, MetricCard, TallySheet, TextField } from "./shared";

/*
 * What the platform's usage costs in money, for the platform team only: a
 * school admin sees the same meters with no prices. Nothing on the server
 * knows the provider's prices, so they are rates the team keeps here (in this
 * browser), starting from list prices, and every figure is an estimate.
 */

export type SpendRates = {
  /** Model provider, US dollars per million tokens. */
  aiInputPerMillion: number;
  aiOutputPerMillion: number;
  /** Convex, US dollars. */
  convexPlanPerMonth: number;
  storagePerGbMonth: number;
  bandwidthPerGb: number;
};

export const DEFAULT_SPEND_RATES: SpendRates = {
  aiInputPerMillion: 1.25,
  aiOutputPerMillion: 10,
  convexPlanPerMonth: 25,
  storagePerGbMonth: 0.03,
  bandwidthPerGb: 0.3,
};

const STORAGE_KEY = "spectra.admin.spendRates.v1";
const GB = 1024 ** 3;

function readRates(): SpendRates {
  try {
    const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null") as Partial<SpendRates> | null;
    if (!saved || typeof saved !== "object") return DEFAULT_SPEND_RATES;
    const rates = { ...DEFAULT_SPEND_RATES };
    for (const key of Object.keys(rates) as Array<keyof SpendRates>) {
      const value = saved[key];
      if (typeof value === "number" && Number.isFinite(value) && value >= 0) rates[key] = value;
    }
    return rates;
  } catch {
    return DEFAULT_SPEND_RATES;
  }
}

/** Spend over a window of `days`, from the window's meters and the files kept now. */
export function estimateSpend(
  rates: SpendRates,
  usage: { inputTokens: number; outputTokens: number; bandwidthBytes: number; storedBytes: number; days: number },
) {
  const ai =
    (Math.max(0, usage.inputTokens) / 1_000_000) * rates.aiInputPerMillion +
    (Math.max(0, usage.outputTokens) / 1_000_000) * rates.aiOutputPerMillion;
  const months = Math.max(0, usage.days) / 30;
  const convex =
    rates.convexPlanPerMonth * months +
    (Math.max(0, usage.storedBytes) / GB) * rates.storagePerGbMonth * months +
    (Math.max(0, usage.bandwidthBytes) / GB) * rates.bandwidthPerGb;
  return { ai, convex, total: ai + convex };
}

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

function dollars(value: number) {
  return value > 0 && value < 0.01 ? "< $0.01" : money.format(value);
}

const RATE_FIELDS: Array<{ key: keyof SpendRates; label: string }> = [
  { key: "aiInputPerMillion", label: "AI reading, $ per million tokens" },
  { key: "aiOutputPerMillion", label: "AI writing, $ per million tokens" },
  { key: "convexPlanPerMonth", label: "Convex plan, $ per month" },
  { key: "storagePerGbMonth", label: "Convex files, $ per GB a month" },
  { key: "bandwidthPerGb", label: "Convex files sent, $ per GB" },
];

export function SpendEstimate({
  totals,
  storedBytes,
  days,
}: {
  totals: Record<string, number>;
  storedBytes: number;
  days: number;
}) {
  const [rates, setRates] = useState<SpendRates>(DEFAULT_SPEND_RATES);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<keyof SpendRates, string> | null>(null);
  useEffect(() => setRates(readRates()), []);

  const spend = estimateSpend(rates, {
    inputTokens: totals.model_input_tokens ?? 0,
    outputTokens: totals.model_output_tokens ?? 0,
    bandwidthBytes: totals.bandwidth_bytes ?? 0,
    storedBytes,
    days,
  });

  const openEditor = () => {
    setDraft(Object.fromEntries(RATE_FIELDS.map(({ key }) => [key, String(rates[key])])) as Record<keyof SpendRates, string>);
    setEditing(true);
  };
  const save = () => {
    if (!draft) return;
    const next = { ...rates };
    for (const { key } of RATE_FIELDS) {
      const value = Number(draft[key]);
      if (Number.isFinite(value) && value >= 0) next[key] = value;
    }
    setRates(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Private windows keep the rates for this visit only.
    }
    setEditing(false);
  };

  return (
    <section>
      <AdminSectionHeader
        title="Estimated spend"
        detail={`What the last ${days} days cost at the rates below. Only the platform team sees money; school admins see the same usage without prices.`}
        action={
          <AdminButton onClick={editing ? () => setEditing(false) : openEditor}>
            {editing ? "Cancel" : "Change rates"}
          </AdminButton>
        }
      />
      <TallySheet>
        <MetricCard label="Total" value={dollars(spend.total)} detail="AI and Convex together" />
        <MetricCard
          label="AI"
          value={dollars(spend.ai)}
          detail={`$${rates.aiInputPerMillion} reading and $${rates.aiOutputPerMillion} writing per million tokens`}
        />
        <MetricCard
          label="Convex"
          value={dollars(spend.convex)}
          detail={`Plan, ${formatBytes(storedBytes)} of files kept and files sent. Database reads and function calls aren't metered, so this is a floor.`}
        />
      </TallySheet>
      {editing && draft ? (
        <form
          className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
          aria-label="Spend rates"
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          {RATE_FIELDS.map(({ key, label }) => (
            <TextField
              key={key}
              label={label}
              type="number"
              value={draft[key]}
              onChange={(value) => setDraft((current) => (current ? { ...current, [key]: value } : current))}
            />
          ))}
          <div className="flex items-end gap-2">
            <AdminButton type="submit" tone="primary">Save rates</AdminButton>
            <AdminButton
              tone="ghost"
              onClick={() =>
                setDraft(Object.fromEntries(RATE_FIELDS.map(({ key }) => [key, String(DEFAULT_SPEND_RATES[key])])) as Record<keyof SpendRates, string>)
              }
            >
              List prices
            </AdminButton>
          </div>
        </form>
      ) : null}
    </section>
  );
}
