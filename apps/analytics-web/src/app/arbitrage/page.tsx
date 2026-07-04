import Link from "next/link";

import { getArbitrageOpportunities } from "@/lib/api";
import { requireAnalyticsSession } from "@/lib/auth";
import { formatPrice, formatPct, formatSignedUsd, formatUsd } from "@/lib/format";
import { FxFeeNote } from "@/components/ArbitrageFxFeeNote";
import { VerdictBadge } from "@/components/VerdictBadge";

export const dynamic = "force-dynamic";

interface Props {
  searchParams: Promise<{ sort?: string }>;
}

const SORTS = ["roi", "margin"] as const;

export default async function ArbitragePage({ searchParams }: Props) {
  await requireAnalyticsSession();
  const sp = await searchParams;
  const sort = SORTS.includes(sp.sort as (typeof SORTS)[number])
    ? (sp.sort as (typeof SORTS)[number])
    : "roi";
  const data = await getArbitrageOpportunities({ sort });

  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap", marginBottom: 8 }}>
        <div>
          <h1 style={{ fontSize: 24, marginBottom: 8, marginTop: 0 }}>Arbitrage Opportunities</h1>
          <p style={{ color: "#a3a3a3", fontSize: 14, margin: 0 }}>
            Mercari JP buy &rarr; eBay US resell &middot; {data.opportunities.length} products
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ color: "#737373", fontSize: 13 }}>Sort by</span>
          {SORTS.map((s) => (
            <Link
              key={s}
              href={`/arbitrage?sort=${s}`}
              style={{
                padding: "4px 12px",
                borderRadius: 4,
                background: sort === s ? "#3b82f6" : "#1a1a1a",
                color: sort === s ? "#fff" : "#a3a3a3",
                textDecoration: "none",
                fontSize: 13,
              }}
            >
              {s === "roi" ? "ROI" : "Margin"}
            </Link>
          ))}
        </div>
      </div>

      <FxFeeNote fx={data.fx} feeModel={data.feeModel} generatedAt={data.generatedAt} />

      {data.opportunities.length === 0 ? (
        <p style={{ color: "#737373", textAlign: "center", marginTop: 48 }}>
          No arbitrage products configured yet.
        </p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #262626", textAlign: "left" }}>
                <th style={thStyle}>Product</th>
                <th style={thStyle}>Verdict</th>
                <th style={thStyleRight}>Cheapest Live &yen;</th>
                <th style={thStyleRight}>Median Sold &yen;</th>
                <th style={thStyleRight}>Sold 30d</th>
                <th style={thStyleRight}>eBay Median $</th>
                <th style={thStyleRight}>eBay Live</th>
                <th style={thStyleRight}>Margin $</th>
                <th style={thStyleRight}>ROI %</th>
                <th style={thStyleRight}>Max Buy &yen;</th>
              </tr>
            </thead>
            <tbody>
              {data.opportunities.map((o) => (
                <tr key={o.slug} style={{ borderBottom: "1px solid #1a1a1a" }}>
                  <td style={tdStyle}>
                    <Link href={`/arbitrage/${o.slug}`} style={{ color: "#60a5fa", textDecoration: "none" }}>
                      {o.label}
                    </Link>
                    <span style={{ color: "#737373", marginLeft: 8, fontSize: 12 }}>{o.platform}</span>
                  </td>
                  <td style={tdStyle}>
                    <VerdictBadge verdict={o.verdict} />
                  </td>
                  <td style={tdStyleRight}>
                    {o.mercari.cheapestLiveJpy != null ? formatPrice(o.mercari.cheapestLiveJpy) : "—"}
                  </td>
                  <td style={tdStyleRight}>
                    {o.mercari.medianSoldJpy != null ? formatPrice(o.mercari.medianSoldJpy) : "—"}
                  </td>
                  <td style={tdStyleRight}>
                    {o.mercari.soldCount30d != null ? o.mercari.soldCount30d.toLocaleString() : "—"}
                  </td>
                  <td style={tdStyleRight}>
                    {o.ebay.medianLiveUsd != null ? formatUsd(o.ebay.medianLiveUsd) : "—"}
                  </td>
                  <td style={tdStyleRight}>
                    {o.ebay.liveCount != null ? o.ebay.liveCount.toLocaleString() : "—"}
                  </td>
                  <td style={{ ...tdStyleRight, color: marginColor(o.economics?.marginUsd) }}>
                    {o.economics != null ? formatSignedUsd(o.economics.marginUsd) : "—"}
                  </td>
                  <td style={{ ...tdStyleRight, color: marginColor(o.economics?.roiPct) }}>
                    {o.economics != null ? formatPct(o.economics.roiPct) : "—"}
                  </td>
                  <td style={tdStyleRight}>
                    {o.economics?.maxBuyJpy != null ? formatPrice(o.economics.maxBuyJpy) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function marginColor(value: number | null | undefined): string | undefined {
  if (value == null) return undefined;
  return value > 0 ? "#4ade80" : value < 0 ? "#f87171" : undefined;
}

const thStyle: React.CSSProperties = { padding: "8px 12px", fontWeight: 600, color: "#a3a3a3" };
const thStyleRight: React.CSSProperties = { ...thStyle, textAlign: "right" };
const tdStyle: React.CSSProperties = { padding: "8px 12px" };
const tdStyleRight: React.CSSProperties = { ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" };
