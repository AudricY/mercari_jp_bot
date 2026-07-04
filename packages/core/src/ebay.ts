const EBAY_API_BASES = {
  production: "https://api.ebay.com",
  sandbox: "https://api.sandbox.ebay.com",
} as const;

const OAUTH_SCOPE = "https://api.ebay.com/oauth/api_scope";

/** Refresh the app token this many ms before eBay says it expires. */
const TOKEN_EXPIRY_SLACK_MS = 60_000;

export type EbayEnvironment = keyof typeof EBAY_API_BASES;
export type EbayEndpoint = "token" | "search";

export class EbayApiError extends Error {
  constructor(
    message: string,
    readonly endpoint: EbayEndpoint,
    readonly statusCode: number,
    readonly responseBody: string,
  ) {
    super(message);
    this.name = "EbayApiError";
  }
}

export type EbaySearchSort = "newlyListed" | "endingSoonest" | "price" | "-price";

export interface EbaySearchParams {
  /** Free-text query. At least one of `q` / `categoryIds` is required by eBay. */
  q?: string;
  /** eBay marketplace category ids (strings, e.g. "139973" = Video Games). */
  categoryIds?: string[];
  /** Raw Browse API filter expression, e.g. "buyingOptions:{FIXED_PRICE},price:[10..500],priceCurrency:USD". */
  filter?: string;
  sort?: EbaySearchSort;
  /** Page size; Browse API max is 200. */
  limit?: number;
  /** Result offset; eBay rejects offset+limit > 10000. */
  offset?: number;
  /** Per-request marketplace override; defaults to the client's marketplace. */
  marketplaceId?: string;
  timeoutMs?: number;
}

/** Subset of the Browse API itemSummary we rely on; everything else passes through. */
export interface EbayItemSummary {
  itemId: string;
  title: string;
  price?: { value: string; currency: string };
  itemWebUrl?: string;
  image?: { imageUrl: string };
  condition?: string;
  conditionId?: string;
  buyingOptions?: string[];
  seller?: { username?: string; feedbackPercentage?: string; feedbackScore?: number };
  itemCreationDate?: string;
  legacyItemId?: string;
  categories?: { categoryId: string; categoryName?: string }[];
  [key: string]: unknown;
}

export interface EbaySearchResult {
  items: EbayItemSummary[];
  /** Total matches eBay reports for the query (capped pagination at 10k). */
  total: number;
  offset: number;
  limit: number;
  /** True when eBay reports another page (`next` link present). */
  hasMore: boolean;
}

export interface EbayClientOptions {
  clientId: string;
  clientSecret: string;
  /** e.g. "EBAY_US" (default), "EBAY_GB", "EBAY_DE". */
  marketplaceId?: string;
  environment?: EbayEnvironment;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/**
 * Minimal eBay Buy Browse API client using the OAuth2 client-credentials
 * flow (application token, no user consent needed for item_summary/search).
 * The token is cached and refreshed transparently; a 401 mid-flight retries
 * once with a fresh token.
 */
export class EbayClient {
  private readonly apiBase: string;
  private readonly marketplaceId: string;
  private readonly defaultTimeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  private accessToken: string | null = null;
  private tokenExpiresAtMs = 0;
  private tokenRefresh: Promise<string> | null = null;

  constructor(private readonly options: EbayClientOptions) {
    if (!options.clientId || !options.clientSecret) {
      throw new Error("EbayClient requires clientId and clientSecret");
    }
    this.apiBase = EBAY_API_BASES[options.environment ?? "production"];
    this.marketplaceId = options.marketplaceId ?? "EBAY_US";
    this.defaultTimeoutMs = options.timeoutMs ?? 15000;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  /** Single page of Browse API item_summary/search. */
  async search(params: EbaySearchParams): Promise<EbaySearchResult> {
    if (!params.q && (!params.categoryIds || params.categoryIds.length === 0)) {
      throw new Error("eBay search requires q and/or categoryIds");
    }

    const query = new URLSearchParams();
    if (params.q) {
      query.set("q", params.q);
    }
    if (params.categoryIds && params.categoryIds.length > 0) {
      query.set("category_ids", params.categoryIds.join(","));
    }
    if (params.filter) {
      query.set("filter", params.filter);
    }
    if (params.sort) {
      query.set("sort", params.sort);
    }
    query.set("limit", String(params.limit ?? 200));
    query.set("offset", String(params.offset ?? 0));

    const url = `${this.apiBase}/buy/browse/v1/item_summary/search?${query.toString()}`;
    const timeoutMs = params.timeoutMs ?? this.defaultTimeoutMs;

    const marketplaceId = params.marketplaceId ?? this.marketplaceId;
    let response = await this.searchRequest(url, marketplaceId, timeoutMs);
    if (response.status === 401) {
      // Token expired or revoked server-side; refresh once and retry.
      this.accessToken = null;
      response = await this.searchRequest(url, marketplaceId, timeoutMs);
    }

    if (!response.ok) {
      const responseBody = await response.text();
      throw new EbayApiError(
        `eBay Browse API responded with ${response.status}: ${responseBody}`,
        "search",
        response.status,
        responseBody,
      );
    }

    const data = (await response.json()) as {
      itemSummaries?: EbayItemSummary[];
      total?: number;
      offset?: number;
      limit?: number;
      next?: string;
    };

    return {
      items: data.itemSummaries ?? [],
      total: data.total ?? 0,
      offset: data.offset ?? params.offset ?? 0,
      limit: data.limit ?? params.limit ?? 200,
      hasMore: Boolean(data.next),
    };
  }

  private async searchRequest(url: string, marketplaceId: string, timeoutMs: number): Promise<Response> {
    const token = await this.getAppToken(timeoutMs);
    return this.fetchImpl(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "X-EBAY-C-MARKETPLACE-ID": marketplaceId,
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
  }

  private async getAppToken(timeoutMs: number): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiresAtMs - TOKEN_EXPIRY_SLACK_MS) {
      return this.accessToken;
    }
    // Coalesce concurrent refreshes into one token request.
    this.tokenRefresh ??= this.fetchAppToken(timeoutMs).finally(() => {
      this.tokenRefresh = null;
    });
    return this.tokenRefresh;
  }

  private async fetchAppToken(timeoutMs: number): Promise<string> {
    const basic = Buffer.from(`${this.options.clientId}:${this.options.clientSecret}`).toString("base64");
    const response = await this.fetchImpl(`${this.apiBase}/identity/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ grant_type: "client_credentials", scope: OAUTH_SCOPE }).toString(),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      const responseBody = await response.text();
      throw new EbayApiError(
        `eBay OAuth token endpoint responded with ${response.status}: ${responseBody}`,
        "token",
        response.status,
        responseBody,
      );
    }

    const data = (await response.json()) as { access_token?: string; expires_in?: number };
    if (!data.access_token) {
      throw new EbayApiError("eBay OAuth token response missing access_token", "token", response.status, "");
    }

    this.accessToken = data.access_token;
    this.tokenExpiresAtMs = Date.now() + (data.expires_in ?? 7200) * 1000;
    return this.accessToken;
  }
}

export function ebayStatusCode(error: unknown): number | null {
  if (error instanceof EbayApiError) {
    return error.statusCode;
  }
  if (error instanceof Error) {
    const match = error.message.match(/responded with (\d{3})/);
    return match?.[1] ? Number.parseInt(match[1], 10) : null;
  }
  return null;
}
