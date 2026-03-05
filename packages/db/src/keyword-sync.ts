import type { PrismaClient } from "@prisma/client";

import { ensureTelegramTopic, type AppConfig, type Logger, type ParsedYamlKeyword } from "@mercari-bot/core";

export interface SyncResult {
  created: string[];
  updated: string[];
  disabled: string[];
  topicsCreated: string[];
}

export async function syncKeywordsFromConfig(
  prisma: PrismaClient,
  keywords: ParsedYamlKeyword[],
  config: AppConfig,
  logger: Logger,
): Promise<SyncResult> {
  const result: SyncResult = { created: [], updated: [], disabled: [], topicsCreated: [] };

  // Resolve unique topics
  const uniqueTopics = [...new Set(keywords.map((k) => k.topic).filter((t): t is string => t !== null))];
  const topicIdMap = new Map<string, string | null>();

  for (const topicName of uniqueTopics) {
    const res = await ensureTelegramTopic(topicName, config, prisma, logger);
    topicIdMap.set(topicName, res.dbId);
    if (res.created) {
      result.topicsCreated.push(topicName);
    }
  }

  const existing = await prisma.keyword.findMany();
  const existingByName = new Map(existing.map((k) => [k.name, k]));
  const yamlNames = new Set(keywords.map((k) => k.name));

  for (const kw of keywords) {
    const topicId = kw.topic ? topicIdMap.get(kw.topic) ?? null : null;
    const current = existingByName.get(kw.name);

    if (current) {
      await prisma.keyword.update({
        where: { name: kw.name },
        data: {
          enabled: true,
          terms: kw.terms,
          filters: kw.filters,
          intervalSec: kw.intervalSec,
          topicName: kw.topic,
          topicId,
        },
      });
      result.updated.push(kw.name);
    } else {
      await prisma.keyword.create({
        data: {
          name: kw.name,
          enabled: true,
          terms: kw.terms,
          filters: kw.filters,
          intervalSec: kw.intervalSec,
          topicName: kw.topic,
          topicId,
        },
      });
      result.created.push(kw.name);
    }
  }

  for (const row of existing) {
    if (!yamlNames.has(row.name) && row.enabled) {
      await prisma.keyword.update({
        where: { id: row.id },
        data: { enabled: false },
      });
      result.disabled.push(row.name);
    }
  }

  return result;
}
