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
    headers: {
      Authorization: `Bearer ${API_TOKEN}`,
      "X-Forwarded-For": "127.0.0.1",
    },
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
  listingCount: number;
  medianPrice: number;
  minPrice: number;
  maxPrice: number;
  latestScrapedAt: string | null;
}

export interface ItemSummary {
  itemId: string;
  itemSlug: string;
  itemName: string;
  kind: string;
  platform: string;
  listingCount: number;
  medianPrice: number;
  minPrice: number;
  maxPrice: number;
  latestScrapedAt: string | null;
  targetBuyPrice: number | null;
  belowTargetCount: number;
  cheapestVsTarget: number | null;
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
  listingCount: number;
  minPrice: number;
  medianPrice: number;
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
  scrapedAt: string;
  itemSubfamily?: string | null;
}

export type MarketListingStatus = "on_sale" | "trading" | "sold" | "gone";

export interface MarketCategory {
  categoryId: number;
  label: string;
  platform: string;
  kind: string;
  onSaleCount: number;
  sold7dCount: number;
  sold30dCount: number;
  askingMedianPrice: number | null;
  soldMedianPrice: number | null;
  medianSpread: number | null;
  lastSnapshotAt: string | null;
  lastSoldSweepAt: string | null;
  lastNewSweepAt: string | null;
}

export interface MarketTimeseriesPoint {
  periodStart: string;
  onSaleCount: number;
  newListingCount: number;
  soldCount: number;
  askingMedianPrice: number | null;
  soldMedianPrice: number | null;
}

export interface MarketListing {
  mercariId: string;
  url: string;
  title: string;
  price: number;
  status: MarketListingStatus;
  conditionId: number | null;
  thumbnailUrl: string | null;
  listedAt: string | null;
  soldPrice: number | null;
  soldObservedAt: string | null;
  categoryId: number;
}

export function getMarketCategories() {
  return apiFetch<{ categories: MarketCategory[] }>(
    "/v1/analytics/market/categories",
  );
}

export function getMarketPriceDistribution(
  id: string,
  params?: { status?: string; days?: string; buckets?: string },
) {
  return apiFetch<{
    categoryId: number;
    label: string;
    platform: string;
    kind: string;
    status: string;
    days: number;
    stats: PriceStats;
    histogram: HistogramBucket[];
  }>(`/v1/analytics/market/categories/${id}/price-distribution`, params);
}

export function getMarketTimeseries(
  id: string,
  params?: { from?: string; to?: string; granularity?: string },
) {
  return apiFetch<{
    categoryId: number;
    label: string;
    granularity: string;
    series: MarketTimeseriesPoint[];
  }>(`/v1/analytics/market/categories/${id}/timeseries`, params);
}

export function getMarketListings(
  id: string,
  params?: { status?: string; sort?: string; q?: string; limit?: string; offset?: string },
) {
  return apiFetch<{
    categoryId: number;
    label: string;
    status: string;
    sort: string;
    q: string;
    total: number;
    listings: MarketListing[];
  }>(`/v1/analytics/market/categories/${id}/listings`, params);
}

export function searchMarketListings(params: {
  q: string;
  status?: string;
  limit?: string;
  offset?: string;
}) {
  return apiFetch<{
    q: string;
    status: string;
    total: number;
    askingStats: PriceStats | null;
    soldStats: PriceStats | null;
    listings: MarketListing[];
  }>("/v1/analytics/market/search", params);
}

export function getItems() {
  return apiFetch<{ items: ItemSummary[] }>(
    "/v1/analytics/items",
  );
}

export function getKeywords() {
  return apiFetch<{ keywords: KeywordSummary[] }>(
    "/v1/analytics/keywords",
  );
}

export function getItemPriceDistribution(id: string, buckets?: string) {
  return apiFetch<{
    itemId: string;
    itemSlug: string;
    itemName: string;
    targetBuyPrice: number | null;
    belowTargetCount: number;
    cheapestVsTarget: number | null;
    stats: PriceStats;
    histogram: HistogramBucket[];
  }>(`/v1/analytics/items/${id}/price-distribution`, { buckets });
}

export function getPriceDistribution(id: string, buckets?: string) {
  return apiFetch<{
    keywordId: string;
    keywordName: string;
    stats: PriceStats;
    histogram: HistogramBucket[];
  }>(`/v1/analytics/keywords/${id}/price-distribution`, { buckets });
}

export function getItemTimeseries(id: string, from?: string, to?: string, granularity?: string) {
  return apiFetch<{
    itemId: string;
    itemSlug: string;
    itemName: string;
    granularity: string;
    targetBuyPrice: number | null;
    series: TimeseriesPoint[];
  }>(`/v1/analytics/items/${id}/timeseries`, { from, to, granularity });
}

export function getTimeseries(id: string, from?: string, to?: string, granularity?: string) {
  return apiFetch<{
    keywordId: string;
    keywordName: string;
    granularity: string;
    series: TimeseriesPoint[];
  }>(`/v1/analytics/keywords/${id}/timeseries`, { from, to, granularity });
}

export function getItemListings(id: string, params?: { sort?: string; limit?: string; offset?: string }) {
  return apiFetch<{
    itemId: string;
    itemSlug: string;
    itemName: string;
    targetBuyPrice: number | null;
    sort: string;
    total: number;
    listings: ListingItem[];
  }>(`/v1/analytics/items/${id}/listings`, params);
}

export function getListings(id: string, params?: { sort?: string; limit?: string; offset?: string }) {
  return apiFetch<{
    keywordId: string;
    keywordName: string;
    sort: string;
    total: number;
    listings: ListingItem[];
  }>(`/v1/analytics/keywords/${id}/listings`, params);
}
