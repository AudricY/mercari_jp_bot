import type { Prisma, PrismaClient } from "@prisma/client";
import type { Logger } from "pino";

const DAY_MS = 24 * 60 * 60 * 1000;

export const SNAPSHOT_FRESHNESS_DAYS = 7;
export const SCAN_RUN_RETENTION_DAYS = 30;

export interface MarketStatsDeps {
  logger: Logger;
  prisma: PrismaClient;
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

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0]!;
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (idx - lo);
}

export function computePriceStats(prices: number[]): PriceStats {
  if (prices.length === 0) {
    return { count: 0, min: 0, p25: 0, median: 0, p75: 0, max: 0, mean: 0 };
  }

  const sorted = [...prices].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);

  return {
    count: sorted.length,
    min: sorted[0]!,
    p25: percentile(sorted, 25),
    median: percentile(sorted, 50),
    p75: percentile(sorted, 75),
    max: sorted[sorted.length - 1]!,
    mean: Math.round((sum / sorted.length) * 100) / 100,
  };
}

export function snapshotFreshSince(now: Date = new Date()): Date {
  return new Date(now.getTime() - SNAPSHOT_FRESHNESS_DAYS * DAY_MS);
}

function utcDayStart(date: Date): Date {
  return new Date(`${date.toISOString().slice(0, 10)}T00:00:00.000Z`);
}

export async function refreshDailyKeywordMarketStats(
  now: Date,
  deps: MarketStatsDeps,
): Promise<void> {
  const { logger, prisma } = deps;
  const dateUtc = utcDayStart(now);
  const freshSince = snapshotFreshSince(now);
  const enabledKeywords = await prisma.keyword.findMany({
    where: { enabled: true },
    select: { id: true },
  });
  const enabledKeywordIds = enabledKeywords.map((keyword) => keyword.id);

  const listings = await prisma.listing.findMany({
    where: {
      keywordId: { in: enabledKeywordIds },
      scrapedAt: { gte: freshSince },
    },
    select: {
      keywordId: true,
      numericPrice: true,
      scrapedAt: true,
    },
  });

  const buckets = new Map<string, { prices: number[]; latestScrapedAt: Date }>();
  for (const listing of listings) {
    if (!listing.keywordId) continue;
    const price = Number(listing.numericPrice);
    const existing = buckets.get(listing.keywordId);
    if (existing) {
      existing.prices.push(price);
      if (listing.scrapedAt > existing.latestScrapedAt) {
        existing.latestScrapedAt = listing.scrapedAt;
      }
    } else {
      buckets.set(listing.keywordId, {
        prices: [price],
        latestScrapedAt: listing.scrapedAt,
      });
    }
  }

  const rows = [...buckets.entries()].map(([keywordId, bucket]) => {
    const stats = computePriceStats(bucket.prices);
    return {
      dateUtc,
      keywordId,
      listingCount: stats.count,
      minPrice: stats.min,
      medianPrice: stats.median,
      maxPrice: stats.max,
      latestScrapedAt: bucket.latestScrapedAt,
    };
  });

  await prisma.$transaction(async (tx) => {
    await tx.dailyKeywordMarketStat.deleteMany({ where: { dateUtc } });
    if (rows.length > 0) {
      await tx.dailyKeywordMarketStat.createMany({ data: rows });
    }
  });

  logger.info(
    { dateUtc: dateUtc.toISOString(), keywordCount: rows.length, freshSince: freshSince.toISOString() },
    "Daily keyword market stats refreshed",
  );
}

export async function refreshDailyItemMarketStats(
  now: Date,
  deps: MarketStatsDeps,
): Promise<void> {
  const { logger, prisma } = deps;
  const dateUtc = utcDayStart(now);
  const freshSince = snapshotFreshSince(now);
  const enabledItems = await prisma.item.findMany({
    where: { enabled: true },
    select: { id: true },
  });
  const enabledItemIds = enabledItems.map((item) => item.id);

  const listings = await prisma.listing.findMany({
    where: {
      itemId: { in: enabledItemIds },
      scrapedAt: { gte: freshSince },
    },
    select: {
      itemId: true,
      numericPrice: true,
      scrapedAt: true,
    },
  });

  const buckets = new Map<string, { prices: number[]; latestScrapedAt: Date }>();
  for (const listing of listings) {
    if (!listing.itemId) continue;
    const price = Number(listing.numericPrice);
    const existing = buckets.get(listing.itemId);
    if (existing) {
      existing.prices.push(price);
      if (listing.scrapedAt > existing.latestScrapedAt) {
        existing.latestScrapedAt = listing.scrapedAt;
      }
    } else {
      buckets.set(listing.itemId, {
        prices: [price],
        latestScrapedAt: listing.scrapedAt,
      });
    }
  }

  const rows = [...buckets.entries()].map(([itemId, bucket]) => {
    const stats = computePriceStats(bucket.prices);
    return {
      dateUtc,
      itemId,
      listingCount: stats.count,
      minPrice: stats.min,
      medianPrice: stats.median,
      maxPrice: stats.max,
      latestScrapedAt: bucket.latestScrapedAt,
    };
  });

  await prisma.$transaction(async (tx) => {
    await tx.dailyItemMarketStat.deleteMany({ where: { dateUtc } });
    if (rows.length > 0) {
      await tx.dailyItemMarketStat.createMany({ data: rows });
    }
  });

  logger.info(
    { dateUtc: dateUtc.toISOString(), itemCount: rows.length, freshSince: freshSince.toISOString() },
    "Daily item market stats refreshed",
  );
}

export async function refreshDailyCategoryMarketStats(
  now: Date,
  deps: MarketStatsDeps,
): Promise<void> {
  const { logger, prisma } = deps;
  const dateUtc = utcDayStart(now);
  const dayStartSec = Math.floor(dateUtc.getTime() / 1000);
  const dayEnd = new Date(dateUtc.getTime() + DAY_MS);

  const categories = await prisma.marketCategory.findMany({ where: { enabled: true } });
  const rows: Prisma.DailyCategoryMarketStatCreateManyInput[] = [];

  for (const category of categories) {
    const [onSale, newToday, soldToday] = await Promise.all([
      prisma.marketListing.findMany({
        where: { categoryId: category.id, status: "on_sale" },
        select: { price: true },
      }),
      prisma.marketListing.count({
        where: {
          categoryId: category.id,
          mercariCreatedSec: { gte: dayStartSec, lt: dayStartSec + DAY_MS / 1000 },
        },
      }),
      prisma.marketListing.findMany({
        where: {
          categoryId: category.id,
          soldObservedAt: { gte: dateUtc, lt: dayEnd },
          soldPrice: { not: null },
        },
        select: { soldPrice: true },
      }),
    ]);

    const asking = computePriceStats(onSale.map((listing) => listing.price));
    const sold = computePriceStats(soldToday.map((listing) => Number(listing.soldPrice)));

    rows.push({
      dateUtc,
      categoryId: category.id,
      onSaleCount: asking.count,
      newListingCount: newToday,
      soldCount: sold.count,
      askingMinPrice: asking.count > 0 ? asking.min : null,
      askingMedianPrice: asking.count > 0 ? asking.median : null,
      askingP25Price: asking.count > 0 ? asking.p25 : null,
      askingP75Price: asking.count > 0 ? asking.p75 : null,
      soldMinPrice: sold.count > 0 ? sold.min : null,
      soldMedianPrice: sold.count > 0 ? sold.median : null,
      soldP25Price: sold.count > 0 ? sold.p25 : null,
      soldP75Price: sold.count > 0 ? sold.p75 : null,
      soldMaxPrice: sold.count > 0 ? sold.max : null,
    });
  }

  await prisma.$transaction(async (tx) => {
    await tx.dailyCategoryMarketStat.deleteMany({ where: { dateUtc } });
    if (rows.length > 0) {
      await tx.dailyCategoryMarketStat.createMany({ data: rows });
    }
  });

  logger.info(
    { dateUtc: dateUtc.toISOString(), categoryCount: rows.length },
    "Daily category market stats refreshed",
  );
}

export async function pruneOldScanRuns(now: Date, deps: MarketStatsDeps): Promise<void> {
  const { logger, prisma } = deps;
  const cutoff = new Date(now.getTime() - SCAN_RUN_RETENTION_DAYS * DAY_MS);
  const result = await prisma.scanRun.deleteMany({
    where: {
      startedAt: { lt: cutoff },
    },
  });

  logger.info(
    { deletedCount: result.count, cutoff: cutoff.toISOString() },
    "Pruned old scan runs",
  );
}
