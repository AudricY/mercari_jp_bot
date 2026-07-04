import type { PrismaClient } from "@prisma/client";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Logger } from "pino";

import { computePriceStats } from "./market-stats.js";

interface MarketAnalyticsDeps {
  prisma: PrismaClient;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function parseDateParam(value: string | undefined, fallback: Date): Date {
  if (!value) return fallback;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

function parsePositiveInt(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
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

function listingUrl(mercariId: string): string {
  return `https://jp.mercari.com/item/${mercariId}`;
}

function serializeListing(listing: {
  mercariId: string;
  title: string;
  price: number;
  status: string;
  conditionId: number | null;
  thumbnailUrl: string | null;
  mercariCreatedSec: number;
  soldPrice: number | null;
  soldObservedAt: Date | null;
  categoryId: number;
}) {
  return {
    mercariId: listing.mercariId,
    url: listingUrl(listing.mercariId),
    title: listing.title,
    price: listing.price,
    status: listing.status,
    conditionId: listing.conditionId,
    thumbnailUrl: listing.thumbnailUrl,
    listedAt: new Date(listing.mercariCreatedSec * 1000).toISOString(),
    soldPrice: listing.soldPrice,
    soldObservedAt: listing.soldObservedAt?.toISOString() ?? null,
    categoryId: listing.categoryId,
  };
}

export function registerMarketAnalyticsRoutes(
  app: FastifyInstance<import("http").Server, import("http").IncomingMessage, import("http").ServerResponse, Logger>,
  deps: MarketAnalyticsDeps,
) {
  const { prisma } = deps;

  app.get("/v1/analytics/market/categories", async () => {
    const now = new Date();
    const since7d = new Date(now.getTime() - 7 * DAY_MS);
    const since30d = new Date(now.getTime() - 30 * DAY_MS);

    const categories = await prisma.marketCategory.findMany({
      where: { enabled: true },
      orderBy: [{ kind: "asc" }, { label: "asc" }],
    });

    const [onSaleCounts, sold7dRows, sold30dRows, askingRows] = await Promise.all([
      prisma.marketListing.groupBy({
        by: ["categoryId"],
        where: { status: "on_sale" },
        _count: { _all: true },
      }),
      prisma.marketListing.groupBy({
        by: ["categoryId"],
        where: { soldObservedAt: { gte: since7d } },
        _count: { _all: true },
      }),
      prisma.marketListing.findMany({
        where: { soldObservedAt: { gte: since30d }, soldPrice: { not: null } },
        select: { categoryId: true, soldPrice: true },
      }),
      prisma.marketListing.findMany({
        where: { status: "on_sale" },
        select: { categoryId: true, price: true },
      }),
    ]);

    const onSaleByCategory = new Map(onSaleCounts.map((row) => [row.categoryId, row._count._all]));
    const sold7dByCategory = new Map(sold7dRows.map((row) => [row.categoryId, row._count._all]));

    const soldPricesByCategory = new Map<number, number[]>();
    for (const row of sold30dRows) {
      const prices = soldPricesByCategory.get(row.categoryId) ?? [];
      prices.push(Number(row.soldPrice));
      soldPricesByCategory.set(row.categoryId, prices);
    }
    const askingPricesByCategory = new Map<number, number[]>();
    for (const row of askingRows) {
      const prices = askingPricesByCategory.get(row.categoryId) ?? [];
      prices.push(row.price);
      askingPricesByCategory.set(row.categoryId, prices);
    }

    return {
      categories: categories.map((category) => {
        const asking = computePriceStats(askingPricesByCategory.get(category.id) ?? []);
        const sold = computePriceStats(soldPricesByCategory.get(category.id) ?? []);
        const onSaleCount = onSaleByCategory.get(category.id) ?? 0;
        const sold30dCount = sold.count;

        return {
          categoryId: category.id,
          label: category.label,
          platform: category.platform,
          kind: category.kind,
          onSaleCount,
          sold7dCount: sold7dByCategory.get(category.id) ?? 0,
          sold30dCount,
          askingMedianPrice: asking.count > 0 ? asking.median : null,
          soldMedianPrice: sold30dCount > 0 ? sold.median : null,
          medianSpread:
            asking.count > 0 && sold30dCount > 0
              ? Math.round((asking.median - sold.median) * 100) / 100
              : null,
          lastSnapshotAt: category.lastSnapshotAt?.toISOString() ?? null,
          lastSoldSweepAt: category.lastSoldSweepAt?.toISOString() ?? null,
          lastNewSweepAt: category.lastNewSweepAt?.toISOString() ?? null,
        };
      }),
    };
  });

  app.get(
    "/v1/analytics/market/categories/:id/price-distribution",
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Querystring: { status?: string; days?: string; buckets?: string };
      }>,
      reply: FastifyReply,
    ) => {
      const categoryId = Number.parseInt(request.params.id, 10);
      const status = request.query.status === "sold" ? "sold" : "on_sale";
      const days = parsePositiveInt(request.query.days, 30, 1, 365);
      const bucketCount = parsePositiveInt(request.query.buckets, 20, 5, 100);

      const category = await prisma.marketCategory.findUnique({ where: { id: categoryId } });
      if (!category) return reply.code(404).send({ error: "Market category not found" });

      let prices: number[];
      if (status === "sold") {
        const rows = await prisma.marketListing.findMany({
          where: {
            categoryId,
            soldPrice: { not: null },
            soldObservedAt: { gte: new Date(Date.now() - days * DAY_MS) },
          },
          select: { soldPrice: true },
        });
        prices = rows.map((row) => Number(row.soldPrice));
      } else {
        const rows = await prisma.marketListing.findMany({
          where: { categoryId, status: "on_sale" },
          select: { price: true },
        });
        prices = rows.map((row) => row.price);
      }

      return {
        categoryId,
        label: category.label,
        platform: category.platform,
        kind: category.kind,
        status,
        days,
        stats: computePriceStats(prices),
        histogram: buildHistogram(prices, bucketCount),
      };
    },
  );

  app.get(
    "/v1/analytics/market/categories/:id/timeseries",
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Querystring: { from?: string; to?: string; granularity?: string };
      }>,
      reply: FastifyReply,
    ) => {
      const categoryId = Number.parseInt(request.params.id, 10);
      const from = parseDateParam(request.query.from, new Date(Date.now() - 30 * DAY_MS));
      const to = parseDateParam(request.query.to, new Date());
      const granularity = (["day", "week", "month"].includes(request.query.granularity ?? "")
        ? request.query.granularity
        : "day") as "day" | "week" | "month";

      const category = await prisma.marketCategory.findUnique({ where: { id: categoryId } });
      if (!category) return reply.code(404).send({ error: "Market category not found" });

      const rows = await prisma.dailyCategoryMarketStat.findMany({
        where: { categoryId, dateUtc: { gte: from, lte: to } },
        orderBy: { dateUtc: "asc" },
      });

      const buckets = new Map<
        string,
        {
          onSaleCountLast: number;
          newListingCount: number;
          soldCount: number;
          askingMedianWeighted: number;
          askingWeight: number;
          soldMedianWeighted: number;
          soldWeight: number;
        }
      >();

      for (const row of rows) {
        const key = periodStartFor(row.dateUtc, granularity);
        let bucket = buckets.get(key);
        if (!bucket) {
          bucket = {
            onSaleCountLast: 0,
            newListingCount: 0,
            soldCount: 0,
            askingMedianWeighted: 0,
            askingWeight: 0,
            soldMedianWeighted: 0,
            soldWeight: 0,
          };
          buckets.set(key, bucket);
        }
        bucket.onSaleCountLast = row.onSaleCount;
        bucket.newListingCount += row.newListingCount;
        bucket.soldCount += row.soldCount;
        if (row.askingMedianPrice != null && row.onSaleCount > 0) {
          bucket.askingMedianWeighted += Number(row.askingMedianPrice) * row.onSaleCount;
          bucket.askingWeight += row.onSaleCount;
        }
        if (row.soldMedianPrice != null && row.soldCount > 0) {
          bucket.soldMedianWeighted += Number(row.soldMedianPrice) * row.soldCount;
          bucket.soldWeight += row.soldCount;
        }
      }

      return {
        categoryId,
        label: category.label,
        platform: category.platform,
        kind: category.kind,
        granularity,
        from: from.toISOString(),
        to: to.toISOString(),
        series: [...buckets.entries()]
          .map(([periodStart, bucket]) => ({
            periodStart,
            onSaleCount: bucket.onSaleCountLast,
            newListingCount: bucket.newListingCount,
            soldCount: bucket.soldCount,
            askingMedianPrice:
              bucket.askingWeight > 0
                ? Math.round((bucket.askingMedianWeighted / bucket.askingWeight) * 100) / 100
                : null,
            soldMedianPrice:
              bucket.soldWeight > 0
                ? Math.round((bucket.soldMedianWeighted / bucket.soldWeight) * 100) / 100
                : null,
          }))
          .sort((left, right) => left.periodStart.localeCompare(right.periodStart)),
      };
    },
  );

  app.get(
    "/v1/analytics/market/categories/:id/listings",
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Querystring: { status?: string; sort?: string; q?: string; limit?: string; offset?: string };
      }>,
      reply: FastifyReply,
    ) => {
      const categoryId = Number.parseInt(request.params.id, 10);
      const status = ["on_sale", "trading", "sold", "gone"].includes(request.query.status ?? "")
        ? request.query.status!
        : "on_sale";
      const sort = ["newest", "cheapest", "recently_sold"].includes(request.query.sort ?? "")
        ? request.query.sort!
        : status === "sold"
          ? "recently_sold"
          : "newest";
      const limit = parsePositiveInt(request.query.limit, 50, 1, 200);
      const offset = Math.max(Number.parseInt(request.query.offset ?? "0", 10) || 0, 0);
      const q = (request.query.q ?? "").trim();

      const category = await prisma.marketCategory.findUnique({ where: { id: categoryId } });
      if (!category) return reply.code(404).send({ error: "Market category not found" });

      const where = {
        categoryId,
        ...(status === "sold" ? { status: "sold_out" } : { status }),
        ...(q ? { title: { contains: q } } : {}),
      };

      const orderBy =
        sort === "cheapest"
          ? { price: "asc" as const }
          : sort === "recently_sold"
            ? { soldObservedAt: "desc" as const }
            : { mercariCreatedSec: "desc" as const };

      const [listings, total] = await Promise.all([
        prisma.marketListing.findMany({ where, orderBy, take: limit, skip: offset }),
        prisma.marketListing.count({ where }),
      ]);

      return {
        categoryId,
        label: category.label,
        status,
        sort,
        q: q || null,
        total,
        listings: listings.map(serializeListing),
      };
    },
  );

  app.get(
    "/v1/analytics/market/search",
    async (
      request: FastifyRequest<{
        Querystring: { q?: string; status?: string; limit?: string; offset?: string };
      }>,
      reply: FastifyReply,
    ) => {
      const q = (request.query.q ?? "").trim();
      if (q.length < 2) {
        return reply.code(400).send({ error: "Query parameter q must be at least 2 characters" });
      }
      const status = ["on_sale", "sold", "all"].includes(request.query.status ?? "")
        ? request.query.status!
        : "all";
      const limit = parsePositiveInt(request.query.limit, 50, 1, 200);
      const offset = Math.max(Number.parseInt(request.query.offset ?? "0", 10) || 0, 0);

      const where = {
        title: { contains: q },
        ...(status === "on_sale" ? { status: "on_sale" } : {}),
        ...(status === "sold" ? { status: "sold_out" } : {}),
      };

      const [listings, total, statRows] = await Promise.all([
        prisma.marketListing.findMany({
          where,
          orderBy: { mercariCreatedSec: "desc" },
          take: limit,
          skip: offset,
        }),
        prisma.marketListing.count({ where }),
        prisma.marketListing.findMany({
          where: { title: { contains: q } },
          select: { status: true, price: true, soldPrice: true },
          take: 5000,
        }),
      ]);

      const askingPrices = statRows.filter((row) => row.status === "on_sale").map((row) => row.price);
      const soldPrices = statRows
        .filter((row) => row.soldPrice != null)
        .map((row) => Number(row.soldPrice));

      return {
        q,
        status,
        total,
        askingStats: computePriceStats(askingPrices),
        soldStats: computePriceStats(soldPrices),
        listings: listings.map(serializeListing),
      };
    },
  );
}
