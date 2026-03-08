import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestContext, isoDate, uniqueId } from "./test-env.js";

describe("analytics routes", () => {
  let ctx: Awaited<ReturnType<typeof createTestContext>>;
  let activeKeywordId: string;
  let emptyKeywordId: string;
  let disabledKeywordId: string;

  beforeAll(async () => {
    ctx = await createTestContext();

    const activeKeyword = await ctx.prisma.keyword.create({
      data: {
        id: uniqueId("kw"),
        name: "PS Vita",
        enabled: true,
        terms: ["vita"],
        filters: {},
        intervalSec: 60,
      },
    });
    activeKeywordId = activeKeyword.id;

    const emptyKeyword = await ctx.prisma.keyword.create({
      data: {
        id: uniqueId("kw"),
        name: "Nintendo 3DS",
        enabled: true,
        terms: ["3ds"],
        filters: {},
        intervalSec: 60,
      },
    });
    emptyKeywordId = emptyKeyword.id;

    await ctx.prisma.keyword.create({
      data: {
        id: uniqueId("kw"),
        name: "Disabled",
        enabled: false,
        terms: ["disabled"],
        filters: {},
        intervalSec: 60,
      },
    }).then((keyword) => {
      disabledKeywordId = keyword.id;
    });

    await ctx.prisma.listingObservation.createMany({
      data: [
        {
          id: uniqueId("obs"),
          keywordId: activeKeywordId,
          listingId: null,
          sourceListingId: "m-1",
          listingUrl: "https://jp.mercari.com/item/m-1",
          title: "PS Vita Aqua Blue",
          imageUrl: "https://example.com/1.jpg",
          currency: "¥",
          numericPrice: 100,
          rawPriceDisplay: "¥100",
          observedAt: isoDate("2026-03-01T08:00:00.000Z"),
        },
        {
          id: uniqueId("obs"),
          keywordId: activeKeywordId,
          listingId: null,
          sourceListingId: "m-1",
          listingUrl: "https://jp.mercari.com/item/m-1",
          title: "PS Vita Aqua Blue",
          imageUrl: "https://example.com/1.jpg",
          currency: "¥",
          numericPrice: 200,
          rawPriceDisplay: "¥200",
          observedAt: isoDate("2026-03-03T08:00:00.000Z"),
        },
        {
          id: uniqueId("obs"),
          keywordId: activeKeywordId,
          listingId: null,
          sourceListingId: "m-2",
          listingUrl: "https://jp.mercari.com/item/m-2",
          title: "PS Vita Black",
          imageUrl: "https://example.com/2.jpg",
          currency: "¥",
          numericPrice: 300,
          rawPriceDisplay: "¥300",
          observedAt: isoDate("2026-03-04T08:00:00.000Z"),
        },
        {
          id: uniqueId("obs"),
          keywordId: activeKeywordId,
          listingId: null,
          sourceListingId: "m-3",
          listingUrl: "https://jp.mercari.com/item/m-3",
          title: "PS Vita White",
          imageUrl: "https://example.com/3.jpg",
          currency: "¥",
          numericPrice: 400,
          rawPriceDisplay: "¥400",
          observedAt: isoDate("2026-03-10T08:00:00.000Z"),
        },
        {
          id: uniqueId("obs"),
          keywordId: disabledKeywordId,
          listingId: null,
          sourceListingId: "m-disabled",
          listingUrl: "https://jp.mercari.com/item/m-disabled",
          title: "Disabled listing",
          imageUrl: "https://example.com/disabled.jpg",
          currency: "¥",
          numericPrice: 999,
          rawPriceDisplay: "¥999",
          observedAt: isoDate("2026-03-05T08:00:00.000Z"),
        },
      ],
    });
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it("enforces auth on analytics endpoints", async () => {
    const missing = await ctx.app.inject({
      method: "GET",
      url: "/v1/analytics/keywords",
    });
    expect(missing.statusCode).toBe(401);

    const wrongToken = await ctx.app.inject({
      method: "GET",
      url: "/v1/analytics/keywords",
      headers: {
        authorization: "Bearer wrong-token",
        "x-forwarded-for": "127.0.0.1",
      },
    });
    expect(wrongToken.statusCode).toBe(401);

    const badIp = await ctx.app.inject({
      method: "GET",
      url: "/v1/analytics/keywords",
      headers: ctx.authHeaders("10.0.0.4"),
    });
    expect(badIp.statusCode).toBe(403);
  });

  it("returns overview aggregates for enabled keywords within a date range", async () => {
    const response = await ctx.app.inject({
      method: "GET",
      url: "/v1/analytics/keywords?from=2026-03-01T00:00:00.000Z&to=2026-03-31T23:59:59.999Z",
      headers: ctx.authHeaders(),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      keywords: Array<{
        keywordId: string;
        observationCount: number;
        uniqueListingCount: number;
        medianPrice: number;
        minPrice: number;
        maxPrice: number;
        latestObservedAt: string | null;
      }>;
    };

    expect(body.keywords).toHaveLength(2);

    const active = body.keywords.find((keyword) => keyword.keywordId === activeKeywordId);
    expect(active).toEqual({
      keywordId: activeKeywordId,
      keywordName: "PS Vita",
      observationCount: 4,
      uniqueListingCount: 3,
      medianPrice: 250,
      minPrice: 100,
      maxPrice: 400,
      latestObservedAt: "2026-03-10T08:00:00.000Z",
    });

    const empty = body.keywords.find((keyword) => keyword.keywordId === emptyKeywordId);
    expect(empty).toEqual({
      keywordId: emptyKeywordId,
      keywordName: "Nintendo 3DS",
      observationCount: 0,
      uniqueListingCount: 0,
      medianPrice: 0,
      minPrice: 0,
      maxPrice: 0,
      latestObservedAt: null,
    });
  });

  it("returns histogram and stats for price distribution", async () => {
    const response = await ctx.app.inject({
      method: "GET",
      url: `/v1/analytics/keywords/${activeKeywordId}/price-distribution?from=2026-03-01T00:00:00.000Z&to=2026-03-31T23:59:59.999Z&buckets=5`,
      headers: ctx.authHeaders(),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      stats: {
        count: number;
        min: number;
        p25: number;
        median: number;
        p75: number;
        max: number;
        mean: number;
      };
      histogram: Array<{ bucketMin: number; bucketMax: number; count: number }>;
    };

    expect(body.stats).toEqual({
      count: 4,
      min: 100,
      p25: 175,
      median: 250,
      p75: 325,
      max: 400,
      mean: 250,
    });
    expect(body.histogram).toHaveLength(5);
    expect(body.histogram.reduce((sum, bucket) => sum + bucket.count, 0)).toBe(4);
    expect(body.histogram.map((bucket) => bucket.count)).toEqual([1, 1, 0, 1, 1]);
  });

  it("returns empty stats and histogram for a keyword with no observations", async () => {
    const response = await ctx.app.inject({
      method: "GET",
      url: `/v1/analytics/keywords/${emptyKeywordId}/price-distribution`,
      headers: ctx.authHeaders(),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      stats: {
        count: number;
        min: number;
        p25: number;
        median: number;
        p75: number;
        max: number;
        mean: number;
      };
      histogram: unknown[];
    };

    expect(body.stats).toEqual({
      count: 0,
      min: 0,
      p25: 0,
      median: 0,
      p75: 0,
      max: 0,
      mean: 0,
    });
    expect(body.histogram).toEqual([]);
  });

  it("returns 404 for unknown keyword analytics routes", async () => {
    const response = await ctx.app.inject({
      method: "GET",
      url: `/v1/analytics/keywords/${uniqueId("missing")}/timeseries`,
      headers: ctx.authHeaders(),
    });

    expect(response.statusCode).toBe(404);
  });

  it("groups time series by day, week, and month", async () => {
    const dayResponse = await ctx.app.inject({
      method: "GET",
      url: `/v1/analytics/keywords/${activeKeywordId}/timeseries?from=2026-03-01T00:00:00.000Z&to=2026-03-31T23:59:59.999Z&granularity=day`,
      headers: ctx.authHeaders(),
    });
    expect(dayResponse.statusCode).toBe(200);
    const dayBody = dayResponse.json() as {
      granularity: string;
      series: Array<{
        periodStart: string;
        observationCount: number;
        uniqueListingCount: number;
        minPrice: number;
        medianPrice: number;
        p75Price: number;
        maxPrice: number;
      }>;
    };
    expect(dayBody.granularity).toBe("day");
    expect(dayBody.series).toEqual([
      {
        periodStart: "2026-03-01",
        observationCount: 1,
        uniqueListingCount: 1,
        minPrice: 100,
        medianPrice: 100,
        p75Price: 100,
        maxPrice: 100,
      },
      {
        periodStart: "2026-03-03",
        observationCount: 1,
        uniqueListingCount: 1,
        minPrice: 200,
        medianPrice: 200,
        p75Price: 200,
        maxPrice: 200,
      },
      {
        periodStart: "2026-03-04",
        observationCount: 1,
        uniqueListingCount: 1,
        minPrice: 300,
        medianPrice: 300,
        p75Price: 300,
        maxPrice: 300,
      },
      {
        periodStart: "2026-03-10",
        observationCount: 1,
        uniqueListingCount: 1,
        minPrice: 400,
        medianPrice: 400,
        p75Price: 400,
        maxPrice: 400,
      },
    ]);

    const weekResponse = await ctx.app.inject({
      method: "GET",
      url: `/v1/analytics/keywords/${activeKeywordId}/timeseries?from=2026-03-01T00:00:00.000Z&to=2026-03-31T23:59:59.999Z&granularity=week`,
      headers: ctx.authHeaders(),
    });
    expect(weekResponse.statusCode).toBe(200);
    const weekBody = weekResponse.json() as {
      granularity: string;
      series: Array<{
        periodStart: string;
        observationCount: number;
        uniqueListingCount: number;
        minPrice: number;
        medianPrice: number;
        p75Price: number;
        maxPrice: number;
      }>;
    };
    expect(weekBody.granularity).toBe("week");
    expect(weekBody.series).toEqual([
      {
        periodStart: "2026-02-23",
        observationCount: 1,
        uniqueListingCount: 1,
        minPrice: 100,
        medianPrice: 100,
        p75Price: 100,
        maxPrice: 100,
      },
      {
        periodStart: "2026-03-02",
        observationCount: 2,
        uniqueListingCount: 2,
        minPrice: 200,
        medianPrice: 250,
        p75Price: 275,
        maxPrice: 300,
      },
      {
        periodStart: "2026-03-09",
        observationCount: 1,
        uniqueListingCount: 1,
        minPrice: 400,
        medianPrice: 400,
        p75Price: 400,
        maxPrice: 400,
      },
    ]);

    const monthResponse = await ctx.app.inject({
      method: "GET",
      url: `/v1/analytics/keywords/${activeKeywordId}/timeseries?from=2026-03-01T00:00:00.000Z&to=2026-03-31T23:59:59.999Z&granularity=month`,
      headers: ctx.authHeaders(),
    });
    expect(monthResponse.statusCode).toBe(200);
    const monthBody = monthResponse.json() as {
      granularity: string;
      series: Array<{
        periodStart: string;
        observationCount: number;
        uniqueListingCount: number;
        minPrice: number;
        medianPrice: number;
        p75Price: number;
        maxPrice: number;
      }>;
    };
    expect(monthBody.granularity).toBe("month");
    expect(monthBody.series).toEqual([
      {
        periodStart: "2026-03-01",
        observationCount: 4,
        uniqueListingCount: 3,
        minPrice: 100,
        medianPrice: 250,
        p75Price: 325,
        maxPrice: 400,
      },
    ]);
  });

  it("returns listings sorted by newest and cheapest with pagination", async () => {
    const newestResponse = await ctx.app.inject({
      method: "GET",
      url: `/v1/analytics/keywords/${activeKeywordId}/listings?from=2026-03-01T00:00:00.000Z&to=2026-03-31T23:59:59.999Z&sort=newest&limit=2&offset=1`,
      headers: ctx.authHeaders(),
    });
    expect(newestResponse.statusCode).toBe(200);
    const newestBody = newestResponse.json() as {
      total: number;
      sort: string;
      listings: Array<{ sourceListingId: string | null; price: number; observedAt: string }>;
    };
    expect(newestBody.total).toBe(4);
    expect(newestBody.sort).toBe("newest");
    expect(newestBody.listings).toHaveLength(2);
    expect(newestBody.listings.map((listing) => listing.sourceListingId)).toEqual(["m-2", "m-1"]);

    const cheapestResponse = await ctx.app.inject({
      method: "GET",
      url: `/v1/analytics/keywords/${activeKeywordId}/listings?from=2026-03-01T00:00:00.000Z&to=2026-03-31T23:59:59.999Z&sort=cheapest&limit=3`,
      headers: ctx.authHeaders(),
    });
    expect(cheapestResponse.statusCode).toBe(200);
    const cheapestBody = cheapestResponse.json() as {
      total: number;
      sort: string;
      listings: Array<{ sourceListingId: string | null; price: number }>;
    };
    expect(cheapestBody.total).toBe(4);
    expect(cheapestBody.sort).toBe("cheapest");
    expect(cheapestBody.listings.map((listing) => listing.price)).toEqual([100, 200, 300]);
  });
});
