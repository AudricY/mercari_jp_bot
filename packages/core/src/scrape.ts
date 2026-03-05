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

export async function scanMercariTerm(params: {
  term: string;
  filters: ScanFilters;
  timeoutMs: number;
  maxItems: number;
}): Promise<ScrapedListing[]> {
  const body = {
    userId: "",
    pageSize: params.maxItems,
    pageToken: "",
    searchSessionId: crypto.randomUUID().replace(/-/g, ""),
    indexRouting: "INDEX_ROUTING_UNSPECIFIED",
    thumbnailTypes: [],
    searchCondition: {
      keyword: params.term,
      excludeKeyword: params.filters.excludeKeyword ?? "",
      sort: "SORT_CREATED_TIME",
      order: "ORDER_DESC",
      status: ["STATUS_ON_SALE"],
      sizeId: [],
      categoryId: params.filters.categoryId.length > 0 ? params.filters.categoryId : [],
      brandId: [],
      sellerId: [],
      priceMin: params.filters.priceMin ?? 0,
      priceMax: params.filters.priceMax ?? 0,
      itemConditionId: [],
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
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      "X-Platform": "web",
      DPoP: dpopToken,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(params.timeoutMs),
  });

  if (!response.ok) {
    throw new Error(`Mercari API responded with ${response.status}: ${await response.text()}`);
  }

  const data = (await response.json()) as {
    items?: Array<Record<string, unknown>>;
  };

  const items = data.items ?? [];
  const parsed: ScrapedListing[] = [];

  for (const item of items) {
    const name = item.name as string;
    const id = item.id as string;
    const price = item.price as number;
    const thumbnails = item.thumbnails as string[] | undefined;

    if (!applyListingFilters({ title: name }, params.filters)) {
      continue;
    }

    parsed.push({
      title: name,
      url: `https://jp.mercari.com/item/${id}`,
      imageUrl: thumbnails?.[0] ?? "",
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
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      "X-Platform": "web",
      DPoP: dpopToken,
    },
    signal: AbortSignal.timeout(params.timeoutMs),
  });

  if (!response.ok) {
    throw new Error(`Mercari item detail API responded with ${response.status}: ${await response.text()}`);
  }

  const data = await response.json();
  return JSON.stringify(data);
}
