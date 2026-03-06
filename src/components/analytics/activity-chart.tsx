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

  const W = 100;
  const H = 60;
  const n = data.length;

  // Build SVG path points
  const pts = data.map((d, i) => ({
    x: n === 1 ? W / 2 : (i / (n - 1)) * W,
    y: H - Math.max(2, (d.count / max) * (H - 4)),
    count: d.count,
    day: d.day,
  }));

  // Smooth bezier path
  function bezierPath(points: { x: number; y: number }[]) {
    if (points.length < 2) return "";
    let d = `M ${points[0].x} ${points[0].y}`;
    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1];
      const curr = points[i];
      const cx = (prev.x + curr.x) / 2;
      d += ` C ${cx} ${prev.y}, ${cx} ${curr.y}, ${curr.x} ${curr.y}`;
    }
    return d;
  }

  const linePath = bezierPath(pts);
  const areaPath = `${linePath} L ${pts[pts.length - 1].x} ${H} L ${pts[0].x} ${H} Z`;

  return (
    <div className="p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-xs uppercase tracking-wide text-[var(--text-secondary)]">
          {label ?? "Daily activity"}
        </p>
        <p className="text-xs text-[var(--text-secondary)]">
          {total} msgs · {activeDays}/{data.length} active
        </p>
      </div>

      <div className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h-28 w-full overflow-visible"
          preserveAspectRatio="none"
          aria-label={label ?? "Daily activity chart"}
        >
          <defs>
            <linearGradient id="area-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent-cyan)" stopOpacity="0.22" />
              <stop offset="100%" stopColor="var(--accent-cyan)" stopOpacity="0.02" />
            </linearGradient>
          </defs>

          {/* Horizontal grid lines */}
          {[0.25, 0.5, 0.75].map((t) => (
            <line
              key={t}
              x1="0" y1={H * (1 - t)} x2={W} y2={H * (1 - t)}
              stroke="var(--border-default)" strokeWidth="0.5" strokeDasharray="2 2"
            />
          ))}

          {/* Area fill */}
          <path d={areaPath} fill="url(#area-fill)" />

          {/* Line */}
          <path d={linePath} fill="none" stroke="var(--accent-cyan)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />

          {/* Dots */}
          {pts.map((pt) => (
            <g key={pt.day} className="group/dot">
              <circle cx={pt.x} cy={pt.y} r="2" fill="var(--accent-cyan)" />
              {pt.count > 0 && (
                <circle cx={pt.x} cy={pt.y} r="3.5" fill="var(--accent-cyan)" fillOpacity="0" className="group-hover/dot:fill-opacity-20 transition-all" />
              )}
            </g>
          ))}
        </svg>

        {/* X-axis labels */}
        <div className="mt-1 flex justify-between px-0">
          {data.map((d, index) => (
            <span key={d.day} className="text-[9px] text-[var(--text-secondary)]" style={{ width: `${100 / n}%`, textAlign: "center" }}>
              {index % 3 === 0 ? shortDayLabel(d.day) : ""}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
