"use client";

type DailyPeak = {
  day: string;
  hour: number;
  count: number;
};

type TimeOfDayChartProps = {
  hourlyCounts: number[];
  dailyPeaks: DailyPeak[];
};

function hourLabel(hour: number) {
  const suffix = hour >= 12 ? "PM" : "AM";
  const normalized = hour % 12 === 0 ? 12 : hour % 12;
  return `${normalized}${suffix}`;
}

export function TimeOfDayChart({ hourlyCounts, dailyPeaks }: TimeOfDayChartProps) {
  const safeHourly = hourlyCounts.length === 24 ? hourlyCounts : Array.from({ length: 24 }, (_, i) => hourlyCounts[i] ?? 0);
  const max = Math.max(...safeHourly, 1);
  const recentPeaks = [...dailyPeaks].slice(-7).reverse();

  return (
    <div className="p-5">
      <p className="mb-4 text-xs uppercase tracking-wide text-[var(--text-secondary)]">
        Prompt activity by hour (UTC)
      </p>

      {/* Heatmap strip — 24 cells in a grid */}
      <div className="mb-1 grid grid-cols-24 gap-0.5">
        {safeHourly.map((count, hour) => {
          const opacity = count === 0 ? 0.05 : Math.max(0.12, (count / max) * 0.88);
          return (
            <div
              key={hour}
              title={`${hourLabel(hour)}: ${count} prompts`}
              className="group relative aspect-square rounded-sm"
              style={{ background: `color-mix(in oklab, var(--accent-cyan) ${Math.round(opacity * 100)}%, transparent)` }}
            >
              <span className="pointer-events-none absolute -top-7 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded bg-[var(--bg-elevated)] px-1.5 py-0.5 text-[10px] text-[var(--text-primary)] opacity-0 shadow-[var(--shadow-card)] transition group-hover:opacity-100 border border-[var(--border-default)]">
                {hourLabel(hour)}: {count}
              </span>
            </div>
          );
        })}
      </div>

      {/* Hour labels */}
      <div className="mb-5 grid grid-cols-24 gap-0.5">
        {Array.from({ length: 24 }, (_, hour) => (
          <div key={hour} className="text-center">
            {hour % 6 === 0 ? (
              <span className="text-[9px] text-[var(--text-secondary)]">{hour}</span>
            ) : null}
          </div>
        ))}
      </div>

      <div>
        <p className="mb-2 text-[10px] uppercase tracking-wide text-[var(--text-secondary)]">Daily peak windows</p>
        <div className="divide-y divide-[var(--border-default)]">
          {recentPeaks.length === 0 ? (
            <p className="text-xs text-[var(--text-secondary)]">Not enough activity yet.</p>
          ) : (
            recentPeaks.map((item) => (
              <div key={item.day} className="flex items-center justify-between py-1.5 text-xs">
                <span className="text-[var(--text-secondary)]">{item.day}</span>
                <span className="font-medium text-[var(--text-primary)]">{hourLabel(item.hour)} · {item.count} msgs</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
