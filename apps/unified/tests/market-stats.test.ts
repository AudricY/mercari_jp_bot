import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { pruneOldScanRuns, refreshDailyKeywordMarketStats } from "../src/market-stats.js";
import { createTestContext, isoDate, uniqueId } from "./test-env.js";

describe("market stats maintenance", () => {
  let ctx: Awaited<ReturnType<typeof createTestContext>>;

  beforeAll(async () => {
    ctx = await createTestContext();
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  beforeEach(async () => {
    await ctx.prisma.notification.deleteMany();
    await ctx.prisma.seenListing.deleteMany();
    await ctx.prisma.dailyKeywordMarketStat.deleteMany();
    await ctx.prisma.listing.deleteMany();
    await ctx.prisma.scanRun.deleteMany();
    await ctx.prisma.keyword.deleteMany();
  });

  it("refreshes daily market stats from current listings and overwrites same-day rows", async () => {
    const keyword = await ctx.prisma.keyword.create({
      data: {
        id: uniqueId("kw"),
        name: "Switch",
        enabled: true,
        terms: ["switch"],
        filters: {},
        intervalSec: 60,
      },
    });

    await ctx.prisma.listing.createMany({
      data: [
        {
          id: uniqueId("listing"),
          keywordId: keyword.id,
          sourceListingId: "a",
          title: "Switch A",
          url: "https://jp.mercari.com/item/a",
          imageUrl: "https://example.com/a.jpg",
          currency: "¥",
          numericPrice: 100,
          rawPriceDisplay: "¥100",
          rawJson: "{}",
          scrapedAt: isoDate("2026-03-09T08:00:00.000Z"),
        },
        {
          id: uniqueId("listing"),
          keywordId: keyword.id,
          sourceListingId: "b",
          title: "Switch B",
          url: "https://jp.mercari.com/item/b",
          imageUrl: "https://example.com/b.jpg",
          currency: "¥",
          numericPrice: 300,
          rawPriceDisplay: "¥300",
          rawJson: "{}",
          scrapedAt: isoDate("2026-03-08T08:00:00.000Z"),
        },
      ],
    });

    const now = isoDate("2026-03-09T12:00:00.000Z");
    await refreshDailyKeywordMarketStats(now, { prisma: ctx.prisma, logger: ctx.logger });

    let rows = await ctx.prisma.dailyKeywordMarketStat.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      keywordId: keyword.id,
      listingCount: 2,
    });
    expect(Number(rows[0]!.minPrice)).toBe(100);
    expect(Number(rows[0]!.medianPrice)).toBe(200);
    expect(Number(rows[0]!.maxPrice)).toBe(300);
    expect(rows[0]!.latestScrapedAt.toISOString()).toBe("2026-03-09T08:00:00.000Z");

    await ctx.prisma.listing.update({
      where: { url: "https://jp.mercari.com/item/b" },
      data: { numericPrice: 200, rawPriceDisplay: "¥200" },
    });

    await refreshDailyKeywordMarketStats(now, { prisma: ctx.prisma, logger: ctx.logger });
    rows = await ctx.prisma.dailyKeywordMarketStat.findMany();
    expect(rows).toHaveLength(1);
    expect(Number(rows[0]!.medianPrice)).toBe(150);
    expect(Number(rows[0]!.maxPrice)).toBe(200);
  });

  it("prunes old scan runs by retention window", async () => {
    const keyword = await ctx.prisma.keyword.create({
      data: {
        id: uniqueId("kw"),
        name: "PSP",
        enabled: true,
        terms: ["psp"],
        filters: {},
        intervalSec: 60,
      },
    });

    await ctx.prisma.scanRun.createMany({
      data: [
        {
          id: uniqueId("run"),
          keywordId: keyword.id,
          startedAt: isoDate("2026-01-01T00:00:00.000Z"),
          finishedAt: isoDate("2026-01-01T00:01:00.000Z"),
          status: "success",
        },
        {
          id: uniqueId("run"),
          keywordId: keyword.id,
          startedAt: isoDate("2026-03-01T00:00:00.000Z"),
          finishedAt: isoDate("2026-03-01T00:01:00.000Z"),
          status: "success",
        },
      ],
    });

    await pruneOldScanRuns(isoDate("2026-03-09T00:00:00.000Z"), {
      prisma: ctx.prisma,
      logger: ctx.logger,
    });

    const runs = await ctx.prisma.scanRun.findMany({ orderBy: { startedAt: "asc" } });
    expect(runs).toHaveLength(1);
    expect(runs[0]!.startedAt.toISOString()).toBe("2026-03-01T00:00:00.000Z");
  });
});
