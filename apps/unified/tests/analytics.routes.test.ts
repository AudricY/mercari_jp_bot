import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestContext, isoDate, uniqueId } from "./test-env.js";

const DAY_MS = 24 * 60 * 60 * 1000;

describe("analytics routes", () => {
  let ctx: Awaited<ReturnType<typeof createTestContext>>;
  let activeKeywordId: string;
  let emptyKeywordId: string;
  let disabledKeywordId: string;
  let mostRecentScrapedAt: string;

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

    const now = Date.now();
    const recentDates = [
      new Date(now - DAY_MS),
      new Date(now - 2 * DAY_MS),
      new Date(now - 3 * DAY_MS),
    ];
    mostRecentScrapedAt = recentDates[0]!.toISOString();

    await ctx.prisma.listing.createMany({
      data: [
        {
          id: uniqueId("listing"),
          keywordId: activeKeywordId,
          sourceListingId: "m-1",
          title: "PS Vita Aqua Blue",
          url: "https://jp.mercari.com/item/m-1",
          imageUrl: "https://example.com/1.jpg",
          currency: "¥",
          numericPrice: 100,
          rawPriceDisplay: "¥100",
          rawJson: "{}",
          scrapedAt: recentDates[1]!,
        },
        {
          id: uniqueId("listing"),
          keywordId: activeKeywordId,
          sourceListingId: "m-2",
          title: "PS Vita Black",
          url: "https://jp.mercari.com/item/m-2",
          imageUrl: "https://example.com/2.jpg",
          currency: "¥",
          numericPrice: 200,
          rawPriceDisplay: "¥200",
          rawJson: "{}",
          scrapedAt: recentDates[0]!,
        },
        {
          id: uniqueId("listing"),
          keywordId: activeKeywordId,
          sourceListingId: "m-3",
          title: "PS Vita White",
          url: "https://jp.mercari.com/item/m-3",
          imageUrl: "https://example.com/3.jpg",
          currency: "¥",
          numericPrice: 300,
          rawPriceDisplay: "¥300",
          rawJson: "{}",
          scrapedAt: recentDates[2]!,
        },
        {
          id: uniqueId("listing"),
          keywordId: activeKeywordId,
          sourceListingId: "m-stale",
          title: "Stale Vita",
          url: "https://jp.mercari.com/item/m-stale",
          imageUrl: "https://example.com/stale.jpg",
          currency: "¥",
          numericPrice: 999,
          rawPriceDisplay: "¥999",
          rawJson: "{}",
          scrapedAt: new Date(now - 10 * DAY_MS),
        },
        {
          id: uniqueId("listing"),
          keywordId: disabledKeywordId,
          sourceListingId: "m-disabled",
          title: "Disabled listing",
          url: "https://jp.mercari.com/item/m-disabled",
          imageUrl: "https://example.com/disabled.jpg",
          currency: "¥",
          numericPrice: 500,
          rawPriceDisplay: "¥500",
          rawJson: "{}",
          scrapedAt: recentDates[0]!,
        },
      ],
    });

    await ctx.prisma.dailyKeywordMarketStat.createMany({
      data: [
        {
          dateUtc: isoDate("2026-03-01T00:00:00.000Z"),
          keywordId: activeKeywordId,
          listingCount: 1,
          minPrice: 100,
          medianPrice: 100,
          maxPrice: 100,
          latestScrapedAt: isoDate("2026-03-01T08:00:00.000Z"),
        },
        {
          dateUtc: isoDate("2026-03-03T00:00:00.000Z"),
          keywordId: activeKeywordId,
          listingCount: 2,
          minPrice: 200,
          medianPrice: 250,
          maxPrice: 300,
          latestScrapedAt: isoDate("2026-03-03T08:00:00.000Z"),
        },
        {
          dateUtc: isoDate("2026-03-10T00:00:00.000Z"),
          keywordId: activeKeywordId,
          listingCount: 1,
          minPrice: 400,
          medianPrice: 400,
          maxPrice: 400,
          latestScrapedAt: isoDate("2026-03-10T08:00:00.000Z"),
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

  it("returns current snapshot aggregates for enabled keywords", async () => {
    const response = await ctx.app.inject({
      method: "GET",
      url: "/v1/analytics/keywords",
      headers: ctx.authHeaders(),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      keywords: Array<{
        keywordId: string;
        keywordName: string;
        listingCount: number;
        medianPrice: number;
        minPrice: number;
        maxPrice: number;
        latestScrapedAt: string | null;
      }>;
    };

    expect(body.keywords).toHaveLength(2);

    const active = body.keywords.find((keyword) => keyword.keywordId === activeKeywordId);
    expect(active).toEqual({
      keywordId: activeKeywordId,
      keywordName: "PS Vita",
      listingCount: 3,
      medianPrice: 200,
      minPrice: 100,
      maxPrice: 300,
      latestScrapedAt: mostRecentScrapedAt,
    });

    const empty = body.keywords.find((keyword) => keyword.keywordId === emptyKeywordId);
    expect(empty).toEqual({
      keywordId: emptyKeywordId,
      keywordName: "Nintendo 3DS",
      listingCount: 0,
      medianPrice: 0,
      minPrice: 0,
      maxPrice: 0,
      latestScrapedAt: null,
    });
  });

  it("returns histogram and stats for current price distribution", async () => {
    const response = await ctx.app.inject({
      method: "GET",
      url: `/v1/analytics/keywords/${activeKeywordId}/price-distribution?buckets=5`,
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
      count: 3,
      min: 100,
      p25: 150,
      median: 200,
      p75: 250,
      max: 300,
      mean: 200,
    });
    expect(body.histogram).toHaveLength(5);
    expect(body.histogram.reduce((sum, bucket) => sum + bucket.count, 0)).toBe(3);
  });

  it("returns empty stats and histogram for a keyword with no current listings", async () => {
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

  it("groups market stats time series by day, week, and month", async () => {
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
        listingCount: number;
        minPrice: number;
        medianPrice: number;
        maxPrice: number;
      }>;
    };
    expect(dayBody.granularity).toBe("day");
    expect(dayBody.series).toEqual([
      {
        periodStart: "2026-03-01",
        listingCount: 1,
        minPrice: 100,
        medianPrice: 100,
        maxPrice: 100,
      },
      {
        periodStart: "2026-03-03",
        listingCount: 2,
        minPrice: 200,
        medianPrice: 250,
        maxPrice: 300,
      },
      {
        periodStart: "2026-03-10",
        listingCount: 1,
        minPrice: 400,
        medianPrice: 400,
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
        listingCount: number;
        minPrice: number;
        medianPrice: number;
        maxPrice: number;
      }>;
    };
    expect(weekBody.granularity).toBe("week");
    expect(weekBody.series).toEqual([
      {
        periodStart: "2026-02-23",
        listingCount: 1,
        minPrice: 100,
        medianPrice: 100,
        maxPrice: 100,
      },
      {
        periodStart: "2026-03-02",
        listingCount: 2,
        minPrice: 200,
        medianPrice: 250,
        maxPrice: 300,
      },
      {
        periodStart: "2026-03-09",
        listingCount: 1,
        minPrice: 400,
        medianPrice: 400,
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
        listingCount: number;
        minPrice: number;
        medianPrice: number;
        maxPrice: number;
      }>;
    };
    expect(monthBody.granularity).toBe("month");
    expect(monthBody.series).toEqual([
      {
        periodStart: "2026-03-01",
        listingCount: 4,
        minPrice: 100,
        medianPrice: 250,
        maxPrice: 400,
      },
    ]);
  });

  it("returns current listings sorted by newest and cheapest with pagination", async () => {
    const newestResponse = await ctx.app.inject({
      method: "GET",
      url: `/v1/analytics/keywords/${activeKeywordId}/listings?sort=newest&limit=2&offset=1`,
      headers: ctx.authHeaders(),
    });
    expect(newestResponse.statusCode).toBe(200);
    const newestBody = newestResponse.json() as {
      total: number;
      sort: string;
      listings: Array<{ sourceListingId: string | null; price: number; scrapedAt: string }>;
    };
    expect(newestBody.total).toBe(3);
    expect(newestBody.sort).toBe("newest");
    expect(newestBody.listings).toHaveLength(2);
    expect(newestBody.listings.map((listing) => listing.sourceListingId)).toEqual(["m-1", "m-3"]);

    const cheapestResponse = await ctx.app.inject({
      method: "GET",
      url: `/v1/analytics/keywords/${activeKeywordId}/listings?sort=cheapest&limit=3`,
      headers: ctx.authHeaders(),
    });
    expect(cheapestResponse.statusCode).toBe(200);
    const cheapestBody = cheapestResponse.json() as {
      total: number;
      sort: string;
      listings: Array<{ sourceListingId: string | null; price: number }>;
    };
    expect(cheapestBody.total).toBe(3);
    expect(cheapestBody.sort).toBe("cheapest");
    expect(cheapestBody.listings.map((listing) => listing.price)).toEqual([100, 200, 300]);
  });
});
