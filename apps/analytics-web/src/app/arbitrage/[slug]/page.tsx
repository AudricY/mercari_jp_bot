import Link from "next/link";
import { notFound } from "next/navigation";

import {
  getArbitrageProduct,
  type ArbitrageEconomics,
  type ArbitrageFx,
} from "@/lib/api";
import { requireAnalyticsSession } from "@/lib/auth";
import { formatDateTime, formatPct, formatPrice, formatSignedUsd, formatUsd } from "@/lib/format";
import { FxFeeNote } from "@/components/ArbitrageFxFeeNote";
import { VerdictBadge } from "@/components/VerdictBadge";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ slug: string }>;
}

export default async function ArbitrageProductPage({ params }: Props) {
  await requireAnalyticsSession();
  const { slug } = await params;

  let data;
  try {
    data = await getArbitrageProduct(slug);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("API 404")) {
      notFound();
    }
    throw error;
  }

  const { product, mercari, ebay, economics } = data;

  const mercariTiles = [
    { label: "Live Listings", value: mercari.liveCount != null ? mercari.liveCount.toLocaleString() : "—" },
    { label: "Cheapest Live", value: mercari.cheapestLiveJpy != null ? formatPrice(mercari.cheapestLiveJpy) : "—" },
    { label: "Median Live", value: mercari.medianLiveJpy != null ? formatPrice(mercari.medianLiveJpy) : "—" },
    { label: "Median Sold", value: mercari.medianSoldJpy != null ? formatPrice(mercari.medianSoldJpy) : "—" },
    { label: "Sold 30d", value: mercari.soldCount30d != null ? mercari.soldCount30d.toLocaleString() : "—" },
  ];

  const ebayTiles = [
    { label: "Live Listings", value: ebay.liveCount != null ? ebay.liveCount.toLocaleString() : "—" },
    { label: "Lowest Live", value: ebay.lowestLiveUsd != null ? formatUsd(ebay.lowestLiveUsd) : "—" },
    { label: "Median Live", value: ebay.medianLiveUsd != null ? formatUsd(ebay.medianLiveUsd) : "—" },
    { label: "Gone 30d", value: ebay.goneCount30d != null ? ebay.goneCount30d.toLocaleString() : "—" },
  ];

  return (
    <div>
      <Link href="/arbitrage" style={{ color: "#60a5fa", textDecoration: "none", fontSize: 14 }}>
        &larr; Arbitrage Opportunities
      </Link>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", margin: "12px 0 8px" }}>
        <h1 style={{ fontSize: 24, margin: 0 }}>{product.label}</h1>
        <VerdictBadge verdict={data.verdict} />
      </div>
      <p style={{ color: "#a3a3a3", marginBottom: 8, fontSize: 14 }}>
        {product.platform} &middot; {product.kind} &middot; ships as {product.shippingClass.replace(/_/g, " ")}
        {product.notes ? <> &middot; {product.notes}</> : null}
      </p>
      <FxFeeNote fx={data.fx} feeModel={data.feeModel} generatedAt={data.generatedAt} />

      <EconomicsCard economics={economics} fx={data.fx} />

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 18, marginBottom: 12 }}>Mercari JP</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12, marginBottom: 24 }}>
          {mercariTiles.map((t) => (
            <StatTile key={t.label} label={t.label} value={t.value} />
          ))}
        </div>

        <h3 style={{ fontSize: 15, marginBottom: 12, color: "#a3a3a3" }}>Cheapest Live Listings</h3>
        {data.mercariLive.length === 0 ? (
          <p style={{ color: "#737373", fontSize: 14 }}>No live Mercari listings tracked.</p>
        ) : (
          <div style={{ overflowX: "auto", marginBottom: 24 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #262626", textAlign: "left" }}>
                  <th style={thStyle}>Image</th>
                  <th style={thStyle}>Title</th>
                  <th style={thStyleRight}>Price</th>
                  <th style={thStyleRight}>Landed $</th>
                  <th style={thStyleRight}>Margin $</th>
                  <th style={thStyleRight}>ROI %</th>
                  <th style={thStyleRight}>Listed</th>
                </tr>
              </thead>
              <tbody>
                {data.mercariLive.map((l) => (
                  <tr key={l.url} style={{ borderBottom: "1px solid #1a1a1a" }}>
                    <td style={tdStyle}>
                      {l.thumbnailUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={l.thumbnailUrl} alt="" width={48} height={48} style={{ borderRadius: 4, objectFit: "cover" }} />
                      ) : (
                        <div style={{ width: 48, height: 48, borderRadius: 4, background: "#1a1a1a" }} />
                      )}
                    </td>
                    <td style={tdStyle}>
                      <ExternalLink href={l.url} title={l.title} />
                    </td>
                    <td style={tdStyleRight}>{formatPrice(l.priceJpy)}</td>
                    <td style={tdStyleRight}>{l.landedCostUsd != null ? formatUsd(l.landedCostUsd) : "—"}</td>
                    <td style={{ ...tdStyleRight, color: marginColor(l.marginUsd) }}>
                      {l.marginUsd != null ? formatSignedUsd(l.marginUsd) : "—"}
                    </td>
                    <td style={{ ...tdStyleRight, color: marginColor(l.roiPct) }}>
                      {l.roiPct != null ? formatPct(l.roiPct) : "—"}
                    </td>
                    <td style={{ ...tdStyleRight, color: "#a3a3a3" }}>{l.listedAt ? formatDateTime(l.listedAt) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <h3 style={{ fontSize: 15, marginBottom: 12, color: "#a3a3a3" }}>Recently Sold</h3>
        {data.mercariRecentSold.length === 0 ? (
          <p style={{ color: "#737373", fontSize: 14 }}>No recent Mercari sales observed.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #262626", textAlign: "left" }}>
                  <th style={thStyle}>Title</th>
                  <th style={thStyleRight}>Sold Price</th>
                  <th style={thStyleRight}>Sold</th>
                </tr>
              </thead>
              <tbody>
                {data.mercariRecentSold.map((l) => (
                  <tr key={l.url} style={{ borderBottom: "1px solid #1a1a1a" }}>
                    <td style={tdStyle}>
                      <ExternalLink href={l.url} title={l.title} />
                    </td>
                    <td style={tdStyleRight}>{formatPrice(l.soldPriceJpy)}</td>
                    <td style={{ ...tdStyleRight, color: "#a3a3a3" }}>
                      {l.soldObservedAt ? formatDateTime(l.soldObservedAt) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 18, marginBottom: 12 }}>eBay US</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12, marginBottom: 24 }}>
          {ebayTiles.map((t) => (
            <StatTile key={t.label} label={t.label} value={t.value} />
          ))}
        </div>

        <h3 style={{ fontSize: 15, marginBottom: 12, color: "#a3a3a3" }}>Cheapest Live Comps</h3>
        {data.ebayLive.length === 0 ? (
          <p style={{ color: "#737373", fontSize: 14 }}>No live eBay comps tracked.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #262626", textAlign: "left" }}>
                  <th style={thStyle}>Image</th>
                  <th style={thStyle}>Title</th>
                  <th style={thStyleRight}>Price</th>
                  <th style={thStyle}>Condition</th>
                  <th style={thStyleRight}>Listed</th>
                </tr>
              </thead>
              <tbody>
                {data.ebayLive.map((l) => (
                  <tr key={l.url} style={{ borderBottom: "1px solid #1a1a1a" }}>
                    <td style={tdStyle}>
                      {l.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={l.imageUrl} alt="" width={48} height={48} style={{ borderRadius: 4, objectFit: "cover" }} />
                      ) : (
                        <div style={{ width: 48, height: 48, borderRadius: 4, background: "#1a1a1a" }} />
                      )}
                    </td>
                    <td style={tdStyle}>
                      <ExternalLink href={l.url} title={l.title} />
                    </td>
                    <td style={tdStyleRight}>{formatUsd(l.priceUsd)}</td>
                    <td style={tdStyle}>{l.condition ?? "—"}</td>
                    <td style={{ ...tdStyleRight, color: "#a3a3a3" }}>{l.listedAt ? formatDateTime(l.listedAt) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function EconomicsCard({ economics, fx }: { economics: ArbitrageEconomics | null; fx: ArbitrageFx }) {
  if (!economics) {
    return (
      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 18, marginBottom: 12 }}>Economics</h2>
        <div style={cardStyle}>
          <p style={{ color: "#737373", fontSize: 14, margin: 0 }}>
            Not enough data to compute economics — one side of the market has no priced listings yet.
          </p>
        </div>
      </section>
    );
  }

  const e = economics;
  const buyUsd = e.buyJpy / fx.jpyPerUsd;
  const acquisitionCostsUsd = e.landedCostUsd - buyUsd;
  const sellingFeesUsd = e.listPriceUsd - e.netProceedsUsd;

  const lines: { label: string; detail: string; value: string; color?: string }[] = [
    {
      label: "Buy price",
      detail: `cheapest live Mercari listing (${formatUsd(buyUsd)} at current FX)`,
      value: formatPrice(e.buyJpy),
    },
    {
      label: "Landed cost",
      detail: `buy + proxy, JP domestic and intl shipping (+${formatUsd(acquisitionCostsUsd)})`,
      value: formatUsd(e.landedCostUsd),
    },
    {
      label: "List price",
      detail: "median live eBay comp",
      value: formatUsd(e.listPriceUsd),
    },
    {
      label: "Net proceeds",
      detail: `after eBay final value, fixed and ad fees (−${formatUsd(sellingFeesUsd)})`,
      value: formatUsd(e.netProceedsUsd),
    },
    {
      label: "Margin",
      detail: "net proceeds − landed cost",
      value: formatSignedUsd(e.marginUsd),
      color: marginColor(e.marginUsd),
    },
  ];

  return (
    <section style={{ marginBottom: 32 }}>
      <h2 style={{ fontSize: 18, marginBottom: 12 }}>Economics</h2>
      <div style={{ ...cardStyle, maxWidth: 640 }}>
        {lines.map((line, i) => (
          <div
            key={line.label}
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              gap: 16,
              padding: "10px 0",
              borderTop: i > 0 ? "1px solid #262626" : undefined,
            }}
          >
            <div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{line.label}</div>
              <div style={{ color: "#737373", fontSize: 12 }}>{line.detail}</div>
            </div>
            <div style={{ fontSize: 16, fontWeight: 600, fontVariantNumeric: "tabular-nums", color: line.color, whiteSpace: "nowrap" }}>
              {line.value}
            </div>
          </div>
        ))}
        <div style={{ borderTop: "1px solid #262626", paddingTop: 12, marginTop: 2, display: "flex", gap: 24, flexWrap: "wrap" }}>
          <SmallStat label="ROI" value={formatPct(e.roiPct)} color={marginColor(e.roiPct)} />
          <SmallStat label="Max buy (target ROI)" value={e.maxBuyJpy != null ? formatPrice(e.maxBuyJpy) : "—"} />
          <SmallStat label="Breakeven buy" value={e.breakevenBuyJpy != null ? formatPrice(e.breakevenBuyJpy) : "—"} />
        </div>
      </div>
    </section>
  );
}

function SmallStat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <div style={{ color: "#737373", fontSize: 12, marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 600, fontVariantNumeric: "tabular-nums", color }}>{value}</div>
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: "#141414", border: "1px solid #262626", borderRadius: 8, padding: "12px 16px" }}>
      <div style={{ color: "#737373", fontSize: 12, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{value}</div>
    </div>
  );
}

function ExternalLink({ href, title }: { href: string; title: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: "#60a5fa", textDecoration: "none" }}>
      {title.length > 60 ? `${title.slice(0, 60)}...` : title}
    </a>
  );
}

function marginColor(value: number | null | undefined): string | undefined {
  if (value == null) return undefined;
  return value > 0 ? "#4ade80" : value < 0 ? "#f87171" : undefined;
}

const cardStyle: React.CSSProperties = {
  background: "#141414",
  border: "1px solid #262626",
  borderRadius: 8,
  padding: "8px 20px 16px",
};

const thStyle: React.CSSProperties = { padding: "8px 12px", fontWeight: 600, color: "#a3a3a3" };
const thStyleRight: React.CSSProperties = { ...thStyle, textAlign: "right" };
const tdStyle: React.CSSProperties = { padding: "8px 12px" };
const tdStyleRight: React.CSSProperties = { ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" };
