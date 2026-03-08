import { getPriceDistribution, getTimeseries, getListings } from "@/lib/api";
import { formatPrice, formatDateTime } from "@/lib/format";
import { Histogram, PriceTrendChart, VolumeChart } from "@/components/PriceChart";
import Link from "next/link";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string; to?: string; granularity?: string; sort?: string }>;
}

export default async function KeywordDetailPage({ params, searchParams }: Props) {
  const { id } = await params;
  const sp = await searchParams;
  const granularity = sp.granularity ?? "day";

  const [dist, ts, cheapest, recent] = await Promise.all([
    getPriceDistribution(id, sp.from, sp.to),
    getTimeseries(id, sp.from, sp.to, granularity),
    getListings(id, { from: sp.from, to: sp.to, sort: "cheapest", limit: "10" }),
    getListings(id, { from: sp.from, to: sp.to, sort: "newest", limit: "10" }),
  ]);

  const { stats } = dist;

  return (
    <div>
      <Link href="/" style={{ color: "#60a5fa", textDecoration: "none", fontSize: 14 }}>
        &larr; All Keywords
      </Link>
      <h1 style={{ fontSize: 24, margin: "12px 0 8px" }}>{dist.keywordName}</h1>
      <p style={{ color: "#a3a3a3", marginBottom: 24, fontSize: 14 }}>
        Last 30 days &middot; {stats.count.toLocaleString()} observations
      </p>

      {/* Stats cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12, marginBottom: 32 }}>
        {[
          { label: "Min", value: formatPrice(stats.min) },
          { label: "P25", value: formatPrice(stats.p25) },
          { label: "Median", value: formatPrice(stats.median) },
          { label: "P75", value: formatPrice(stats.p75) },
          { label: "Max", value: formatPrice(stats.max) },
          { label: "Mean", value: formatPrice(stats.mean) },
        ].map((s) => (
          <div key={s.label} style={{ background: "#141414", border: "1px solid #262626", borderRadius: 8, padding: "12px 16px" }}>
            <div style={{ color: "#737373", fontSize: 12, marginBottom: 4 }}>{s.label}</div>
            <div style={{ fontSize: 18, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Histogram */}
      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 18, marginBottom: 12 }}>Price Distribution</h2>
        <Histogram data={dist.histogram} />
      </section>

      {/* Price trend */}
      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 18, marginBottom: 4 }}>Price Trend</h2>
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          {(["day", "week", "month"] as const).map((g) => (
            <Link
              key={g}
              href={`/keywords/${id}?granularity=${g}`}
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
        <PriceTrendChart data={ts.series} />
      </section>

      {/* Volume */}
      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 18, marginBottom: 12 }}>Listing Volume</h2>
        <VolumeChart data={ts.series} />
      </section>

      {/* Cheapest listings */}
      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 18, marginBottom: 12 }}>Cheapest Recent Listings</h2>
        <ListingsTable listings={cheapest.listings} />
      </section>

      {/* Recent listings */}
      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 18, marginBottom: 12 }}>Most Recent Listings</h2>
        <ListingsTable listings={recent.listings} />
      </section>
    </div>
  );
}

function ListingsTable({ listings }: { listings: Array<{ title: string; url: string; imageUrl: string; price: number; currency: string; observedAt: string }> }) {
  if (listings.length === 0) {
    return <p style={{ color: "#737373" }}>No listings found.</p>;
  }

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
        <thead>
          <tr style={{ borderBottom: "1px solid #262626", textAlign: "left" }}>
            <th style={thStyle}>Image</th>
            <th style={thStyle}>Title</th>
            <th style={{ ...thStyle, textAlign: "right" }}>Price</th>
            <th style={{ ...thStyle, textAlign: "right" }}>Observed</th>
          </tr>
        </thead>
        <tbody>
          {listings.map((l, i) => (
            <tr key={i} style={{ borderBottom: "1px solid #1a1a1a" }}>
              <td style={tdStyle}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={l.imageUrl} alt="" width={48} height={48} style={{ borderRadius: 4, objectFit: "cover" }} />
              </td>
              <td style={tdStyle}>
                <a href={l.url} target="_blank" rel="noopener noreferrer" style={{ color: "#60a5fa", textDecoration: "none" }}>
                  {l.title.length > 60 ? `${l.title.slice(0, 60)}...` : l.title}
                </a>
              </td>
              <td style={{ ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                {formatPrice(l.price, l.currency)}
              </td>
              <td style={{ ...tdStyle, textAlign: "right", color: "#a3a3a3" }}>
                {formatDateTime(l.observedAt)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const thStyle: React.CSSProperties = { padding: "8px 12px", fontWeight: 600, color: "#a3a3a3" };
const tdStyle: React.CSSProperties = { padding: "8px 12px" };
