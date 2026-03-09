import { getKeywords } from "@/lib/api";
import { requireAnalyticsSession } from "@/lib/auth";
import { formatPrice, formatDateTime } from "@/lib/format";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  await requireAnalyticsSession();
  const data = await getKeywords();

  return (
    <div>
      <h1 style={{ fontSize: 24, marginBottom: 8 }}>Keywords Overview</h1>
      <p style={{ color: "#a3a3a3", marginBottom: 24, fontSize: 14 }}>
        Current tracked listings &middot; {data.keywords.length} keywords
      </p>

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #262626", textAlign: "left" }}>
              <th style={thStyle}>Keyword</th>
              <th style={thStyleRight}>Listings</th>
              <th style={thStyleRight}>Median Price</th>
              <th style={thStyleRight}>Min</th>
              <th style={thStyleRight}>Max</th>
              <th style={thStyleRight}>Last Seen</th>
            </tr>
          </thead>
          <tbody>
            {data.keywords.map((kw) => (
              <tr key={kw.keywordId} style={{ borderBottom: "1px solid #1a1a1a" }}>
                <td style={tdStyle}>
                  <Link href={`/keywords/${kw.keywordId}`} style={{ color: "#60a5fa", textDecoration: "none" }}>
                    {kw.keywordName}
                  </Link>
                </td>
                <td style={tdStyleRight}>{kw.listingCount.toLocaleString()}</td>
                <td style={tdStyleRight}>{kw.listingCount > 0 ? formatPrice(kw.medianPrice) : "—"}</td>
                <td style={tdStyleRight}>{kw.listingCount > 0 ? formatPrice(kw.minPrice) : "—"}</td>
                <td style={tdStyleRight}>{kw.listingCount > 0 ? formatPrice(kw.maxPrice) : "—"}</td>
                <td style={tdStyleRight}>{kw.latestScrapedAt ? formatDateTime(kw.latestScrapedAt) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {data.keywords.length === 0 && (
        <p style={{ color: "#737373", textAlign: "center", marginTop: 48 }}>
          No current listing data yet. Data will appear after the bot starts scanning.
        </p>
      )}
    </div>
  );
}

const thStyle: React.CSSProperties = { padding: "8px 12px", fontWeight: 600, color: "#a3a3a3" };
const thStyleRight: React.CSSProperties = { ...thStyle, textAlign: "right" };
const tdStyle: React.CSSProperties = { padding: "8px 12px" };
const tdStyleRight: React.CSSProperties = { ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" };
