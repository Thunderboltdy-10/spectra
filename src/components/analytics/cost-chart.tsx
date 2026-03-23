"use client";

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

type CostPoint = {
  day: string;
  free: number;
  cheap: number;
  mid: number;
  premium: number;
  total: number;
};

function shortDayLabel(value: string) {
  const date = new Date(`${value}T00:00:00Z`);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function toUsd(cents: number) {
  return (Math.max(0, cents) / 100).toFixed(2);
}

export function CostChart({ data }: { data: CostPoint[] }) {
  if (!data.length) {
    return (
      <div className="flex h-[220px] items-center justify-center text-sm text-[var(--text-secondary)]">
        No spend data in this range.
      </div>
    );
  }

  return (
    <div className="p-5">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs text-[var(--text-secondary)]">Daily cost by model tier</p>
        <p className="text-xs text-[var(--text-secondary)]">
          ${toUsd(data.reduce((sum, row) => sum + row.total, 0))} total
        </p>
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={data.map((item) => ({ ...item, dayLabel: shortDayLabel(item.day) }))}>
          <CartesianGrid vertical={false} stroke="var(--border-default)" strokeOpacity={0.4} />
          <XAxis dataKey="dayLabel" tick={{ fontSize: 10, fill: "var(--text-secondary)" }} tickLine={false} axisLine={false} />
          <YAxis
            tick={{ fontSize: 10, fill: "var(--text-secondary)" }}
            tickLine={false}
            axisLine={false}
            width={44}
            tickFormatter={(value) => `$${toUsd(Number(value) || 0)}`}
          />
          <Tooltip
            contentStyle={{
              background: "var(--bg-elevated)",
              border: "1px solid var(--border-default)",
              borderRadius: 8,
              fontSize: 12,
              color: "var(--text-primary)",
            }}
            formatter={(value: unknown, name: string) => {
              const numeric = Number(value ?? 0);
              return [`$${toUsd(numeric)}`, name];
            }}
          />
          <Area type="monotone" dataKey="premium" stackId="tier" stroke="#ef4444" fill="#ef4444" fillOpacity={0.65} />
          <Area type="monotone" dataKey="mid" stackId="tier" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.55} />
          <Area type="monotone" dataKey="cheap" stackId="tier" stroke="#06b6d4" fill="#06b6d4" fillOpacity={0.5} />
          <Area type="monotone" dataKey="free" stackId="tier" stroke="#22c55e" fill="#22c55e" fillOpacity={0.45} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
