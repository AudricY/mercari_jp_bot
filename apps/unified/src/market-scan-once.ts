import "dotenv/config";

import { buildLogger, buildMetrics, loadConfig, redactUnknown } from "@mercari-bot/core";
import { createPrismaClient, initPrisma } from "@mercari-bot/db";

import { MercariRequestScheduler } from "./mercari-request-scheduler.js";
import { syncMarketCategoriesFromDisk } from "./market-config.js";
import { runDueMarketScans } from "./market-scanner.js";
import { refreshDailyCategoryMarketStats } from "./market-stats.js";

/**
 * One-shot market scan runner for ops/backfill: syncs market categories from
 * disk, runs every due market job once (initial run = full backfill of all
 * enabled categories), refreshes daily category stats, then exits.
 *
 * Optionally restrict to specific category ids:
 *   pnpm --filter @mercari-bot/unified run market-scan-once -- 7091 6988
 */
const config = loadConfig();
const logger = buildLogger(config.LOG_LEVEL);
const metrics = buildMetrics();
const prisma = createPrismaClient();
const mercariRequests = new MercariRequestScheduler({ config, logger, metrics });

async function main(): Promise<void> {
  await initPrisma(prisma);
  const sync = await syncMarketCategoriesFromDisk(prisma);
  logger.info(sync, "Market category sync complete");

  const onlyIds = process.argv
    .slice(2)
    .map((arg) => Number.parseInt(arg, 10))
    .filter((id) => Number.isInteger(id) && id > 0);

  if (onlyIds.length > 0) {
    // Temporarily narrow the run by disabling the others in-memory via a
    // where-filtered scan: simplest is to disable rows, run, re-enable.
    await prisma.marketCategory.updateMany({
      where: { id: { notIn: onlyIds } },
      data: { enabled: false },
    });
  }

  try {
    await runDueMarketScans({ config, logger, metrics, prisma, mercariRequests });
    await refreshDailyCategoryMarketStats(new Date(), { prisma, logger });
  } finally {
    if (onlyIds.length > 0) {
      // Restore catalog truth.
      await syncMarketCategoriesFromDisk(prisma);
    }
  }

  await prisma.$disconnect();
  metrics.registry.clear();
}

main().catch(async (error) => {
  logger.error({ error: redactUnknown(error) }, "Market scan once failed");
  await prisma.$disconnect();
  process.exit(1);
});
