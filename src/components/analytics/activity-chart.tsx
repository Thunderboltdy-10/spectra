"use client";

type DayData = {
  day: string;
  count: number;
};

type ActivityChartProps = {
  data: DayData[];
  label?: string;
};

export function ActivityChart({ data, label }: ActivityChartProps) {
  const max = Math.max(...data.map((d) => d.count), 1);

  return (
    <div className="rounded-[var(--radius-container)] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4 shadow-[var(--shadow-card)]">
      {label && (
        <p className="mb-3 text-xs uppercase tracking-wide text-[var(--text-secondary)]">{label}</p>
      )}
      <div className="flex items-end gap-1" style={{ height: 120 }}>
        {data.map((d) => {
          const height = Math.max((d.count / max) * 100, 4);
          const shortDay = d.day.slice(5);
          return (
            <div key={d.day} className="group flex flex-1 flex-col items-center gap-1">
              <div className="relative w-full">
                <div
                  className="mx-auto w-full max-w-[24px] rounded-t-md bg-[var(--accent)] transition-all group-hover:opacity-80"
                  style={{ height: `${height}px` }}
                />
                <div className="pointer-events-none absolute -top-6 left-1/2 -translate-x-1/2 rounded bg-[var(--bg-tertiary)] px-1.5 py-0.5 text-[10px] opacity-0 transition group-hover:opacity-100">
                  {d.count}
                </div>
              </div>
              <span className="text-[9px] text-[var(--text-secondary)]">{shortDay}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
