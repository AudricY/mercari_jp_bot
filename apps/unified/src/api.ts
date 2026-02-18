import type { PrismaClient } from "@prisma/client";
import Fastify from "fastify";
import type { Logger } from "pino";

import { redactUnknown, type AppConfig, type Metrics } from "@mercari-bot/core";

import { assertAdminAccess } from "./auth.js";
import { scanKeyword } from "./scanner.js";
import { syncConfigFromDisk } from "./sync.js";

export interface ApiDeps {
  config: AppConfig;
  logger: Logger;
  metrics: Metrics;
  prisma: PrismaClient;
}

export function createApi(deps: ApiDeps) {
  const { config, logger, metrics, prisma } = deps;

  const app = Fastify({
    loggerInstance: logger,
    trustProxy: true,
  });

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

  app.post<{ Params: { id: string } }>("/v1/keywords/:id/scan", async (request) => {
    // Fire scan in background, don't await
    const scanPromise = scanKeyword(request.params.id, "manual", deps).catch((error) => {
      logger.error({ keywordId: request.params.id, error: redactUnknown(error) }, "Manual scan failed");
      return null;
    });

    void scanPromise;
    return { ok: true };
  });

  app.get<{ Params: { id: string } }>("/v1/runs/:id", async (request, reply) => {
    const run = await prisma.scanRun.findUnique({ where: { id: request.params.id } });
    if (!run) {
      return reply.code(404).send({ error: "Run not found" });
    }
    return run;
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
    const result = await syncConfigFromDisk(prisma, logger);
    return { ok: true, ...result };
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

  return app;
}
