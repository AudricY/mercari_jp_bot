import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestContext, uniqueId } from "./test-env.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW_SEC = Math.floor(Date.now() / 1000);

describe("market analytics routes", () => {
  let ctx: Awaited<ReturnType<typeof createTestContext>>;

  beforeAll(async () => {
    ctx = await createTestContext();

    await ctx.prisma.marketCategory.createMany({
      data: [
        { id: 7091, label: "PS3 本体", platform: "PS3", kind: "console", enabled: true },
        { id: 702, label: "Switch ソフト", platform: "Nintendo Switch", kind: "software", enabled: true },
        { id: 9999, label: "Disabled", platform: "None", kind: "other", enabled: false },
      ],
    });

    const yesterday = new Date(Date.now() - DAY_MS);
    await ctx.prisma.marketListing.createMany({
      data: [
        {
          id: uniqueId("ml"),
          mercariId: "m-on-1",
          categoryId: 7091,
          title: "PS3 本体 CECH-3000",
          price: 8000,
          status: "on_sale",
          conditionId: 3,
          mercariCreatedSec: NOW_SEC - 3600,
          mercariUpdatedSec: NOW_SEC - 3600,
          firstSeenAt: new Date(),
          lastSeenAt: new Date(),
        },
        {
          id: uniqueId("ml"),
          mercariId: "m-on-2",
          categoryId: 7091,
          title: "PS3 本体 ジャンク",
          price: 4000,
          status: "on_sale",
          conditionId: 6,
          mercariCreatedSec: NOW_SEC - 7200,
          mercariUpdatedSec: NOW_SEC - 7200,
          firstSeenAt: new Date(),
          lastSeenAt: new Date(),
        },
        {
          id: uniqueId("ml"),
          mercariId: "m-sold-1",
          categoryId: 7091,
          title: "PS3 本体 美品",
          price: 9000,
          status: "sold_out",
          conditionId: 2,
          mercariCreatedSec: NOW_SEC - 86400 * 3,
          mercariUpdatedSec: NOW_SEC - 86400,
          soldPrice: 9000,
          soldObservedAt: yesterday,
          firstSeenAt: yesterday,
          lastSeenAt: yesterday,
        },
        {
          id: uniqueId("ml"),
          mercariId: "m-switch-1",
          categoryId: 702,
          title: "ゼルダの伝説 ティアーズ オブ ザ キングダム",
          price: 4300,
          status: "on_sale",
          conditionId: 3,
          mercariCreatedSec: NOW_SEC - 1800,
          mercariUpdatedSec: NOW_SEC - 1800,
          firstSeenAt: new Date(),
          lastSeenAt: new Date(),
        },
      ],
    });

    const dateUtc = new Date(`${new Date(Date.now() - DAY_MS).toISOString().slice(0, 10)}T00:00:00.000Z`);
    await ctx.prisma.dailyCategoryMarketStat.create({
      data: {
        dateUtc,
        categoryId: 7091,
        onSaleCount: 2,
        newListingCount: 1,
        soldCount: 1,
        askingMedianPrice: 6000,
        soldMedianPrice: 9000,
      },
    });
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it("returns category overview with asking/sold medians and spread", async () => {
    const response = await ctx.app.inject({ method: "GET", headers: ctx.authHeaders(), url: "/v1/analytics/market/categories" });
    expect(response.statusCode).toBe(200);
    const body = response.json();

    const ps3 = body.categories.find((category: { categoryId: number }) => category.categoryId === 7091);
    expect(ps3).toBeDefined();
    expect(ps3.onSaleCount).toBe(2);
    expect(ps3.sold30dCount).toBe(1);
    expect(ps3.askingMedianPrice).toBe(6000);
    expect(ps3.soldMedianPrice).toBe(9000);
    expect(ps3.medianSpread).toBe(-3000);

    const ids = body.categories.map((category: { categoryId: number }) => category.categoryId);
    expect(ids).not.toContain(9999);
  });

  it("returns on-sale price distribution", async () => {
    const response = await ctx.app.inject({ method: "GET", headers: ctx.authHeaders(), url: "/v1/analytics/market/categories/7091/price-distribution?status=on_sale" });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.stats.count).toBe(2);
    expect(body.stats.min).toBe(4000);
    expect(body.stats.max).toBe(8000);
    expect(body.histogram.length).toBeGreaterThan(0);
  });

  it("returns sold price distribution", async () => {
    const response = await ctx.app.inject({ method: "GET", headers: ctx.authHeaders(), url: "/v1/analytics/market/categories/7091/price-distribution?status=sold&days=7" });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.stats.count).toBe(1);
    expect(body.stats.median).toBe(9000);
  });

  it("returns timeseries from daily stats", async () => {
    const response = await ctx.app.inject({ method: "GET", headers: ctx.authHeaders(), url: "/v1/analytics/market/categories/7091/timeseries?granularity=day" });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.series.length).toBe(1);
    expect(body.series[0].soldCount).toBe(1);
    expect(body.series[0].askingMedianPrice).toBe(6000);
    expect(body.series[0].soldMedianPrice).toBe(9000);
  });

  it("returns sold listings drilldown sorted by recency", async () => {
    const response = await ctx.app.inject({ method: "GET", headers: ctx.authHeaders(), url: "/v1/analytics/market/categories/7091/listings?status=sold" });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.total).toBe(1);
    expect(body.listings[0].mercariId).toBe("m-sold-1");
    expect(body.listings[0].soldPrice).toBe(9000);
    expect(body.listings[0].url).toBe("https://jp.mercari.com/item/m-sold-1");
  });

  it("filters listings by title substring", async () => {
    const response = await ctx.app.inject({ method: "GET", headers: ctx.authHeaders(), url: "/v1/analytics/market/categories/7091/listings?status=on_sale&q=ジャンク" });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.total).toBe(1);
    expect(body.listings[0].mercariId).toBe("m-on-2");
  });

  it("searches across categories with asking and sold stats", async () => {
    const response = await ctx.app.inject({ method: "GET", headers: ctx.authHeaders(), url: "/v1/analytics/market/search?q=PS3" });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.total).toBe(3);
    expect(body.askingStats.count).toBe(2);
    expect(body.soldStats.count).toBe(1);
    expect(body.soldStats.median).toBe(9000);
  });

  it("rejects too-short search queries", async () => {
    const response = await ctx.app.inject({ method: "GET", headers: ctx.authHeaders(), url: "/v1/analytics/market/search?q=a" });
    expect(response.statusCode).toBe(400);
  });

  it("404s for unknown categories", async () => {
    const response = await ctx.app.inject({ method: "GET", headers: ctx.authHeaders(), url: "/v1/analytics/market/categories/123456/price-distribution" });
    expect(response.statusCode).toBe(404);
  });
});
