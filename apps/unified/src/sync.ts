import fs from "node:fs/promises";
import path from "node:path";

import type { PrismaClient } from "@prisma/client";
import type { Logger } from "pino";

import { parseYamlConfig } from "@mercari-bot/core";
import { syncKeywordsFromConfig, type SyncResult } from "@mercari-bot/db";

export async function syncConfigFromDisk(prisma: PrismaClient, logger: Logger): Promise<SyncResult> {
  const configPath = process.env.CONFIG_PATH ?? path.resolve(process.cwd(), "config.yaml");
  const content = await fs.readFile(configPath, "utf-8");
  const keywords = parseYamlConfig(content);

  logger.info({ keywordCount: keywords.length }, "Parsed config.yaml");

  const result = await syncKeywordsFromConfig(prisma, keywords);

  logger.info(
    {
      created: result.created,
      updated: result.updated,
      disabled: result.disabled,
    },
    "Keyword sync complete",
  );

  return result;
}
