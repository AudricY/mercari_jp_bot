import Link from "next/link";

import { getMarketCategories, type MarketCategory } from "@/lib/api";
import { requireAnalyticsSession } from "@/lib/auth";
import { formatPrice, formatSignedPrice, formatRelativeTime } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function MarketOverviewPage() {
  await requireAnalyticsSession();
  const data = await getMarketCategories();

  const software = data.categories.filter((c) => c.kind === "software");
  const consoles = data.categories.filter((c) => c.kind === "console");
  const other = data.categories.filter((c) => c.kind !== "software" && c.kind !== "console");

  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap", marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 24, marginBottom: 8, marginTop: 0 }}>Market Overview</h1>
          <p style={{ color: "#a3a3a3", fontSize: 14, margin: 0 }}>
            Category-level supply and sold-price tracking &middot; {data.categories.length} categories
          </p>
        </div>
        <form action="/market/search" method="get" style={{ display: "flex", gap: 8 }}>
          <input
            type="search"
            name="q"
            placeholder="Search listings (min 2 chars)"
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
            Search
          </button>
        </form>
      </div>

      {data.categories.length === 0 && (
        <p style={{ color: "#737373", textAlign: "center", marginTop: 48 }}>
          No market data yet. Categories will appear once the market sweeps have run.
        </p>
      )}

      {software.length > 0 && <CategorySection title="Software" categories={software} />}
      {consoles.length > 0 && <CategorySection title="Consoles" categories={consoles} />}
      {other.length > 0 && <CategorySection title="Other" categories={other} />}
    </div>
  );
}

function CategorySection({ title, categories }: { title: string; categories: MarketCategory[] }) {
  return (
    <section style={{ marginBottom: 32 }}>
      <h2 style={{ fontSize: 18, marginBottom: 12 }}>{title}</h2>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #262626", textAlign: "left" }}>
              <th style={thStyle}>Category</th>
              <th style={thStyleRight}>On Sale</th>
              <th style={thStyleRight}>Sold 7d</th>
              <th style={thStyleRight}>Sold 30d</th>
              <th style={thStyleRight}>Median Asking</th>
              <th style={thStyleRight}>Median Sold</th>
              <th style={thStyleRight}>Spread</th>
              <th style={thStyleRight}>Freshness</th>
            </tr>
          </thead>
          <tbody>
            {categories.map((c) => (
              <tr key={c.categoryId} style={{ borderBottom: "1px solid #1a1a1a" }}>
                <td style={tdStyle}>
                  <Link href={`/market/${c.categoryId}`} style={{ color: "#60a5fa", textDecoration: "none" }}>
                    {c.label}
                  </Link>
                  <span style={{ color: "#737373", marginLeft: 8, fontSize: 12 }}>{c.platform}</span>
                </td>
                <td style={tdStyleRight}>{c.onSaleCount.toLocaleString()}</td>
                <td style={tdStyleRight}>{c.sold7dCount.toLocaleString()}</td>
                <td style={tdStyleRight}>{c.sold30dCount.toLocaleString()}</td>
                <td style={tdStyleRight}>{c.askingMedianPrice != null ? formatPrice(c.askingMedianPrice) : "—"}</td>
                <td style={tdStyleRight}>{c.soldMedianPrice != null ? formatPrice(c.soldMedianPrice) : "—"}</td>
                <td style={tdStyleRight}>{c.medianSpread != null ? formatSignedPrice(c.medianSpread) : "—"}</td>
                <td style={{ ...tdStyleRight, color: "#a3a3a3" }}>
                  {c.lastSoldSweepAt ? formatRelativeTime(c.lastSoldSweepAt) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const thStyle: React.CSSProperties = { padding: "8px 12px", fontWeight: 600, color: "#a3a3a3" };
const thStyleRight: React.CSSProperties = { ...thStyle, textAlign: "right" };
const tdStyle: React.CSSProperties = { padding: "8px 12px" };
const tdStyleRight: React.CSSProperties = { ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" };
