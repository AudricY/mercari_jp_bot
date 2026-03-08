const API_BASE = process.env.ANALYTICS_API_URL ?? "http://localhost:3000";
const API_TOKEN = process.env.ADMIN_TOKEN ?? "";

async function apiFetch<T>(path: string, params?: Record<string, string | undefined>): Promise<T> {
  const url = new URL(path, API_BASE);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined) url.searchParams.set(k, v);
    }
  }

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${API_TOKEN}` },
    next: { revalidate: 60 },
  });

  if (!res.ok) {
    throw new Error(`API ${res.status}: ${await res.text()}`);
  }

  return res.json() as Promise<T>;
}

export interface KeywordSummary {
  keywordId: string;
  keywordName: string;
  observationCount: number;
  uniqueListingCount: number;
  medianPrice: number;
  minPrice: number;
  maxPrice: number;
  latestObservedAt: string | null;
}

export interface PriceStats {
  count: number;
  min: number;
  p25: number;
  median: number;
  p75: number;
  max: number;
  mean: number;
}

export interface HistogramBucket {
  bucketMin: number;
  bucketMax: number;
  count: number;
}

export interface TimeseriesPoint {
  periodStart: string;
  observationCount: number;
  uniqueListingCount: number;
  minPrice: number;
  medianPrice: number;
  p75Price: number;
  maxPrice: number;
}

export interface ListingItem {
  id: string;
  sourceListingId: string | null;
  title: string;
  url: string;
  imageUrl: string;
  price: number;
  currency: string;
  observedAt: string;
}

export function getKeywords(from?: string, to?: string) {
  return apiFetch<{ keywords: KeywordSummary[]; from: string; to: string }>(
    "/v1/analytics/keywords",
    { from, to },
  );
}

export function getPriceDistribution(id: string, from?: string, to?: string, buckets?: string) {
  return apiFetch<{
    keywordId: string;
    keywordName: string;
    stats: PriceStats;
    histogram: HistogramBucket[];
  }>(`/v1/analytics/keywords/${id}/price-distribution`, { from, to, buckets });
}

export function getTimeseries(id: string, from?: string, to?: string, granularity?: string) {
  return apiFetch<{
    keywordId: string;
    keywordName: string;
    granularity: string;
    series: TimeseriesPoint[];
  }>(`/v1/analytics/keywords/${id}/timeseries`, { from, to, granularity });
}

export function getListings(id: string, params?: { from?: string; to?: string; sort?: string; limit?: string; offset?: string }) {
  return apiFetch<{
    keywordId: string;
    keywordName: string;
    sort: string;
    total: number;
    listings: ListingItem[];
  }>(`/v1/analytics/keywords/${id}/listings`, params);
}
