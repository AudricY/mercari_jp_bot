import type { MarketListing, MarketListingStatus } from "@/lib/api";
import { formatPrice, formatDateTime } from "@/lib/format";
import { ASKING_COLOR, SOLD_COLOR } from "@/lib/market-colors";

const STATUS_LABELS: Record<MarketListingStatus, string> = {
  on_sale: "On sale",
  trading: "Trading",
  sold: "Sold",
  gone: "Gone",
};

const STATUS_COLORS: Record<MarketListingStatus, string> = {
  on_sale: ASKING_COLOR,
  trading: "#a3a3a3",
  sold: SOLD_COLOR,
  gone: "#737373",
};

export function StatusBadge({ status }: { status: MarketListingStatus }) {
  const color = STATUS_COLORS[status] ?? "#737373";
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 999,
        border: `1px solid ${color}`,
        color,
        fontSize: 12,
        whiteSpace: "nowrap",
      }}
    >
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

interface Props {
  listings: MarketListing[];
  showStatus?: boolean;
  showSold?: boolean;
  emptyMessage?: string;
}

export function MarketListingsTable({ listings, showStatus = false, showSold = false, emptyMessage }: Props) {
  if (listings.length === 0) {
    return <p style={{ color: "#737373", fontSize: 14 }}>{emptyMessage ?? "No listings found."}</p>;
  }

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
        <thead>
          <tr style={{ borderBottom: "1px solid #262626", textAlign: "left" }}>
            <th style={thStyle}>Image</th>
            <th style={thStyle}>Title</th>
            {showStatus && <th style={thStyle}>Status</th>}
            <th style={thStyleRight}>Price</th>
            {showSold && <th style={thStyleRight}>Sold Price</th>}
            {showSold && <th style={thStyleRight}>Sold</th>}
            <th style={thStyleRight}>Listed</th>
          </tr>
        </thead>
        <tbody>
          {listings.map((l) => (
            <tr key={l.mercariId} style={{ borderBottom: "1px solid #1a1a1a" }}>
              <td style={tdStyle}>
                {l.thumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={l.thumbnailUrl} alt="" width={48} height={48} style={{ borderRadius: 4, objectFit: "cover" }} />
                ) : (
                  <div style={{ width: 48, height: 48, borderRadius: 4, background: "#1a1a1a" }} />
                )}
              </td>
              <td style={tdStyle}>
                <a href={l.url} target="_blank" rel="noopener noreferrer" style={{ color: "#60a5fa", textDecoration: "none" }}>
                  {l.title.length > 60 ? `${l.title.slice(0, 60)}...` : l.title}
                </a>
              </td>
              {showStatus && (
                <td style={tdStyle}>
                  <StatusBadge status={l.status} />
                </td>
              )}
              <td style={tdStyleRight}>{formatPrice(l.price)}</td>
              {showSold && (
                <td style={tdStyleRight}>{l.soldPrice != null ? formatPrice(l.soldPrice) : "—"}</td>
              )}
              {showSold && (
                <td style={{ ...tdStyleRight, color: "#a3a3a3" }}>
                  {l.soldObservedAt ? formatDateTime(l.soldObservedAt) : "—"}
                </td>
              )}
              <td style={{ ...tdStyleRight, color: "#a3a3a3" }}>
                {l.listedAt ? formatDateTime(l.listedAt) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const thStyle: React.CSSProperties = { padding: "8px 12px", fontWeight: 600, color: "#a3a3a3" };
const thStyleRight: React.CSSProperties = { ...thStyle, textAlign: "right" };
const tdStyle: React.CSSProperties = { padding: "8px 12px" };
const tdStyleRight: React.CSSProperties = { ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" };
