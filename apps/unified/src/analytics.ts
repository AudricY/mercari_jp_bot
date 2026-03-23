import type { PrismaClient } from "@prisma/client";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Logger } from "pino";

import { computePriceStats, snapshotFreshSince } from "./market-stats.js";

interface AnalyticsDeps {
  prisma: PrismaClient;
}

function parseDateParam(value: string | undefined, fallback: Date): Date {
  if (!value) return fallback;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? fallback : d;
}

function periodStartFor(date: Date, granularity: "day" | "week" | "month"): string {
  if (granularity === "month") {
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-01`;
  }

  if (granularity === "week") {
    const day = new Date(date);
    const dayOfWeek = day.getUTCDay();
    const diff = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    day.setUTCDate(day.getUTCDate() - diff);
    return day.toISOString().slice(0, 10);
  }

  return date.toISOString().slice(0, 10);
}

function buildHistogram(prices: number[], bucketCount: number): { bucketMin: number; bucketMax: number; count: number }[] {
  if (prices.length === 0) return [];

  const sorted = [...prices].sort((a, b) => a - b);
  const min = sorted[0]!;
  const max = sorted[sorted.length - 1]!;
  const range = max - min || 1;
  const bucketWidth = range / bucketCount;

  const histogram = Array.from({ length: bucketCount }, (_, i) => ({
    bucketMin: Math.round(min + i * bucketWidth),
    bucketMax: Math.round(min + (i + 1) * bucketWidth),
    count: 0,
  }));

  for (const price of sorted) {
    const idx = Math.min(Math.floor((price - min) / bucketWidth), bucketCount - 1);
    histogram[idx]!.count += 1;
  }

  return histogram;
}

function buildTimeseries<T extends {
  dateUtc: Date;
  listingCount: number;
  minPrice: { toString(): string } | number;
  medianPrice: { toString(): string } | number;
  maxPrice: { toString(): string } | number;
}>(
  rows: T[],
  granularity: "day" | "week" | "month",
) {
  const buckets = new Map<string, {
    listingCount: number;
    weightedMedianTotal: number;
    minPrice: number;
    maxPrice: number;
  }>();

  for (const row of rows) {
    const key = periodStartFor(row.dateUtc, granularity);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        listingCount: 0,
        weightedMedianTotal: 0,
        minPrice: Number(row.minPrice),
        maxPrice: Number(row.maxPrice),
      };
      buckets.set(key, bucket);
    }
    bucket.listingCount += row.listingCount;
    bucket.weightedMedianTotal += Number(row.medianPrice) * row.listingCount;
    bucket.minPrice = Math.min(bucket.minPrice, Number(row.minPrice));
    bucket.maxPrice = Math.max(bucket.maxPrice, Number(row.maxPrice));
  }

  return [...buckets.entries()]
    .map(([periodStart, bucket]) => ({
      periodStart,
      listingCount: bucket.listingCount,
      minPrice: bucket.minPrice,
      medianPrice: bucket.listingCount > 0
        ? Math.round((bucket.weightedMedianTotal / bucket.listingCount) * 100) / 100
        : 0,
      maxPrice: bucket.maxPrice,
    }))
    .sort((a, b) => a.periodStart.localeCompare(b.periodStart));
}

export function registerAnalyticsRoutes(
  app: FastifyInstance<import("http").Server, import("http").IncomingMessage, import("http").ServerResponse, Logger>,
  deps: AnalyticsDeps,
) {
  const { prisma } = deps;

  const defaultFrom = () => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d;
  };

  app.get("/v1/analytics/items", async () => {
    const freshSince = snapshotFreshSince();
    const items = await prisma.item.findMany({
      where: { enabled: true },
      orderBy: { displayName: "asc" },
    });

    const listings = await prisma.listing.findMany({
      where: {
        itemId: { in: items.map((item) => item.id) },
        scrapedAt: { gte: freshSince },
      },
      select: {
        itemId: true,
        numericPrice: true,
        scrapedAt: true,
      },
    });

    const buckets = new Map<string, { prices: number[]; latestScrapedAt: Date | null; belowTargetCount: number }>();
    for (const item of items) {
      buckets.set(item.id, { prices: [], latestScrapedAt: null, belowTargetCount: 0 });
    }

    for (const listing of listings) {
      if (!listing.itemId) continue;
      const bucket = buckets.get(listing.itemId);
      const item = items.find((entry) => entry.id === listing.itemId);
      if (!bucket || !item) continue;
      const price = Number(listing.numericPrice);
      bucket.prices.push(price);
      if (!bucket.latestScrapedAt || listing.scrapedAt > bucket.latestScrapedAt) {
        bucket.latestScrapedAt = listing.scrapedAt;
      }
      if (item.targetBuyPrice != null && price <= Number(item.targetBuyPrice)) {
        bucket.belowTargetCount += 1;
      }
    }

    return {
      items: items.map((item) => {
        const bucket = buckets.get(item.id) ?? { prices: [], latestScrapedAt: null, belowTargetCount: 0 };
        const stats = computePriceStats(bucket.prices);
        const targetBuyPrice = item.targetBuyPrice == null ? null : Number(item.targetBuyPrice);

        return {
          itemId: item.id,
          itemSlug: item.slug,
          itemName: item.displayName,
          kind: item.kind,
          platform: item.platform,
          listingCount: stats.count,
          medianPrice: stats.median,
          minPrice: stats.min,
          maxPrice: stats.max,
          latestScrapedAt: bucket.latestScrapedAt?.toISOString() ?? null,
          targetBuyPrice,
          belowTargetCount: bucket.belowTargetCount,
          cheapestVsTarget: targetBuyPrice == null || stats.count === 0 ? null : stats.min - targetBuyPrice,
        };
      }),
    };
  });

  app.get("/v1/analytics/keywords", async () => {
    const freshSince = snapshotFreshSince();
    const keywords = await prisma.keyword.findMany({
      where: { enabled: true },
      orderBy: { name: "asc" },
    });

    const listings = await prisma.listing.findMany({
      where: {
        keywordId: { in: keywords.map((keyword) => keyword.id) },
        scrapedAt: { gte: freshSince },
      },
      select: {
        keywordId: true,
        numericPrice: true,
        scrapedAt: true,
      },
    });

    const buckets = new Map<string, { prices: number[]; latestScrapedAt: Date | null }>();
    for (const keyword of keywords) {
      buckets.set(keyword.id, { prices: [], latestScrapedAt: null });
    }

    for (const listing of listings) {
      if (!listing.keywordId) continue;
      const bucket = buckets.get(listing.keywordId);
      if (!bucket) continue;
      bucket.prices.push(Number(listing.numericPrice));
      if (!bucket.latestScrapedAt || listing.scrapedAt > bucket.latestScrapedAt) {
        bucket.latestScrapedAt = listing.scrapedAt;
      }
    }

    return {
      keywords: keywords.map((keyword) => {
        const bucket = buckets.get(keyword.id) ?? { prices: [], latestScrapedAt: null };
        const stats = computePriceStats(bucket.prices);

        return {
          keywordId: keyword.id,
          keywordName: keyword.name,
          listingCount: stats.count,
          medianPrice: stats.median,
          minPrice: stats.min,
          maxPrice: stats.max,
          latestScrapedAt: bucket.latestScrapedAt?.toISOString() ?? null,
        };
      }),
    };
  });

  app.get(
    "/v1/analytics/items/:id/price-distribution",
    async (
      request: FastifyRequest<{ Params: { id: string }; Querystring: { buckets?: string } }>,
      reply: FastifyReply,
    ) => {
      const { id } = request.params;
      const bucketCount = Math.min(
        Math.max(Number.parseInt(request.query.buckets ?? "20", 10) || 20, 5),
        100,
      );

      const item = await prisma.item.findUnique({ where: { slug: id } });
      if (!item) return reply.code(404).send({ error: "Item not found" });

      const listings = await prisma.listing.findMany({
        where: {
          itemId: item.id,
          scrapedAt: { gte: snapshotFreshSince() },
        },
        select: { numericPrice: true },
      });

      const prices = listings.map((listing) => Number(listing.numericPrice));
      const stats = computePriceStats(prices);

      return {
        itemId: item.id,
        itemSlug: item.slug,
        itemName: item.displayName,
        targetBuyPrice: item.targetBuyPrice == null ? null : Number(item.targetBuyPrice),
        belowTargetCount: item.targetBuyPrice == null
          ? 0
          : prices.filter((price) => price <= Number(item.targetBuyPrice)).length,
        cheapestVsTarget: item.targetBuyPrice == null || stats.count === 0
          ? null
          : stats.min - Number(item.targetBuyPrice),
        stats,
        histogram: buildHistogram(prices, bucketCount),
      };
    },
  );

  app.get(
    "/v1/analytics/keywords/:id/price-distribution",
    async (
      request: FastifyRequest<{ Params: { id: string }; Querystring: { buckets?: string } }>,
      reply: FastifyReply,
    ) => {
      const { id } = request.params;
      const bucketCount = Math.min(
        Math.max(Number.parseInt(request.query.buckets ?? "20", 10) || 20, 5),
        100,
      );

      const keyword = await prisma.keyword.findUnique({ where: { id } });
      if (!keyword) return reply.code(404).send({ error: "Keyword not found" });

      const listings = await prisma.listing.findMany({
        where: {
          keywordId: id,
          scrapedAt: { gte: snapshotFreshSince() },
        },
        select: { numericPrice: true },
      });

      const prices = listings.map((listing) => Number(listing.numericPrice));
      const stats = computePriceStats(prices);

      return { keywordId: id, keywordName: keyword.name, stats, histogram: buildHistogram(prices, bucketCount) };
    },
  );

  app.get(
    "/v1/analytics/items/:id/timeseries",
    async (
      request: FastifyRequest<{ Params: { id: string }; Querystring: { from?: string; to?: string; granularity?: string } }>,
      reply: FastifyReply,
    ) => {
      const { id } = request.params;
      const from = parseDateParam(request.query.from, defaultFrom());
      const to = parseDateParam(request.query.to, new Date());
      const granularity = (request.query.granularity ?? "day") as "day" | "week" | "month";

      const item = await prisma.item.findUnique({ where: { slug: id } });
      if (!item) return reply.code(404).send({ error: "Item not found" });

      const rows = await prisma.dailyItemMarketStat.findMany({
        where: {
          itemId: item.id,
          dateUtc: { gte: from, lte: to },
        },
        orderBy: { dateUtc: "asc" },
      });

      return {
        itemId: item.id,
        itemSlug: item.slug,
        itemName: item.displayName,
        granularity,
        from: from.toISOString(),
        to: to.toISOString(),
        targetBuyPrice: item.targetBuyPrice == null ? null : Number(item.targetBuyPrice),
        series: buildTimeseries(rows, granularity),
      };
    },
  );

  app.get(
    "/v1/analytics/keywords/:id/timeseries",
    async (
      request: FastifyRequest<{ Params: { id: string }; Querystring: { from?: string; to?: string; granularity?: string } }>,
      reply: FastifyReply,
    ) => {
      const { id } = request.params;
      const from = parseDateParam(request.query.from, defaultFrom());
      const to = parseDateParam(request.query.to, new Date());
      const granularity = (request.query.granularity ?? "day") as "day" | "week" | "month";

      const keyword = await prisma.keyword.findUnique({ where: { id } });
      if (!keyword) return reply.code(404).send({ error: "Keyword not found" });

      const rows = await prisma.dailyKeywordMarketStat.findMany({
        where: {
          keywordId: id,
          dateUtc: { gte: from, lte: to },
        },
        orderBy: { dateUtc: "asc" },
      });

      return {
        keywordId: id,
        keywordName: keyword.name,
        granularity,
        from: from.toISOString(),
        to: to.toISOString(),
        series: buildTimeseries(rows, granularity),
      };
    },
  );

  app.get(
    "/v1/analytics/items/:id/listings",
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Querystring: { sort?: string; limit?: string; offset?: string };
      }>,
      reply: FastifyReply,
    ) => {
      const { id } = request.params;
      const sort = request.query.sort === "cheapest" ? "cheapest" : "newest";
      const limit = Math.min(Math.max(Number.parseInt(request.query.limit ?? "50", 10) || 50, 1), 200);
      const offset = Math.max(Number.parseInt(request.query.offset ?? "0", 10) || 0, 0);

      const item = await prisma.item.findUnique({ where: { slug: id } });
      if (!item) return reply.code(404).send({ error: "Item not found" });

      const orderBy = sort === "cheapest"
        ? { numericPrice: "asc" as const }
        : { scrapedAt: "desc" as const };

      const where = {
        itemId: item.id,
        scrapedAt: { gte: snapshotFreshSince() },
      };

      const [listings, total] = await Promise.all([
        prisma.listing.findMany({
          where,
          orderBy,
          take: limit,
          skip: offset,
        }),
        prisma.listing.count({ where }),
      ]);

      return {
        itemId: item.id,
        itemSlug: item.slug,
        itemName: item.displayName,
        targetBuyPrice: item.targetBuyPrice == null ? null : Number(item.targetBuyPrice),
        sort,
        total,
        listings: listings.map((listing) => ({
          id: listing.id,
          sourceListingId: listing.sourceListingId,
          title: listing.title,
          url: listing.url,
          imageUrl: listing.imageUrl,
          price: Number(listing.numericPrice),
          currency: listing.currency,
          scrapedAt: listing.scrapedAt,
          itemSubfamily: listing.itemSubfamily,
        })),
      };
    },
  );

  app.get(
    "/v1/analytics/keywords/:id/listings",
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Querystring: { sort?: string; limit?: string; offset?: string };
      }>,
      reply: FastifyReply,
    ) => {
      const { id } = request.params;
      const sort = request.query.sort === "cheapest" ? "cheapest" : "newest";
      const limit = Math.min(Math.max(Number.parseInt(request.query.limit ?? "50", 10) || 50, 1), 200);
      const offset = Math.max(Number.parseInt(request.query.offset ?? "0", 10) || 0, 0);

      const keyword = await prisma.keyword.findUnique({ where: { id } });
      if (!keyword) return reply.code(404).send({ error: "Keyword not found" });

      const orderBy = sort === "cheapest"
        ? { numericPrice: "asc" as const }
        : { scrapedAt: "desc" as const };

      const where = {
        keywordId: id,
        scrapedAt: { gte: snapshotFreshSince() },
      };

      const [listings, total] = await Promise.all([
        prisma.listing.findMany({
          where,
          orderBy,
          take: limit,
          skip: offset,
        }),
        prisma.listing.count({ where }),
      ]);

      return {
        keywordId: id,
        keywordName: keyword.name,
        sort,
        total,
        listings: listings.map((listing) => ({
          id: listing.id,
          sourceListingId: listing.sourceListingId,
          title: listing.title,
          url: listing.url,
          imageUrl: listing.imageUrl,
          price: Number(listing.numericPrice),
          currency: listing.currency,
          scrapedAt: listing.scrapedAt,
        })),
      };
    },
  );
}
