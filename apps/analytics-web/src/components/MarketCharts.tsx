"use client";

import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  LineChart, Line, CartesianGrid, Legend,
} from "recharts";
import type { HistogramBucket, MarketTimeseriesPoint } from "@/lib/api";
import { formatPrice } from "@/lib/format";
import { ASKING_COLOR, SOLD_COLOR } from "@/lib/market-colors";

const tooltipStyle = {
  contentStyle: { background: "#1a1a1a", border: "1px solid #333", borderRadius: 4 },
  labelStyle: { color: "#e5e5e5" },
} as const;

const axisTick = { fill: "#a3a3a3", fontSize: 11 } as const;

function yenAxisTick(v: number): string {
  return v >= 1000 ? `¥${(v / 1000).toFixed(0)}k` : `¥${v}`;
}

export function MarketHistogram({ data, color, name }: {
  data: HistogramBucket[];
  color: string;
  name: string;
}) {
  if (data.length === 0) {
    return <p style={{ color: "#737373", fontSize: 14 }}>No data yet.</p>;
  }

  const chartData = data.map((b) => ({
    range: formatPrice(b.bucketMin),
    count: b.count,
  }));

  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={chartData}>
        <XAxis dataKey="range" tick={axisTick} angle={-45} textAnchor="end" height={60} interval="preserveStartEnd" />
        <YAxis tick={{ fill: "#a3a3a3", fontSize: 12 }} allowDecimals={false} />
        <Tooltip {...tooltipStyle} />
        <Bar dataKey="count" fill={color} radius={[2, 2, 0, 0]} name={name} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function MarketTimeseriesChart({ data }: { data: MarketTimeseriesPoint[] }) {
  if (data.length === 0) {
    return <p style={{ color: "#737373", fontSize: 14 }}>No timeseries data yet.</p>;
  }

  const hasPrices = data.some((p) => p.askingMedianPrice != null || p.soldMedianPrice != null);

  return (
    <div>
      {hasPrices ? (
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={data} syncId="market-timeseries">
            <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
            <XAxis dataKey="periodStart" tick={axisTick} />
            <YAxis tick={{ fill: "#a3a3a3", fontSize: 12 }} tickFormatter={yenAxisTick} />
            <Tooltip {...tooltipStyle} formatter={(value: number) => formatPrice(value)} />
            <Legend wrapperStyle={{ color: "#a3a3a3" }} />
            <Line
              type="monotone"
              dataKey="askingMedianPrice"
              stroke={ASKING_COLOR}
              strokeWidth={2}
              dot={false}
              connectNulls
              name="Median asking"
            />
            <Line
              type="monotone"
              dataKey="soldMedianPrice"
              stroke={SOLD_COLOR}
              strokeWidth={2}
              dot={false}
              connectNulls
              name="Median sold"
            />
          </LineChart>
        </ResponsiveContainer>
      ) : (
        <p style={{ color: "#737373", fontSize: 14 }}>No median price data yet.</p>
      )}

      <ResponsiveContainer width="100%" height={140}>
        <BarChart data={data} syncId="market-timeseries">
          <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
          <XAxis dataKey="periodStart" tick={axisTick} />
          <YAxis tick={{ fill: "#a3a3a3", fontSize: 12 }} allowDecimals={false} />
          <Tooltip {...tooltipStyle} />
          <Bar dataKey="soldCount" fill={SOLD_COLOR} radius={[2, 2, 0, 0]} name="Sold" />
        </BarChart>
      </ResponsiveContainer>
      <p style={{ color: "#737373", fontSize: 12, marginTop: 4, textAlign: "center" }}>
        Sold per period
      </p>
    </div>
  );
}
