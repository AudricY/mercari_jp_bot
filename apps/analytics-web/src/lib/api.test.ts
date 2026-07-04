import { afterEach, describe, expect, it, vi } from "vitest";

describe("analytics api client", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    delete process.env.ADMIN_TOKEN;
    delete process.env.ANALYTICS_API_URL;
  });

  it("sends the bearer token and forwarded-for header", async () => {
    process.env.ADMIN_TOKEN = "test-admin-token";
    process.env.ANALYTICS_API_URL = "http://app:3000";

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ keywords: [], from: "", to: "" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { getKeywords } = await import("./api");
    await getKeywords();

    expect(fetchMock).toHaveBeenCalledWith(
      "http://app:3000/v1/analytics/keywords",
      expect.objectContaining({
        headers: {
          Authorization: "Bearer test-admin-token",
          "X-Forwarded-For": "127.0.0.1",
        },
      }),
    );
  });

  it("calls the market categories endpoint with auth headers", async () => {
    process.env.ADMIN_TOKEN = "test-admin-token";
    process.env.ANALYTICS_API_URL = "http://app:3000";

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ categories: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { getMarketCategories } = await import("./api");
    await getMarketCategories();

    expect(fetchMock).toHaveBeenCalledWith(
      "http://app:3000/v1/analytics/market/categories",
      expect.objectContaining({
        headers: {
          Authorization: "Bearer test-admin-token",
          "X-Forwarded-For": "127.0.0.1",
        },
      }),
    );
  });

  it("builds market listings query params and omits undefined ones", async () => {
    process.env.ADMIN_TOKEN = "test-admin-token";
    process.env.ANALYTICS_API_URL = "http://app:3000";

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ listings: [], total: 0 }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { getMarketListings } = await import("./api");
    await getMarketListings("5", { status: "sold", sort: "recently_sold", limit: "10", q: undefined });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://app:3000/v1/analytics/market/categories/5/listings?status=sold&sort=recently_sold&limit=10",
      expect.any(Object),
    );
  });

  it("calls the market search endpoint with query params", async () => {
    process.env.ADMIN_TOKEN = "test-admin-token";
    process.env.ANALYTICS_API_URL = "http://app:3000";

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ q: "zelda", status: "sold", total: 0, askingStats: null, soldStats: null, listings: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { searchMarketListings } = await import("./api");
    await searchMarketListings({ q: "zelda", status: "sold", limit: "50" });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://app:3000/v1/analytics/market/search?q=zelda&status=sold&limit=50",
      expect.any(Object),
    );
  });

  it("calls the market price distribution and timeseries endpoints", async () => {
    process.env.ADMIN_TOKEN = "test-admin-token";
    process.env.ANALYTICS_API_URL = "http://app:3000";

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { getMarketPriceDistribution, getMarketTimeseries } = await import("./api");
    await getMarketPriceDistribution("7", { status: "on_sale", days: "30", buckets: "20" });
    await getMarketTimeseries("7", { granularity: "week" });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "http://app:3000/v1/analytics/market/categories/7/price-distribution?status=on_sale&days=30&buckets=20",
      expect.any(Object),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://app:3000/v1/analytics/market/categories/7/timeseries?granularity=week",
      expect.any(Object),
    );
  });

  it("calls the item overview endpoint", async () => {
    process.env.ADMIN_TOKEN = "test-admin-token";
    process.env.ANALYTICS_API_URL = "http://app:3000";

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ items: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { getItems } = await import("./api");
    await getItems();

    expect(fetchMock).toHaveBeenCalledWith(
      "http://app:3000/v1/analytics/items",
      expect.any(Object),
    );
  });
});
