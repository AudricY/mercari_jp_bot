import { generateDPoPToken } from "./dpop.js";

interface ScanFilters {
  priceMin: number | null;
  priceMax: number | null;
  titleMustContain: string[];
  excludeKeyword: string | null;
}

export interface ScrapedListing {
  title: string;
  url: string;
  imageUrl: string;
  currency: string;
  numericPrice: number;
  rawPriceDisplay: string;
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
      categoryId: [],
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
    items?: Array<{
      id: string;
      name: string;
      price: number;
      thumbnails: string[];
    }>;
  };

  const items = data.items ?? [];
  const parsed: ScrapedListing[] = [];

  for (const item of items) {
    if (!applyListingFilters({ title: item.name }, params.filters)) {
      continue;
    }

    parsed.push({
      title: item.name,
      url: `https://jp.mercari.com/item/${item.id}`,
      imageUrl: item.thumbnails?.[0] ?? "",
      currency: "¥",
      numericPrice: item.price,
      rawPriceDisplay: `¥${item.price.toLocaleString()}`,
    });
  }

  return parsed;
}
