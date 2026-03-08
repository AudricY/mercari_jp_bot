import type { PrismaClient } from "@prisma/client";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Logger } from "pino";

interface AnalyticsDeps {
  prisma: PrismaClient;
}

function parseDateParam(value: string | undefined, fallback: Date): Date {
  if (!value) return fallback;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? fallback : d;
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

function computeStats(prices: number[]) {
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

  app.get("/v1/analytics/keywords", async (request: FastifyRequest<{ Querystring: { from?: string; to?: string } }>) => {
    const from = parseDateParam(request.query.from, defaultFrom());
    const to = parseDateParam(request.query.to, new Date());

    const keywords = await prisma.keyword.findMany({
      where: { enabled: true },
      orderBy: { name: "asc" },
    });

    const result = await Promise.all(
      keywords.map(async (kw) => {
        const observations = await prisma.listingObservation.findMany({
          where: {
            keywordId: kw.id,
            observedAt: { gte: from, lte: to },
          },
          select: { numericPrice: true, sourceListingId: true, observedAt: true },
        });

        const prices = observations.map((o) => Number(o.numericPrice));
        const stats = computeStats(prices);
        const uniqueListings = new Set(
          observations.map((o) => o.sourceListingId).filter(Boolean),
        );
        const latestObs = observations.length > 0
          ? observations.reduce((a, b) => (a.observedAt > b.observedAt ? a : b))
          : null;

        return {
          keywordId: kw.id,
          keywordName: kw.name,
          observationCount: observations.length,
          uniqueListingCount: uniqueListings.size,
          medianPrice: stats.median,
          minPrice: stats.min,
          maxPrice: stats.max,
          latestObservedAt: latestObs?.observedAt ?? null,
        };
      }),
    );

    return { keywords: result, from: from.toISOString(), to: to.toISOString() };
  });

  app.get(
    "/v1/analytics/keywords/:id/price-distribution",
    async (
      request: FastifyRequest<{ Params: { id: string }; Querystring: { from?: string; to?: string; buckets?: string } }>,
      reply: FastifyReply,
    ) => {
      const { id } = request.params;
      const from = parseDateParam(request.query.from, defaultFrom());
      const to = parseDateParam(request.query.to, new Date());
      const bucketCount = Math.min(
        Math.max(Number.parseInt(request.query.buckets ?? "20", 10) || 20, 5),
        100,
      );

      const keyword = await prisma.keyword.findUnique({ where: { id } });
      if (!keyword) return reply.code(404).send({ error: "Keyword not found" });

      const observations = await prisma.listingObservation.findMany({
        where: {
          keywordId: id,
          observedAt: { gte: from, lte: to },
        },
        select: { numericPrice: true },
      });

      const prices = observations.map((o) => Number(o.numericPrice));
      const stats = computeStats(prices);

      let histogram: { bucketMin: number; bucketMax: number; count: number }[] = [];
      if (prices.length > 0) {
        const sorted = [...prices].sort((a, b) => a - b);
        const min = sorted[0]!;
        const max = sorted[sorted.length - 1]!;
        const range = max - min || 1;
        const bucketWidth = range / bucketCount;

        histogram = Array.from({ length: bucketCount }, (_, i) => ({
          bucketMin: Math.round(min + i * bucketWidth),
          bucketMax: Math.round(min + (i + 1) * bucketWidth),
          count: 0,
        }));

        for (const p of sorted) {
          const idx = Math.min(Math.floor((p - min) / bucketWidth), bucketCount - 1);
          histogram[idx]!.count++;
        }
      }

      return { keywordId: id, keywordName: keyword.name, from: from.toISOString(), to: to.toISOString(), stats, histogram };
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

      const observations = await prisma.listingObservation.findMany({
        where: {
          keywordId: id,
          observedAt: { gte: from, lte: to },
        },
        select: { numericPrice: true, sourceListingId: true, observedAt: true },
        orderBy: { observedAt: "asc" },
      });

      const buckets = new Map<string, { prices: number[]; uniqueIds: Set<string> }>();

      for (const obs of observations) {
        const d = obs.observedAt;
        let key: string;
        if (granularity === "month") {
          key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
        } else if (granularity === "week") {
          const day = new Date(d);
          const dayOfWeek = day.getUTCDay();
          const diff = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
          day.setUTCDate(day.getUTCDate() - diff);
          key = day.toISOString().slice(0, 10);
        } else {
          key = d.toISOString().slice(0, 10);
        }

        let bucket = buckets.get(key);
        if (!bucket) {
          bucket = { prices: [], uniqueIds: new Set() };
          buckets.set(key, bucket);
        }
        bucket.prices.push(Number(obs.numericPrice));
        if (obs.sourceListingId) bucket.uniqueIds.add(obs.sourceListingId);
      }

      const series = [...buckets.entries()].map(([periodStart, bucket]) => {
        const stats = computeStats(bucket.prices);
        return {
          periodStart,
          observationCount: bucket.prices.length,
          uniqueListingCount: bucket.uniqueIds.size,
          minPrice: stats.min,
          medianPrice: stats.median,
          p75Price: stats.p75,
          maxPrice: stats.max,
        };
      });

      return { keywordId: id, keywordName: keyword.name, granularity, from: from.toISOString(), to: to.toISOString(), series };
    },
  );

  app.get(
    "/v1/analytics/keywords/:id/listings",
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Querystring: { from?: string; to?: string; sort?: string; limit?: string; offset?: string };
      }>,
      reply: FastifyReply,
    ) => {
      const { id } = request.params;
      const from = parseDateParam(request.query.from, defaultFrom());
      const to = parseDateParam(request.query.to, new Date());
      const sort = request.query.sort === "cheapest" ? "cheapest" : "newest";
      const limit = Math.min(Math.max(Number.parseInt(request.query.limit ?? "50", 10) || 50, 1), 200);
      const offset = Math.max(Number.parseInt(request.query.offset ?? "0", 10) || 0, 0);

      const keyword = await prisma.keyword.findUnique({ where: { id } });
      if (!keyword) return reply.code(404).send({ error: "Keyword not found" });

      const orderBy = sort === "cheapest"
        ? { numericPrice: "asc" as const }
        : { observedAt: "desc" as const };

      const [observations, total] = await Promise.all([
        prisma.listingObservation.findMany({
          where: {
            keywordId: id,
            observedAt: { gte: from, lte: to },
          },
          orderBy,
          take: limit,
          skip: offset,
        }),
        prisma.listingObservation.count({
          where: {
            keywordId: id,
            observedAt: { gte: from, lte: to },
          },
        }),
      ]);

      return {
        keywordId: id,
        keywordName: keyword.name,
        sort,
        total,
        listings: observations.map((o) => ({
          id: o.id,
          sourceListingId: o.sourceListingId,
          title: o.title,
          url: o.listingUrl,
          imageUrl: o.imageUrl,
          price: Number(o.numericPrice),
          currency: o.currency,
          observedAt: o.observedAt,
        })),
      };
    },
  );
}
