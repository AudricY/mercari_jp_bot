import "dotenv/config";

import { EbayClient, buildLogger, buildMetrics, loadConfig, redactUnknown } from "@mercari-bot/core";
import { createPrismaClient, initPrisma } from "@mercari-bot/db";

import { EbayRequestScheduler } from "./ebay-request-scheduler.js";
import { syncEbayQueriesFromDisk } from "./ebay-config.js";
import { runDueEbayScans } from "./ebay-scanner.js";

/**
 * One-shot eBay scan runner for ops/backfill: syncs eBay queries from disk,
 * runs every due eBay job once, then exits. Requires EBAY_CLIENT_ID /
 * EBAY_CLIENT_SECRET (EBAY_SCAN_ENABLED is not consulted here — running this
 * script is the explicit intent).
 *
 * Optionally restrict to specific query ids:
 *   pnpm --filter @mercari-bot/unified run ebay-scan-once -- us-ps3-console
 */
const config = loadConfig();
const logger = buildLogger(config.LOG_LEVEL);
const metrics = buildMetrics();
const prisma = createPrismaClient();

async function main(): Promise<void> {
  if (!config.EBAY_CLIENT_ID || !config.EBAY_CLIENT_SECRET) {
    throw new Error("EBAY_CLIENT_ID / EBAY_CLIENT_SECRET must be set");
  }

  const ebayClient = new EbayClient({
    clientId: config.EBAY_CLIENT_ID,
    clientSecret: config.EBAY_CLIENT_SECRET,
    marketplaceId: config.EBAY_MARKETPLACE_ID,
    environment: config.EBAY_ENVIRONMENT,
    timeoutMs: config.SCRAPE_HTTP_TIMEOUT_MS,
  });
  const ebayRequests = new EbayRequestScheduler({ config, logger, metrics });

  await initPrisma(prisma);
  const sync = await syncEbayQueriesFromDisk(prisma);
  logger.info(sync, "eBay query sync complete");

  const onlyIds = process.argv.slice(2).filter((arg) => arg.trim().length > 0);

  if (onlyIds.length > 0) {
    // Narrow the run by disabling the others, run, then restore catalog truth.
    await prisma.ebayQuery.updateMany({
      where: { id: { notIn: onlyIds } },
      data: { enabled: false },
    });
  }

  try {
    await runDueEbayScans({ config, logger, metrics, prisma, ebayClient, ebayRequests });
  } finally {
    if (onlyIds.length > 0) {
      await syncEbayQueriesFromDisk(prisma);
    }
  }

  await prisma.$disconnect();
  metrics.registry.clear();
}

main().catch(async (error) => {
  logger.error({ error: redactUnknown(error) }, "eBay scan once failed");
  await prisma.$disconnect();
  process.exit(1);
});
