"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell as ChartCell,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { WorkbookSheet, SheetChart, SheetsCalculation } from "../sheets/model";
import { chartDataset, histogramDataset, type ChartPlotData } from "../sheets/chart-dataset";

const CHART_COLORS = ["#169b69", "#7066ed", "#db7b27", "#2f8fd2", "#b85d7a"];

function formatChartTick(value: string | number) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  }
  const text = String(value ?? "");
  return text.length > 10 ? `${text.slice(0, 9)}…` : text;
}

export function SheetsChartView({
  sheet,
  chart,
  calculated,
}: {
  sheet: WorkbookSheet;
  chart: SheetChart;
  calculated: SheetsCalculation;
}) {
  const plot: ChartPlotData = {
    ...chartDataset(sheet, chart, calculated),
    ...(chart.type === "histogram" ? { histogram: histogramDataset(sheet, chart, calculated) } : {}),
  };
  return <SheetsChartPlot chart={chart} plot={plot} />;
}

/**
 * A chart drawn from data already worked out. The editor computes it on the
 * page; the Office viewer computes it in its worker and sends it over.
 */
export function SheetsChartPlot({
  chart,
  plot,
}: {
  chart: Pick<SheetChart, "type" | "title">;
  plot: ChartPlotData;
}) {
  const dataset = plot;
  const tick = {
    fontSize: 10,
    fill: "var(--text-secondary)",
    fontFamily: "inherit",
  };
  const axisStroke = { stroke: "var(--border-default)" };
  const common = {
    data: dataset.data,
    margin: { top: 8, right: 10, left: 2, bottom: 4 },
  };
  const chartAxes = [
    <CartesianGrid
      key="grid"
      stroke="color-mix(in oklab, var(--text-primary) 14%, transparent)"
      vertical={false}
    />,
    <XAxis
      key="x"
      dataKey={dataset.category}
      tick={tick}
      tickFormatter={formatChartTick}
      tickLine={axisStroke}
      axisLine={axisStroke}
      interval="preserveStartEnd"
      angle={dataset.data.length > 5 ? -36 : 0}
      textAnchor={dataset.data.length > 5 ? "end" : "middle"}
      height={dataset.data.length > 5 ? 48 : 28}
      minTickGap={12}
    />,
    <YAxis
      key="y"
      width={44}
      tick={tick}
      tickFormatter={formatChartTick}
      tickLine={axisStroke}
      axisLine={axisStroke}
      allowDecimals
      domain={["auto", "auto"]}
    />,
    <ChartTooltip
      key="tip"
      formatter={(value) =>
        typeof value === "number" ? formatChartTick(value) : value
      }
    />,
    dataset.keys.length > 1 ? (
      <Legend key="legend" wrapperStyle={{ fontSize: 10, paddingTop: 4 }} />
    ) : null,
  ];
  if (chart.type === "histogram") {
    const histogram = plot.histogram ?? [];
    return (
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={histogram}
          margin={{ top: 8, right: 16, left: 0, bottom: 4 }}
          barCategoryGap={1}
        >
          <CartesianGrid
            stroke="var(--border-subtle)"
            vertical={false}
            strokeDasharray="3 4"
          />
          <XAxis
            dataKey="bucket"
            tick={tick}
            tickLine={axisStroke}
            axisLine={axisStroke}
            interval={0}
            angle={dataset.data.length > 6 ? -24 : 0}
            textAnchor={dataset.data.length > 6 ? "end" : "middle"}
            height={dataset.data.length > 6 ? 40 : 28}
          />
          <YAxis
            width={36}
            allowDecimals={false}
            tick={tick}
            tickLine={axisStroke}
            axisLine={axisStroke}
          />
          <ChartTooltip />
          <Bar dataKey="count" name="Frequency" fill={CHART_COLORS[0]} />
        </BarChart>
      </ResponsiveContainer>
    );
  }
  if (chart.type === "scatter") {
    const xKey = dataset.category;
    const yKey = dataset.keys[0];
    return (
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart {...common}>
          <CartesianGrid stroke="var(--border-subtle)" strokeDasharray="3 4" />
          <XAxis
            type="number"
            dataKey={xKey}
            name={xKey}
            tick={tick}
            tickFormatter={formatChartTick}
            tickLine={axisStroke}
            axisLine={axisStroke}
            height={28}
          />
          <YAxis
            type="number"
            dataKey={yKey}
            name={yKey}
            width={44}
            tick={tick}
            tickFormatter={formatChartTick}
            tickLine={axisStroke}
            axisLine={axisStroke}
          />
          <ChartTooltip
            cursor={{ strokeDasharray: "3 3" }}
            formatter={(value) =>
              typeof value === "number" ? formatChartTick(value) : value
            }
          />
          <Scatter
            name={yKey || chart.title}
            data={dataset.data}
            fill={CHART_COLORS[0]}
          />
        </ScatterChart>
      </ResponsiveContainer>
    );
  }
  if (chart.type === "combo") {
    return (
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart {...common}>
          {chartAxes}
          {dataset.keys[0] ? (
            <Bar
              dataKey={dataset.keys[0]}
              fill={CHART_COLORS[0]}
              fillOpacity={0.3}
              radius={[3, 3, 0, 0]}
            />
          ) : null}
          {dataset.keys.slice(1).map((key, index) => (
            <Line
              key={key}
              type="monotone"
              dataKey={key}
              stroke={CHART_COLORS[(index + 1) % CHART_COLORS.length]}
              strokeWidth={2}
              dot={{ r: 3 }}
            />
          ))}
        </ComposedChart>
      </ResponsiveContainer>
    );
  }
  if (chart.type === "pie") {
    const key = dataset.keys[0];
    return (
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={dataset.data}
            dataKey={key}
            nameKey={dataset.category}
            innerRadius="36%"
            outerRadius="72%"
            paddingAngle={2}
          >
            {dataset.data.map((_, index) => (
              <ChartCell
                key={index}
                fill={CHART_COLORS[index % CHART_COLORS.length]}
              />
            ))}
          </Pie>
          <ChartTooltip />
          <Legend wrapperStyle={{ fontSize: 10 }} />
        </PieChart>
      </ResponsiveContainer>
    );
  }
  if (chart.type === "bar" || chart.type === "column")
    return (
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          {...common}
          layout={chart.type === "bar" ? "vertical" : "horizontal"}
        >
          {chartAxes}
          {dataset.keys.map((key, index) => (
            <Bar
              key={key}
              dataKey={key}
              fill={CHART_COLORS[index % CHART_COLORS.length]}
              radius={[3, 3, 0, 0]}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    );
  if (chart.type === "area")
    return (
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart {...common}>
          {chartAxes}
          {dataset.keys.map((key, index) => (
            <Area
              key={key}
              type="monotone"
              dataKey={key}
              stroke={CHART_COLORS[index % CHART_COLORS.length]}
              fill={CHART_COLORS[index % CHART_COLORS.length]}
              fillOpacity={0.12}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    );
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart {...common}>
        {chartAxes}
        {dataset.keys.map((key, index) => (
          <Line
            key={key}
            type="monotone"
            dataKey={key}
            stroke={CHART_COLORS[index % CHART_COLORS.length]}
            strokeWidth={2}
            dot={{ r: 3 }}
            activeDot={{ r: 5 }}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

