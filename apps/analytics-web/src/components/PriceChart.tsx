"use client";

import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  LineChart, Line, CartesianGrid, Legend,
  Area, AreaChart,
} from "recharts";
import type { HistogramBucket, TimeseriesPoint } from "@/lib/api";
import { formatPrice } from "@/lib/format";

export function Histogram({ data }: { data: HistogramBucket[] }) {
  if (data.length === 0) return <p style={{ color: "#737373" }}>No data</p>;

  const chartData = data.map((b) => ({
    range: `${formatPrice(b.bucketMin)}`,
    count: b.count,
  }));

  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={chartData}>
        <XAxis dataKey="range" tick={{ fill: "#a3a3a3", fontSize: 11 }} angle={-45} textAnchor="end" height={60} />
        <YAxis tick={{ fill: "#a3a3a3", fontSize: 12 }} />
        <Tooltip
          contentStyle={{ background: "#1a1a1a", border: "1px solid #333", borderRadius: 4 }}
          labelStyle={{ color: "#e5e5e5" }}
        />
        <Bar dataKey="count" fill="#3b82f6" radius={[2, 2, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function PriceTrendChart({ data }: { data: TimeseriesPoint[] }) {
  if (data.length === 0) return <p style={{ color: "#737373" }}>No data</p>;

  return (
    <ResponsiveContainer width="100%" height={300}>
      <AreaChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
        <XAxis dataKey="periodStart" tick={{ fill: "#a3a3a3", fontSize: 11 }} />
        <YAxis tick={{ fill: "#a3a3a3", fontSize: 12 }} tickFormatter={(v: number) => `¥${(v / 1000).toFixed(0)}k`} />
        <Tooltip
          contentStyle={{ background: "#1a1a1a", border: "1px solid #333", borderRadius: 4 }}
          labelStyle={{ color: "#e5e5e5" }}
          formatter={(value: number) => formatPrice(value)}
        />
        <Legend wrapperStyle={{ color: "#a3a3a3" }} />
        <Area type="monotone" dataKey="maxPrice" stackId="1" stroke="transparent" fill="#3b82f6" fillOpacity={0.1} name="Max" />
        <Area type="monotone" dataKey="p75Price" stackId="2" stroke="transparent" fill="#3b82f6" fillOpacity={0.15} name="P75" />
        <Area type="monotone" dataKey="medianPrice" stackId="3" stroke="transparent" fill="#3b82f6" fillOpacity={0.2} name="Median" />
        <Line type="monotone" dataKey="medianPrice" stroke="#60a5fa" strokeWidth={2} dot={false} name="Median" />
        <Line type="monotone" dataKey="minPrice" stroke="#34d399" strokeWidth={1} dot={false} name="Min" />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function VolumeChart({ data }: { data: TimeseriesPoint[] }) {
  if (data.length === 0) return <p style={{ color: "#737373" }}>No data</p>;

  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
        <XAxis dataKey="periodStart" tick={{ fill: "#a3a3a3", fontSize: 11 }} />
        <YAxis tick={{ fill: "#a3a3a3", fontSize: 12 }} />
        <Tooltip
          contentStyle={{ background: "#1a1a1a", border: "1px solid #333", borderRadius: 4 }}
          labelStyle={{ color: "#e5e5e5" }}
        />
        <Bar dataKey="observationCount" fill="#8b5cf6" radius={[2, 2, 0, 0]} name="Observations" />
        <Bar dataKey="uniqueListingCount" fill="#6366f1" radius={[2, 2, 0, 0]} name="Unique Listings" />
      </BarChart>
    </ResponsiveContainer>
  );
}
