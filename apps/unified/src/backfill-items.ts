import "dotenv/config";

import { buildLogger, buildMetrics, loadConfig, redactUnknown } from "@mercari-bot/core";
import { createPrismaClient, initPrisma } from "@mercari-bot/db";

import { refreshDailyItemMarketStats } from "./market-stats.js";
import { backfillListingItems } from "./items.js";
import { syncConfigFromDisk } from "./sync.js";

const config = loadConfig();
const logger = buildLogger(config.LOG_LEVEL);
const metrics = buildMetrics();
const prisma = createPrismaClient();

async function main(): Promise<void> {
  await initPrisma(prisma);
  await syncConfigFromDisk(prisma, logger, config);

  const result = await backfillListingItems(prisma);
  await refreshDailyItemMarketStats(new Date(), { prisma, logger });

  logger.info(
    {
      scanned: result.scanned,
      updated: result.updated,
    },
    "Item backfill complete",
  );

  await prisma.$disconnect();
  metrics.registry.clear();
}

main().catch(async (error) => {
  logger.error({ error: redactUnknown(error) }, "Item backfill failed");
  await prisma.$disconnect();
  process.exit(1);
});
