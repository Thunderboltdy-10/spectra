"use client";

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
  const max = Math.max(...data.map((d) => d.count), 1);
  const total = data.reduce((sum, day) => sum + day.count, 0);
  const activeDays = data.filter((day) => day.count > 0).length;

  return (
    <div className="journal-card journal-scribble p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-xs uppercase tracking-wide text-[var(--text-secondary)]">
          {label ?? "Daily activity"}
        </p>
        <p className="text-xs text-[var(--text-secondary)]">
          {total} messages • {activeDays}/{data.length} active days
        </p>
      </div>

      <div className="grid grid-cols-14 gap-1.5">
        {data.map((d, index) => {
          const height = Math.max(10, Math.round((d.count / max) * 84));
          return (
            <div key={d.day} className="group flex min-w-0 flex-col items-center gap-1">
              <div className="relative flex h-24 w-full items-end">
                <div
                  className="w-full rounded-md bg-[var(--accent)]/90 transition-all duration-200 group-hover:bg-[var(--accent)]"
                  style={{ height }}
                />
                <div className="pointer-events-none absolute -top-6 left-1/2 -translate-x-1/2 rounded bg-[var(--bg-tertiary)] px-1.5 py-0.5 text-[10px] opacity-0 transition group-hover:opacity-100">
                  {d.count}
                </div>
              </div>
              <span className="text-[9px] text-[var(--text-secondary)]">
                {index % 2 === 0 ? shortDayLabel(d.day) : " "}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
