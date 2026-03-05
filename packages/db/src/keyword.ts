import type { Keyword, PrismaClient } from "@prisma/client";

import type { KeywordConfig, KeywordFilters } from "@mercari-bot/core";

function parseFilters(raw: unknown): KeywordFilters {
  const fallback: KeywordFilters = {
    priceMin: null,
    priceMax: null,
    titleMustContain: [],
    excludeKeyword: null,
  };

  if (!raw || typeof raw !== "object") {
    return fallback;
  }

  const asRecord = raw as Record<string, unknown>;
  const titleMustContain = Array.isArray(asRecord.titleMustContain)
    ? asRecord.titleMustContain.filter((value): value is string => typeof value === "string")
    : [];

  return {
    priceMin: typeof asRecord.priceMin === "number" ? asRecord.priceMin : null,
    priceMax: typeof asRecord.priceMax === "number" ? asRecord.priceMax : null,
    titleMustContain,
    excludeKeyword: typeof asRecord.excludeKeyword === "string" ? asRecord.excludeKeyword : null,
  };
}

function parseTerms(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw.filter((value): value is string => typeof value === "string" && value.trim().length > 0);
}

export function mapKeyword(model: Keyword): KeywordConfig {
  return {
    id: model.id,
    name: model.name,
    enabled: model.enabled,
    terms: parseTerms(model.terms),
    filters: parseFilters(model.filters),
    intervalSec: model.intervalSec,
    topicName: model.topicName ?? null,
    createdAt: model.createdAt,
    updatedAt: model.updatedAt,
  };
}

export async function getEnabledKeywords(prisma: PrismaClient): Promise<KeywordConfig[]> {
  const rows = await prisma.keyword.findMany({
    where: { enabled: true },
    orderBy: { name: "asc" },
  });

  return rows.map(mapKeyword);
}
