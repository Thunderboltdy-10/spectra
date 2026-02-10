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
    <div className="rounded-[var(--radius-container)] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4 shadow-[var(--shadow-card)]">
      <p className="mb-3 text-xs uppercase tracking-wide text-[var(--text-secondary)]">
        Prompt activity by time (UTC)
      </p>

      <div className="mb-4 flex items-end gap-1" style={{ height: 130 }}>
        {safeHourly.map((count, hour) => {
          const height = Math.max((count / max) * 100, 4);
          return (
            <div key={hour} className="group flex min-w-0 flex-1 flex-col items-center gap-1">
              <div className="relative w-full">
                <div
                  className="mx-auto w-full max-w-[16px] rounded-t-md bg-[var(--accent)]"
                  style={{ height: `${height}px` }}
                />
                <div className="pointer-events-none absolute -top-6 left-1/2 -translate-x-1/2 rounded bg-[var(--bg-tertiary)] px-1.5 py-0.5 text-[10px] opacity-0 transition group-hover:opacity-100">
                  {count}
                </div>
              </div>
              {hour % 4 === 0 ? <span className="text-[9px] text-[var(--text-secondary)]">{hourLabel(hour)}</span> : <span className="text-[9px] text-transparent">.</span>}
            </div>
          );
        })}
      </div>

      <div>
        <p className="mb-2 text-xs uppercase tracking-wide text-[var(--text-secondary)]">Daily peak prompt windows</p>
        <div className="space-y-1">
          {recentPeaks.length === 0 ? (
            <p className="text-xs text-[var(--text-secondary)]">Not enough prompt activity yet.</p>
          ) : (
            recentPeaks.map((item) => (
              <div
                key={item.day}
                className="flex items-center justify-between rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] px-2.5 py-1.5 text-xs"
              >
                <span className="text-[var(--text-secondary)]">{item.day}</span>
                <span className="font-medium text-[var(--text-primary)]">
                  {hourLabel(item.hour)} ({item.count})
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
