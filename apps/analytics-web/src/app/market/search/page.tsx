import { searchMarketListings, type PriceStats } from "@/lib/api";
import { requireAnalyticsSession } from "@/lib/auth";
import { formatPrice } from "@/lib/format";
import { ASKING_COLOR, SOLD_COLOR } from "@/lib/market-colors";
import { MarketListingsTable } from "@/components/MarketListingsTable";

export const dynamic = "force-dynamic";

interface Props {
  searchParams: Promise<{ q?: string; status?: string }>;
}

const STATUSES = ["all", "on_sale", "sold"] as const;

export default async function MarketSearchPage({ searchParams }: Props) {
  await requireAnalyticsSession();
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const status = STATUSES.includes(sp.status as (typeof STATUSES)[number])
    ? (sp.status as (typeof STATUSES)[number])
    : "all";
  const canSearch = q.length >= 2;

  const results = canSearch
    ? await searchMarketListings({ q, status, limit: "50" })
    : null;

  return (
    <div>
      <h1 style={{ fontSize: 24, marginBottom: 8 }}>Market Search</h1>
      <p style={{ color: "#a3a3a3", marginBottom: 24, fontSize: 14 }}>
        Search tracked market listings by title
      </p>

      <form method="get" style={{ display: "flex", gap: 8, marginBottom: 32, flexWrap: "wrap" }}>
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="e.g. zelda, ポケモン"
          style={{
            padding: "8px 12px",
            borderRadius: 6,
            border: "1px solid #404040",
            background: "#141414",
            color: "#e5e5e5",
            fontSize: 14,
            width: 300,
          }}
        />
        <select
          name="status"
          defaultValue={status}
          style={{
            padding: "8px 12px",
            borderRadius: 6,
            border: "1px solid #404040",
            background: "#141414",
            color: "#e5e5e5",
            fontSize: 14,
          }}
        >
          <option value="all">All statuses</option>
          <option value="on_sale">On sale</option>
          <option value="sold">Sold</option>
        </select>
        <button
          type="submit"
          style={{
            padding: "8px 16px",
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

      {!canSearch && (
        <p style={{ color: "#737373", textAlign: "center", marginTop: 48 }}>
          {q.length === 0
            ? "Enter a search term to explore market listings."
            : "Enter at least 2 characters to search."}
        </p>
      )}

      {results && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16, marginBottom: 32 }}>
            <StatsCard title="Asking (on sale)" color={ASKING_COLOR} stats={results.askingStats} />
            <StatsCard title="Sold" color={SOLD_COLOR} stats={results.soldStats} />
          </div>

          <h2 style={{ fontSize: 18, marginBottom: 12 }}>
            Results
            <span style={{ color: "#737373", fontSize: 13, fontWeight: 400, marginLeft: 8 }}>
              {results.total.toLocaleString()} matching &ldquo;{results.q}&rdquo;
            </span>
          </h2>
          <MarketListingsTable
            listings={results.listings}
            showStatus
            showSold
            emptyMessage={`No listings matching "${results.q}".`}
          />
        </>
      )}
    </div>
  );
}

function StatsCard({ title, color, stats }: { title: string; color: string; stats: PriceStats | null }) {
  const hasData = stats != null && stats.count > 0;

  const cells = [
    { label: "Count", value: hasData ? stats.count.toLocaleString() : "—" },
    { label: "Median", value: hasData ? formatPrice(stats.median) : "—" },
    { label: "P25", value: hasData ? formatPrice(stats.p25) : "—" },
    { label: "P75", value: hasData ? formatPrice(stats.p75) : "—" },
  ];

  return (
    <div style={{ background: "#141414", border: "1px solid #262626", borderRadius: 8, padding: "16px 20px" }}>
      <div style={{ color: "#a3a3a3", fontSize: 14, marginBottom: 12, fontWeight: 600 }}>
        <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 2, background: color, marginRight: 8 }} />
        {title}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
        {cells.map((c) => (
          <div key={c.label}>
            <div style={{ color: "#737373", fontSize: 12, marginBottom: 4 }}>{c.label}</div>
            <div style={{ fontSize: 16, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{c.value}</div>
          </div>
        ))}
      </div>
      {!hasData && (
        <p style={{ color: "#737373", fontSize: 12, marginTop: 12, marginBottom: 0 }}>No data for this segment.</p>
      )}
    </div>
  );
}
