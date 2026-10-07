"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";

import { formatPnl, pnlTone } from "@/lib/format";
import type { DailyPoint } from "@/lib/types";

import { cn } from "./ui";

// Chart roles (validated for the dark surface): series blue for the single
// equity series; gain/loss pair for polarity, always with a sign on values.
const COLORS = {
  series: "#3987e5",
  gain: "#199e70",
  loss: "#e66767",
  grid: "#262c36",
  axis: "#8a919c",
  surface: "#12161c"
};

const shortDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

const axisProps = {
  stroke: COLORS.axis,
  tick: { fill: COLORS.axis, fontSize: 11 },
  tickLine: false,
  axisLine: false
} as const;

const ChartTooltip = ({
  active,
  payload,
  label,
  field,
  title
}: {
  active?: boolean;
  payload?: readonly { payload?: unknown }[];
  label?: unknown;
  field: keyof DailyPoint;
  title: string;
}) => {
  const point = payload?.[0]?.payload as DailyPoint | undefined;

  if (!active || !point) return null;

  const value = point[field] as number;

  return (
    <div className="rounded-lg border border-border-strong bg-surface-2 px-3 py-2 text-xs shadow-xl">
      <p className="text-muted">{shortDate(String(label))}</p>
      <p className="mt-1 text-text-2">
        {title}: <span className={cn("num font-semibold", pnlTone(value))}>{formatPnl(value)} USDT</span>
      </p>
      {field === "netPnL" && (point.winningTrades > 0 || point.losingTrades > 0) && (
        <p className="num mt-0.5 text-muted">
          {point.winningTrades}W / {point.losingTrades}L
        </p>
      )}
    </div>
  );
};

const ScreenReaderTable = ({ data, field, caption }: { data: DailyPoint[]; field: keyof DailyPoint; caption: string }) => (
  <table className="sr-only">
    <caption>{caption}</caption>
    <thead>
      <tr>
        <th>Date</th>
        <th>USDT</th>
      </tr>
    </thead>
    <tbody>
      {data.map((point) => (
        <tr key={point.date}>
          <td>{point.date}</td>
          <td>{formatPnl(point[field] as number)}</td>
        </tr>
      ))}
    </tbody>
  </table>
);

/** Cumulative net PnL (after fees), one point per UTC day. */
export const EquityChart = ({ data }: { data: DailyPoint[] }) => {
  const last = data.at(-1)?.cumulativePnL ?? 0;

  return (
    <figure>
      <div
        className="h-64"
        role="img"
        aria-label={`Cumulative net PnL over ${data.length} days, ending at ${formatPnl(last)} USDT`}
      >
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="equityFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={COLORS.series} stopOpacity={0.25} />
                <stop offset="100%" stopColor={COLORS.series} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke={COLORS.grid} strokeDasharray="0" vertical={false} />
            <XAxis dataKey="date" tickFormatter={shortDate} minTickGap={32} {...axisProps} />
            <YAxis width={56} tickFormatter={(value: number) => value.toFixed(0)} {...axisProps} />
            <ReferenceLine y={0} stroke={COLORS.axis} strokeOpacity={0.5} />
            <Tooltip
              cursor={{ stroke: COLORS.axis, strokeDasharray: "3 3" }}
              content={({ active, payload, label }) => (
                <ChartTooltip active={active} payload={payload} label={label} field="cumulativePnL" title="Cumulative" />
              )}
            />
            <Area
              type="linear"
              dataKey="cumulativePnL"
              stroke={COLORS.series}
              strokeWidth={2}
              fill="url(#equityFill)"
              activeDot={{ r: 4, stroke: COLORS.surface, strokeWidth: 2 }}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <ScreenReaderTable data={data} field="cumulativePnL" caption="Cumulative net PnL by day" />
    </figure>
  );
};

interface BarShapeProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  payload?: DailyPoint;
}

/** Rounded only at the end away from zero, so every bar stays anchored to the baseline. */
const PnlBar = ({ x = 0, y = 0, width = 0, height = 0, payload }: BarShapeProps) => {
  const value = payload?.netPnL ?? 0;

  if (value === 0 || width <= 0) return null;

  const top = Math.min(y, y + height);
  const barHeight = Math.abs(height);
  const radius = Math.min(4, width / 2, barHeight);
  const positive = value > 0;
  const path = positive
    ? `M${x},${top + barHeight} V${top + radius} Q${x},${top} ${x + radius},${top} H${x + width - radius} Q${x + width},${top} ${x + width},${top + radius} V${top + barHeight} Z`
    : `M${x},${top} V${top + barHeight - radius} Q${x},${top + barHeight} ${x + radius},${top + barHeight} H${x + width - radius} Q${x + width},${top + barHeight} ${x + width},${top + barHeight - radius} V${top} Z`;

  return <path d={path} fill={positive ? COLORS.gain : COLORS.loss} />;
};

/** Net PnL per day: bars above zero are profitable days, below zero losing days. */
export const DailyPnlChart = ({ data }: { data: DailyPoint[] }) => (
  <figure>
    <div className="h-40" role="img" aria-label="Net PnL per day; bars above zero are profitable days">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap={2}>
          <CartesianGrid stroke={COLORS.grid} vertical={false} />
          <XAxis dataKey="date" tickFormatter={shortDate} minTickGap={32} {...axisProps} />
          <YAxis width={56} tickFormatter={(value: number) => value.toFixed(0)} {...axisProps} />
          <ReferenceLine y={0} stroke={COLORS.axis} strokeOpacity={0.6} />
          <Tooltip
            cursor={{ fill: "rgba(255,255,255,0.04)" }}
            content={({ active, payload, label }) => (
              <ChartTooltip active={active} payload={payload} label={label} field="netPnL" title="Net PnL" />
            )}
          />
          <Bar dataKey="netPnL" shape={PnlBar} maxBarSize={18} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
    <ScreenReaderTable data={data} field="netPnL" caption="Net PnL by day" />
  </figure>
);
