import { generateDPoPToken } from "./dpop.js";

interface ScanFilters {
  priceMin: number | null;
  priceMax: number | null;
  titleMustContain: string[];
  excludeKeyword: string | null;
  categoryId: number[];
}

export interface ScrapedListing {
  title: string;
  url: string;
  imageUrl: string;
  currency: string;
  numericPrice: number;
  rawPriceDisplay: string;
  rawJson: string;
}

function applyListingFilters(listing: { title: string }, filters: ScanFilters): boolean {
  const titleLower = listing.title.toLowerCase();

  if (filters.titleMustContain.length > 0) {
    const hasRequiredTerm = filters.titleMustContain.some((term) => titleLower.includes(term.toLowerCase()));
    if (!hasRequiredTerm) {
      return false;
    }
  }

  if (filters.excludeKeyword && titleLower.includes(filters.excludeKeyword.toLowerCase())) {
    return false;
  }

  return true;
}

const API_URL = "https://api.mercari.jp/v2/entities:search";
const MERCARI_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export class MercariApiError extends Error {
  constructor(
    message: string,
    readonly endpoint: "search" | "detail",
    readonly statusCode: number,
    readonly responseBody: string,
  ) {
    super(message);
    this.name = "MercariApiError";
  }
}

export type MercariSearchStatus = "STATUS_ON_SALE" | "STATUS_SOLD_OUT" | "STATUS_TRADING";
export type MercariSearchSort = "SORT_SCORE" | "SORT_CREATED_TIME" | "SORT_PRICE" | "SORT_NUM_LIKES";
export type MercariSearchOrder = "ORDER_DESC" | "ORDER_ASC";

export interface MercariSearchParams {
  keyword?: string;
  excludeKeyword?: string;
  categoryId?: number[];
  status?: MercariSearchStatus[];
  sort?: MercariSearchSort;
  order?: MercariSearchOrder;
  priceMin?: number | null;
  priceMax?: number | null;
  itemConditionId?: number[];
  pageSize?: number;
  pageToken?: string;
  timeoutMs?: number;
}

/** Raw search hit. Numeric-looking fields arrive as strings from the API. */
export interface MercariSearchItem {
  id: string;
  sellerId?: string;
  buyerId?: string;
  status?: string;
  name: string;
  price: string | number;
  created?: string;
  updated?: string;
  categoryId?: string;
  itemConditionId?: string;
  shippingPayerId?: string;
  shippingMethodId?: string;
  itemType?: string;
  thumbnails?: string[];
  [key: string]: unknown;
}

export interface MercariSearchResult {
  items: MercariSearchItem[];
  numFound: number | null;
  nextPageToken: string;
}

/**
 * Low-level Mercari search. Single page per call; pass back `nextPageToken`
 * (format "v1:<page>") to paginate. Max pageSize observed working: 120.
 */
export async function searchMercari(params: MercariSearchParams): Promise<MercariSearchResult> {
  const body = {
    userId: "",
    pageSize: params.pageSize ?? 120,
    pageToken: params.pageToken ?? "",
    searchSessionId: crypto.randomUUID().replace(/-/g, ""),
    indexRouting: "INDEX_ROUTING_UNSPECIFIED",
    thumbnailTypes: [],
    searchCondition: {
      keyword: params.keyword ?? "",
      excludeKeyword: params.excludeKeyword ?? "",
      sort: params.sort ?? "SORT_CREATED_TIME",
      order: params.order ?? "ORDER_DESC",
      status: params.status ?? ["STATUS_ON_SALE"],
      sizeId: [],
      categoryId: params.categoryId ?? [],
      brandId: [],
      sellerId: [],
      priceMin: params.priceMin ?? 0,
      priceMax: params.priceMax ?? 0,
      itemConditionId: params.itemConditionId ?? [],
      shippingPayerId: [],
      shippingFromArea: [],
      shippingMethod: [],
      colorId: [],
      hasCoupon: false,
      attributes: [],
      itemTypes: [],
      skuIds: [],
    },
    defaultDatasets: [],
    serviceFrom: "suruga",
    withItemBrand: true,
    withItemSize: false,
    withItemPromotions: true,
    withItemSizes: true,
    withShopname: false,
  };

  const dpopToken = await generateDPoPToken(API_URL, "POST");

  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": MERCARI_USER_AGENT,
      "X-Platform": "web",
      DPoP: dpopToken,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(params.timeoutMs ?? 15000),
  });

  if (!response.ok) {
    const responseBody = await response.text();
    throw new MercariApiError(
      `Mercari API responded with ${response.status}: ${responseBody}`,
      "search",
      response.status,
      responseBody,
    );
  }

  const data = (await response.json()) as {
    items?: MercariSearchItem[];
    meta?: { nextPageToken?: string; numFound?: string | number };
  };

  const numFoundRaw = data.meta?.numFound;
  return {
    items: data.items ?? [],
    numFound: numFoundRaw === undefined ? null : Number(numFoundRaw),
    nextPageToken: data.meta?.nextPageToken ?? "",
  };
}

export async function scanMercariTerm(params: {
  term: string;
  filters: ScanFilters;
  timeoutMs: number;
  maxItems: number;
}): Promise<ScrapedListing[]> {
  const { items } = await searchMercari({
    keyword: params.term,
    excludeKeyword: params.filters.excludeKeyword ?? "",
    categoryId: params.filters.categoryId,
    status: ["STATUS_ON_SALE"],
    sort: "SORT_CREATED_TIME",
    order: "ORDER_DESC",
    priceMin: params.filters.priceMin,
    priceMax: params.filters.priceMax,
    pageSize: params.maxItems,
    timeoutMs: params.timeoutMs,
  });

  const parsed: ScrapedListing[] = [];

  for (const item of items) {
    const name = item.name;
    const price = Number(item.price);

    if (!applyListingFilters({ title: name }, params.filters)) {
      continue;
    }

    parsed.push({
      title: name,
      url: `https://jp.mercari.com/item/${item.id}`,
      imageUrl: item.thumbnails?.[0] ?? "",
      currency: "¥",
      numericPrice: price,
      rawPriceDisplay: `¥${price.toLocaleString()}`,
      rawJson: JSON.stringify(item),
    });
  }

  return parsed;
}

const ITEM_DETAIL_URL = "https://api.mercari.jp/items/get";

export async function fetchMercariItemDetail(params: {
  itemId: string;
  timeoutMs: number;
}): Promise<string> {
  const dpopToken = await generateDPoPToken(ITEM_DETAIL_URL, "GET");

  const url = `${ITEM_DETAIL_URL}?id=${encodeURIComponent(params.itemId)}`;
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      "User-Agent": MERCARI_USER_AGENT,
      "X-Platform": "web",
      DPoP: dpopToken,
    },
    signal: AbortSignal.timeout(params.timeoutMs),
  });

  if (!response.ok) {
    const responseBody = await response.text();
    throw new MercariApiError(
      `Mercari item detail API responded with ${response.status}: ${responseBody}`,
      "detail",
      response.status,
      responseBody,
    );
  }

  const data = await response.json();
  return JSON.stringify(data);
}
