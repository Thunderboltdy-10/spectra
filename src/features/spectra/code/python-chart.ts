type ChartSeries = { name: string; values: number[]; color: string };

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function numberValues(value: unknown, count: number) {
  if (!Array.isArray(value)) return Array.from({ length: count }, () => 0);
  return Array.from({ length: count }, (_, index) => {
    const number = Number(value[index] ?? 0);
    return Number.isFinite(number) ? number : 0;
  });
}

export function pythonChartToHtml(value: unknown) {
  const row =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const type = row.type === "line" || row.type === "scatter" ? row.type : "bar";
  const labels = Array.isArray(row.labels)
    ? row.labels
        .filter((label): label is string => typeof label === "string")
        .slice(0, 80)
    : [];
  const palette = [
    "#258ed3",
    "#26a77a",
    "#7658ed",
    "#dc7a2b",
    "#d05267",
    "#66766d",
  ];
  const series: ChartSeries[] = Array.isArray(row.series)
    ? row.series.slice(0, 12).flatMap((entry, index) => {
        if (!entry || typeof entry !== "object" || Array.isArray(entry))
          return [];
        const candidate = entry as Record<string, unknown>;
        return [
          {
            name:
              typeof candidate.name === "string"
                ? candidate.name.slice(0, 80)
                : `Series ${index + 1}`,
            values: numberValues(candidate.values, labels.length),
            color:
              typeof candidate.color === "string" &&
              /^#[a-f0-9]{6}$/i.test(candidate.color)
                ? candidate.color
                : palette[index % palette.length]!,
          },
        ];
      })
    : [];
  if (!labels.length || !series.length)
    throw new Error("A chart needs labels and at least one numeric series.");
  const width = 920;
  const height = 520;
  const padding = { left: 66, right: 26, top: 56, bottom: 76 };
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;
  const values = series.flatMap((entry) => entry.values);
  const minimum = Math.min(0, ...values);
  const maximum = Math.max(0, ...values);
  const span = maximum - minimum || 1;
  const y = (point: number) =>
    padding.top + innerHeight - ((point - minimum) / span) * innerHeight;
  const baseline = y(0);
  const slot = innerWidth / labels.length;
  const chartId = `spectra-python-chart-${Math.random().toString(36).slice(2)}`;
  const title =
    typeof row.title === "string" ? row.title.slice(0, 180) : "Generated chart";
  const description =
    typeof row.description === "string"
      ? row.description.slice(0, 500)
      : `${type} chart with ${labels.length} categories and ${series.length} series.`;
  const grid = Array.from({ length: 6 }, (_, index) => {
    const value = minimum + (span * index) / 5;
    const point = y(value);
    return `<line x1="${padding.left}" y1="${point}" x2="${width - padding.right}" y2="${point}" stroke="#dedbd3" stroke-width="1"/><text x="${padding.left - 10}" y="${point + 4}" text-anchor="end" fill="#6f6d66" font-size="12">${escapeHtml(Number(value.toPrecision(4)).toString())}</text>`;
  }).join("");
  const marks =
    type === "bar"
      ? series
          .flatMap((entry, seriesIndex) =>
            entry.values.map((point, index) => {
              const band = slot * 0.76;
              const barWidth = Math.max(2, band / series.length);
              const x =
                padding.left +
                index * slot +
                slot * 0.12 +
                seriesIndex * barWidth;
              const top = Math.min(y(point), baseline);
              const barHeight = Math.max(1, Math.abs(y(point) - baseline));
              return `<rect x="${x}" y="${top}" width="${Math.max(1, barWidth - 2)}" height="${barHeight}" rx="3" fill="${entry.color}"><title>${escapeHtml(`${entry.name}, ${labels[index]}: ${point}`)}</title></rect>`;
            }),
          )
          .join("")
      : series
          .map((entry) => {
            const points = entry.values
              .map(
                (point, index) =>
                  `${padding.left + slot * (index + 0.5)},${y(point)}`,
              )
              .join(" ");
            const dots = entry.values
              .map(
                (point, index) =>
                  `<circle cx="${padding.left + slot * (index + 0.5)}" cy="${y(point)}" r="${type === "scatter" ? 5 : 3.5}" fill="${entry.color}"><title>${escapeHtml(`${entry.name}, ${labels[index]}: ${point}`)}</title></circle>`,
              )
              .join("");
            return `${type === "line" ? `<polyline points="${points}" fill="none" stroke="${entry.color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>` : ""}${dots}`;
          })
          .join("");
  const axes = labels
    .map((label, index) => {
      const x = padding.left + slot * (index + 0.5);
      return `<text x="${x}" y="${height - padding.bottom + 22}" text-anchor="middle" fill="#6f6d66" font-size="11">${escapeHtml(label.slice(0, 18))}</text>`;
    })
    .join("");
  const legend = series
    .map(
      (entry, _index) =>
        `<span><i style="background:${entry.color}"></i>${escapeHtml(entry.name)}</span>`,
    )
    .join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>*{box-sizing:border-box}body{margin:0;background:#fbfaf7;color:#25241f;font-family:"Avenir Next","Segoe UI",sans-serif}.chart{padding:20px}.frame{border:1px solid #dedbd3;border-radius:14px;background:#fff;box-shadow:0 14px 40px rgba(36,31,24,.06);overflow:hidden}.heading{padding:20px 22px 0}.heading h1{margin:0;font-family:Georgia,serif;font-size:24px}.heading p{margin:7px 0 0;color:#6f6d66;font-size:13px}.legend{display:flex;flex-wrap:wrap;gap:14px;padding:4px 22px 18px;color:#6f6d66;font-size:12px}.legend span{display:inline-flex;align-items:center;gap:6px}.legend i{width:9px;height:9px;border-radius:50%}svg{display:block;width:100%;height:auto}@media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}</style></head><body><main class="chart"><section class="frame"><header class="heading"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(description)}</p></header><svg viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="${chartId}-title ${chartId}-desc"><title id="${chartId}-title">${escapeHtml(title)}</title><desc id="${chartId}-desc">${escapeHtml(description)}</desc>${grid}<line x1="${padding.left}" y1="${baseline}" x2="${width - padding.right}" y2="${baseline}" stroke="#8f8b82" stroke-width="1.5"/>${marks}${axes}</svg><footer class="legend">${legend}</footer></section></main></body></html>`;
}
