import "dotenv/config";

import Fastify from "fastify";

import {
  QUEUE_NAMES,
  buildLogger,
  buildMetrics,
  createQueue,
  createRedisConnection,
  loadConfig,
  redactUnknown,
  type NotifyItemJob,
  type RetryFailedNotificationJob,
  type ScanKeywordJob,
  type SendDailySummaryJob,
} from "@mercari-bot/core";
import { createPrismaClient, initPrisma } from "@mercari-bot/db";

import { assertAdminAccess } from "./auth.js";

interface KeywordPayload {
  name: string;
  terms: string[];
  filters?: {
    priceMin?: number | null;
    priceMax?: number | null;
    titleMustContain?: string[];
    excludeKeyword?: string | null;
  };
  intervalSec?: number;
  enabled?: boolean;
}

const config = loadConfig();
const logger = buildLogger(config.LOG_LEVEL);
const metrics = buildMetrics();

const prisma = createPrismaClient();
const redis = createRedisConnection(config.REDIS_URL);

const scanQueue = createQueue("scan-keyword", config.REDIS_URL);
const notifyQueue = createQueue("notify-item", config.REDIS_URL);
const summaryQueue = createQueue("send-daily-summary", config.REDIS_URL);
const retryQueue = createQueue("retry-failed-notification", config.REDIS_URL);

const app = Fastify({
  loggerInstance: logger,
  trustProxy: true,
});

function sanitizeKeywordPayload(payload: KeywordPayload) {
  return {
    name: payload.name.trim(),
    terms: payload.terms.map((term) => term.trim()).filter((term) => term.length > 0),
    filters: {
      priceMin: payload.filters?.priceMin ?? null,
      priceMax: payload.filters?.priceMax ?? null,
      titleMustContain: payload.filters?.titleMustContain ?? [],
      excludeKeyword: payload.filters?.excludeKeyword ?? null,
    },
    intervalSec: payload.intervalSec ?? 60,
    enabled: payload.enabled ?? true,
  };
}

app.addHook("onRequest", async (request, reply) => {
  if (request.url.startsWith("/v1") && !request.url.startsWith("/v1/health") && !request.url.startsWith("/v1/metrics")) {
    const ok = assertAdminAccess(config, request, reply);
    if (!ok) {
      return reply;
    }
  }
});

app.get("/v1/health/live", async () => ({ status: "ok", timestamp: new Date().toISOString() }));

app.get("/v1/health/ready", async (_, reply) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    await redis.ping();
    return { status: "ready" };
  } catch (error) {
    logger.error({ error: redactUnknown(error) }, "Readiness check failed");
    return reply.code(503).send({ status: "not_ready" });
  }
});

app.get("/v1/metrics", async (_, reply) => {
  reply.header("Content-Type", metrics.registry.contentType);
  return metrics.registry.metrics();
});

app.get("/v1/keywords", async () => {
  const keywords = await prisma.keyword.findMany({ orderBy: { name: "asc" } });
  return { keywords };
});

app.post<{ Body: KeywordPayload }>("/v1/keywords", async (request, reply) => {
  const payload = sanitizeKeywordPayload(request.body);
  if (!payload.name || payload.terms.length === 0) {
    return reply.code(400).send({ error: "name and terms are required" });
  }

  const keyword = await prisma.keyword.create({
    data: {
      name: payload.name,
      enabled: payload.enabled,
      terms: payload.terms,
      filters: payload.filters,
      intervalSec: payload.intervalSec,
    },
  });

  return reply.code(201).send({ keyword });
});

app.patch<{ Params: { id: string }; Body: Partial<KeywordPayload> }>("/v1/keywords/:id", async (request, reply) => {
  const current = await prisma.keyword.findUnique({ where: { id: request.params.id } });
  if (!current) {
    return reply.code(404).send({ error: "Keyword not found" });
  }

  const currentTerms = Array.isArray(current.terms)
    ? current.terms.filter((term): term is string => typeof term === "string")
    : [];
  const rawTerms = request.body.terms ?? currentTerms;
  const payload = sanitizeKeywordPayload({
    name: request.body.name ?? current.name,
    terms: rawTerms,
    filters: {
      ...(typeof current.filters === "object" && current.filters ? current.filters : {}),
      ...(request.body.filters ?? {}),
    } as KeywordPayload["filters"],
    intervalSec: request.body.intervalSec ?? current.intervalSec,
    enabled: request.body.enabled ?? current.enabled,
  });

  const keyword = await prisma.keyword.update({
    where: { id: request.params.id },
    data: {
      name: payload.name,
      terms: payload.terms,
      filters: payload.filters,
      intervalSec: payload.intervalSec,
      enabled: payload.enabled,
    },
  });

  return { keyword };
});

app.delete<{ Params: { id: string } }>("/v1/keywords/:id", async (request, reply) => {
  const keyword = await prisma.keyword.findUnique({ where: { id: request.params.id } });
  if (!keyword) {
    return reply.code(404).send({ error: "Keyword not found" });
  }

  await prisma.keyword.update({
    where: { id: request.params.id },
    data: { enabled: false },
  });

  return { ok: true };
});

app.post<{ Params: { id: string } }>("/v1/keywords/:id/scan", async (request) => {
  const payload: ScanKeywordJob = {
    keywordId: request.params.id,
    triggeredBy: "manual",
  };

  const job = await scanQueue.add(QUEUE_NAMES.scan, payload, {
    removeOnComplete: true,
    removeOnFail: 1000,
    attempts: 3,
  });

  return { jobId: job.id };
});

app.get<{ Params: { id: string } }>("/v1/jobs/:id", async (request, reply) => {
  const queues = [scanQueue, notifyQueue, summaryQueue, retryQueue];
  for (const queue of queues) {
    const job = await queue.getJob(request.params.id);
    if (job) {
      return {
        queue: queue.name,
        id: job.id,
        name: job.name,
        data: job.data,
        attemptsMade: job.attemptsMade,
        failedReason: job.failedReason,
        timestamp: job.timestamp,
        processedOn: job.processedOn,
        finishedOn: job.finishedOn,
      };
    }
  }

  return reply.code(404).send({ error: "Job not found" });
});

app.get<{ Querystring: { limit?: string } }>("/v1/runs/recent", async (request) => {
  const limitRaw = Number.parseInt(request.query.limit ?? "50", 10);
  const limit = Number.isInteger(limitRaw) ? Math.min(Math.max(limitRaw, 1), 100) : 50;

  const runs = await prisma.scanRun.findMany({
    take: limit,
    orderBy: { startedAt: "desc" },
  });

  return { runs };
});

app.get<{ Querystring: { date?: string } }>("/v1/stats/daily", async (request) => {
  const dateParam = request.query.date ?? new Date().toISOString().slice(0, 10);
  const date = new Date(`${dateParam}T00:00:00.000Z`);

  const stats = await prisma.dailyKeywordCount.findMany({
    where: { dateUtc: date },
    include: { keyword: true },
    orderBy: { keyword: { name: "asc" } },
  });

  return {
    dateUtc: dateParam,
    stats: stats.map((row) => ({
      keywordId: row.keywordId,
      keywordName: row.keyword.name,
      sentCount: row.sentCount,
    })),
  };
});

app.post("/v1/config/reload", async () => {
  return {
    ok: true,
    message: "Runtime config is sourced from database; no in-memory cache refresh required",
  };
});

app.setErrorHandler((error, request, reply) => {
  logger.error(
    {
      path: request.url,
      method: request.method,
      error: redactUnknown(error),
    },
    "Unhandled API error",
  );

  reply.code(500).send({ error: "Internal server error" });
});

const shutdown = async (): Promise<void> => {
  await app.close();
  await prisma.$disconnect();
  await redis.quit();
  await Promise.all([scanQueue.close(), notifyQueue.close(), summaryQueue.close(), retryQueue.close()]);
};

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    logger.info({ signal }, "Shutting down API service");
    void shutdown().finally(() => process.exit(0));
  });
}

async function main(): Promise<void> {
  try {
    await initPrisma(prisma);
    await app.listen({
      host: "0.0.0.0",
      port: config.PORT,
    });
    logger.info({ port: config.PORT }, "API service started");
  } catch (error) {
    logger.error({ error: redactUnknown(error) }, "Failed to start API service");
    await shutdown();
    process.exit(1);
  }
}

void main();
