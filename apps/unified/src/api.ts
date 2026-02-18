import type { PrismaClient } from "@prisma/client";
import Fastify from "fastify";
import type { Logger } from "pino";

import { redactUnknown, type AppConfig, type Metrics } from "@mercari-bot/core";

import { assertAdminAccess } from "./auth.js";
import { scanKeyword } from "./scanner.js";

export interface ApiDeps {
  config: AppConfig;
  logger: Logger;
  metrics: Metrics;
  prisma: PrismaClient;
}

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

  return app;
}
