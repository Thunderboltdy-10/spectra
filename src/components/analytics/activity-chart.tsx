"use client";

import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

type DayData = {
  day: string;
  count: number;
};

type ActivityChartProps = {
  data: DayData[];
  label?: string;
};

function shortDayLabel(value: string) {
  const date = new Date(`${value}T00:00:00Z`);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function ActivityChart({ data, label }: ActivityChartProps) {
  const total = data.reduce((sum, day) => sum + day.count, 0);
  const activeDays = data.filter((day) => day.count > 0).length;

  const chartData = data.map((d) => ({
    name: shortDayLabel(d.day),
    count: d.count,
  }));

  return (
    <div className="p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-xs text-[var(--text-secondary)]">
          {label ?? "Daily activity"}
        </p>
        <p className="text-xs text-[var(--text-secondary)]">
          {total} msgs · {activeDays}/{data.length} active
        </p>
      </div>

      <ResponsiveContainer width="100%" height={112}>
        <AreaChart data={chartData} margin={{ top: 4, right: 0, left: -32, bottom: 0 }}>
          <defs>
            <linearGradient id="activityFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent-cyan)" stopOpacity={0.22} />
              <stop offset="100%" stopColor="var(--accent-cyan)" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="name"
            tick={{ fontSize: 9, fill: "var(--text-secondary)" }}
            tickLine={false}
            axisLine={false}
            interval={2}
          />
          <YAxis hide />
          <Tooltip
            contentStyle={{
              background: "var(--bg-elevated)",
              border: "1px solid var(--border-default)",
              borderRadius: 8,
              fontSize: 12,
              color: "var(--text-primary)",
            }}
            itemStyle={{ color: "var(--accent-cyan)" }}
            formatter={(value: number) => [value, "messages"]}
            labelStyle={{ color: "var(--text-secondary)", marginBottom: 2 }}
          />
          <Area
            type="monotone"
            dataKey="count"
            stroke="var(--accent-cyan)"
            strokeWidth={1.5}
            fill="url(#activityFill)"
            dot={{ r: 2, fill: "var(--accent-cyan)", strokeWidth: 0 }}
            activeDot={{ r: 4, fill: "var(--accent-cyan)", strokeWidth: 0 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
