"use client";

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { MODE_REGISTRY } from "@/lib/modes";
import type { StudyMode } from "@/types";

type ModeBreakdownProps = {
  modeCounts: Record<string, number>;
};

export function ModeBreakdown({ modeCounts }: ModeBreakdownProps) {
  const entries = Object.entries(modeCounts)
    .filter(([, count]) => count > 0)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 6);

  if (entries.length === 0) {
    return (
      <div className="p-4 text-center text-sm text-[var(--text-secondary)]">
        No mode usage data yet
      </div>
    );
  }

  const chartData = entries.map(([mode, count]) => {
    const config = MODE_REGISTRY[mode as StudyMode];
    return {
      name: config?.label ?? mode,
      count,
      color: config?.color ?? "var(--accent-cyan)",
    };
  });

  return (
    <div className="p-4">
      <p className="mb-4 text-xs text-[var(--text-secondary)]">Mode usage</p>

      <ResponsiveContainer width="100%" height={160}>
        <BarChart
          data={chartData}
          layout="vertical"
          margin={{ top: 0, right: 8, left: 0, bottom: 0 }}
        >
          <XAxis type="number" hide />
          <YAxis
            type="category"
            dataKey="name"
            width={80}
            tick={{ fontSize: 11, fill: "var(--text-secondary)" }}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip
            contentStyle={{
              background: "var(--bg-elevated)",
              border: "1px solid var(--border-default)",
              borderRadius: 8,
              fontSize: 12,
              color: "var(--text-primary)",
            }}
            formatter={(value: number) => [value, "messages"]}
            cursor={{ fill: "var(--bg-hover)" }}
          />
          <Bar dataKey="count" radius={[0, 4, 4, 0]}>
            {chartData.map((entry, index) => (
              <Cell key={index} fill={entry.color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
