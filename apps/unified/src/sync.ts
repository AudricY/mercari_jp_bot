import fs from "node:fs/promises";
import path from "node:path";

import type { PrismaClient } from "@prisma/client";
import type { Logger } from "pino";

import { parseYamlConfig, type AppConfig } from "@mercari-bot/core";
import { syncKeywordsFromConfig, type SyncResult } from "@mercari-bot/db";

import { syncItemsFromDisk, type ItemSyncResult } from "./items.js";

export interface CatalogSyncResult {
  keywords: SyncResult;
  items: ItemSyncResult;
}

export async function syncConfigFromDisk(
  prisma: PrismaClient,
  logger: Logger,
  config: AppConfig,
): Promise<CatalogSyncResult> {
  const configPath = process.env.CONFIG_PATH ?? path.resolve(process.cwd(), "config.yaml");
  const content = await fs.readFile(configPath, "utf-8");
  const keywords = parseYamlConfig(content);

  logger.info({ keywordCount: keywords.length }, "Parsed config.yaml");

  const [keywordsResult, itemsResult] = await Promise.all([
    syncKeywordsFromConfig(prisma, keywords, config, logger),
    syncItemsFromDisk(prisma),
  ]);

  logger.info(
    {
      created: keywordsResult.created,
      updated: keywordsResult.updated,
      disabled: keywordsResult.disabled,
      topicsCreated: keywordsResult.topicsCreated,
    },
    "Keyword sync complete",
  );

  logger.info(
    {
      created: itemsResult.created,
      updated: itemsResult.updated,
      disabled: itemsResult.disabled,
    },
    "Item sync complete",
  );

  return {
    keywords: keywordsResult,
    items: itemsResult,
  };
}
