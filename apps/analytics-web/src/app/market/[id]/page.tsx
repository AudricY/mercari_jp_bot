import Link from "next/link";
import { notFound } from "next/navigation";

import {
  getMarketListings,
  getMarketPriceDistribution,
  getMarketTimeseries,
} from "@/lib/api";
import { requireAnalyticsSession } from "@/lib/auth";
import { formatPrice, formatSignedPrice } from "@/lib/format";
import { MarketHistogram, MarketTimeseriesChart } from "@/components/MarketCharts";
import { ASKING_COLOR, SOLD_COLOR } from "@/lib/market-colors";
import { MarketListingsTable } from "@/components/MarketListingsTable";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ granularity?: string; q?: string; from?: string; to?: string }>;
}

const GRANULARITIES = ["day", "week", "month"] as const;

export default async function MarketCategoryPage({ params, searchParams }: Props) {
  await requireAnalyticsSession();
  const { id } = await params;
  const sp = await searchParams;
  const granularity = GRANULARITIES.includes(sp.granularity as (typeof GRANULARITIES)[number])
    ? (sp.granularity as (typeof GRANULARITIES)[number])
    : "day";
  const q = sp.q?.trim() || undefined;

  let askingDist, soldDist, ts, soldListings, cheapListings;
  try {
    [askingDist, soldDist, ts, soldListings, cheapListings] = await Promise.all([
      getMarketPriceDistribution(id, { status: "on_sale", days: "30" }),
      getMarketPriceDistribution(id, { status: "sold", days: "30" }),
      getMarketTimeseries(id, { from: sp.from, to: sp.to, granularity }),
      getMarketListings(id, { status: "sold", sort: "recently_sold", q, limit: "10" }),
      getMarketListings(id, { status: "on_sale", sort: "cheapest", q, limit: "10" }),
    ]);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("API 404")) {
      notFound();
    }
    throw error;
  }

  const askingMedian = askingDist.stats.count > 0 ? askingDist.stats.median : null;
  const soldMedian = soldDist.stats.count > 0 ? soldDist.stats.median : null;
  const spread = askingMedian != null && soldMedian != null ? askingMedian - soldMedian : null;

  const tiles = [
    { label: "On Sale", value: askingDist.stats.count.toLocaleString() },
    { label: "Sold 30d", value: soldDist.stats.count.toLocaleString() },
    { label: "Median Asking", value: askingMedian != null ? formatPrice(askingMedian) : "—" },
    { label: "Median Sold", value: soldMedian != null ? formatPrice(soldMedian) : "—" },
    { label: "Spread", value: spread != null ? formatSignedPrice(spread) : "—" },
  ];

  const detailPath = (g: string) => {
    const query = new URLSearchParams({ granularity: g });
    if (q) query.set("q", q);
    return `/market/${id}?${query.toString()}`;
  };

  return (
    <div>
      <Link href="/market" style={{ color: "#60a5fa", textDecoration: "none", fontSize: 14 }}>
        &larr; Market Overview
      </Link>
      <h1 style={{ fontSize: 24, margin: "12px 0 8px" }}>{askingDist.label}</h1>
      <p style={{ color: "#a3a3a3", marginBottom: 24, fontSize: 14 }}>
        {askingDist.platform} &middot; {askingDist.kind}
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12, marginBottom: 32 }}>
        {tiles.map((t) => (
          <div key={t.label} style={{ background: "#141414", border: "1px solid #262626", borderRadius: 8, padding: "12px 16px" }}>
            <div style={{ color: "#737373", fontSize: 12, marginBottom: 4 }}>{t.label}</div>
            <div style={{ fontSize: 18, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{t.value}</div>
          </div>
        ))}
      </div>

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 18, marginBottom: 12 }}>Price Distribution (last {soldDist.days} days)</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 24 }}>
          <div>
            <h3 style={{ fontSize: 14, marginBottom: 8, color: "#a3a3a3" }}>
              <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 2, background: ASKING_COLOR, marginRight: 8 }} />
              Asking (on sale)
            </h3>
            <MarketHistogram data={askingDist.histogram} color={ASKING_COLOR} name="Asking" />
          </div>
          <div>
            <h3 style={{ fontSize: 14, marginBottom: 8, color: "#a3a3a3" }}>
              <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 2, background: SOLD_COLOR, marginRight: 8 }} />
              Sold
            </h3>
            <MarketHistogram data={soldDist.histogram} color={SOLD_COLOR} name="Sold" />
          </div>
        </div>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 18, marginBottom: 4 }}>Price &amp; Volume Trend</h2>
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          {GRANULARITIES.map((g) => (
            <Link
              key={g}
              href={detailPath(g)}
              style={{
                padding: "4px 12px",
                borderRadius: 4,
                background: granularity === g ? "#3b82f6" : "#1a1a1a",
                color: granularity === g ? "#fff" : "#a3a3a3",
                textDecoration: "none",
                fontSize: 13,
              }}
            >
              {g}
            </Link>
          ))}
        </div>
        <MarketTimeseriesChart data={ts.series} />
      </section>

      <form method="get" style={{ display: "flex", gap: 8, marginBottom: 24, alignItems: "center" }}>
        <input type="hidden" name="granularity" value={granularity} />
        <input
          type="search"
          name="q"
          defaultValue={q ?? ""}
          placeholder="Filter listings by title"
          style={{
            padding: "8px 12px",
            borderRadius: 6,
            border: "1px solid #404040",
            background: "#141414",
            color: "#e5e5e5",
            fontSize: 14,
            width: 260,
          }}
        />
        <button
          type="submit"
          style={{
            padding: "8px 14px",
            borderRadius: 6,
            border: "1px solid #404040",
            background: "#1a1a1a",
            color: "#e5e5e5",
            cursor: "pointer",
            fontSize: 14,
          }}
        >
          Filter
        </button>
        {q && (
          <Link href={`/market/${id}?granularity=${granularity}`} style={{ color: "#a3a3a3", fontSize: 13 }}>
            Clear
          </Link>
        )}
      </form>

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 18, marginBottom: 12 }}>
          Recently Sold
          <span style={{ color: "#737373", fontSize: 13, fontWeight: 400, marginLeft: 8 }}>
            {soldListings.total.toLocaleString()} total{q ? ` matching "${q}"` : ""}
          </span>
        </h2>
        <MarketListingsTable
          listings={soldListings.listings}
          showSold
          emptyMessage={q ? `No sold listings matching "${q}".` : "No sold listings observed yet."}
        />
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 18, marginBottom: 12 }}>
          Cheapest On Sale
          <span style={{ color: "#737373", fontSize: 13, fontWeight: 400, marginLeft: 8 }}>
            {cheapListings.total.toLocaleString()} total{q ? ` matching "${q}"` : ""}
          </span>
        </h2>
        <MarketListingsTable
          listings={cheapListings.listings}
          emptyMessage={q ? `No on-sale listings matching "${q}".` : "No on-sale listings tracked yet."}
        />
      </section>
    </div>
  );
}
