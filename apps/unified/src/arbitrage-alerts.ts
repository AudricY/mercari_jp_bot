import type { PrismaClient } from "@prisma/client";
import type { Logger } from "pino";

import { redactUnknown, type AppConfig, type Metrics } from "@mercari-bot/core";

import { buildArbitrageReport, compileArbitrageProduct, matchesMercariTitle } from "./arbitrage.js";
import { sendTelegramText } from "./notifier.js";

export interface ArbitrageAlerterDeps {
  config: AppConfig;
  logger: Logger;
  metrics: Metrics;
  prisma: PrismaClient;
}

const ALERTED_IDS_MAX = 5000;

/**
 * Watches newly collected Mercari market listings and pings Telegram when one
 * matches an arbitrage product at or below its effective max-buy price
 * (manual override, else derived from eBay comps at the target ROI).
 *
 * Listing discovery rides on the market scanner's ingestion (firstSeenAt), so
 * alert latency ≈ the category's new-sweep interval plus the check interval.
 */
export function startArbitrageAlerter(deps: ArbitrageAlerterDeps): { stop: () => void } {
  const { config, logger } = deps;
  let stopped = false;

  if (!config.ARBITRAGE_ALERTS_ENABLED) {
    logger.info("Arbitrage alerter disabled (ARBITRAGE_ALERTS_ENABLED=false)");
    return { stop() {} };
  }

  logger.info(
    { checkSeconds: config.ARBITRAGE_ALERT_CHECK_SECONDS },
    "Arbitrage alerter started",
  );

  // Only alert on listings discovered after startup; the backlog is the
  // dashboard's job. Dedupe survives across ticks but not restarts.
  let cursor = new Date();
  const alertedIds = new Set<string>();

  async function tick(): Promise<void> {
    const tickStartedAt = new Date();
    const sent = await checkArbitrageAlerts(deps, cursor, alertedIds);
    cursor = tickStartedAt;
    if (sent > 0) {
      logger.info({ sent }, "Arbitrage alerts sent");
    }
    if (alertedIds.size > ALERTED_IDS_MAX) {
      alertedIds.clear();
    }
  }

  async function loop(): Promise<void> {
    while (!stopped) {
      try {
        await tick();
      } catch (error) {
        logger.error({ error: redactUnknown(error) }, "Arbitrage alert check failed");
      }
      if (!stopped) {
        await new Promise((resolve) => setTimeout(resolve, config.ARBITRAGE_ALERT_CHECK_SECONDS * 1000));
      }
    }
  }

  void loop();

  return {
    stop() {
      stopped = true;
    },
  };
}

export async function checkArbitrageAlerts(
  deps: ArbitrageAlerterDeps,
  since: Date,
  alertedIds: Set<string>,
): Promise<number> {
  const { config, prisma } = deps;

  const report = await buildArbitrageReport(deps);
  const thresholds = new Map(
    report.opportunities
      .filter((opportunity) => opportunity.effectiveMaxBuyJpy !== null)
      .map((opportunity) => [opportunity.slug, opportunity.effectiveMaxBuyJpy!]),
  );
  if (thresholds.size === 0) {
    return 0;
  }

  const products = (await prisma.arbitrageProduct.findMany({ where: { enabled: true } }))
    .map(compileArbitrageProduct)
    .filter((product) => thresholds.has(product.id));

  const categoryIds = [...new Set(products.flatMap((product) => product.mercariCategoryIds))];
  if (categoryIds.length === 0) {
    return 0;
  }

  const fresh = await prisma.marketListing.findMany({
    where: {
      categoryId: { in: categoryIds },
      status: "on_sale",
      firstSeenAt: { gte: since },
    },
    select: { mercariId: true, categoryId: true, title: true, price: true },
  });

  let sent = 0;
  for (const listing of fresh) {
    if (alertedIds.has(listing.mercariId)) {
      continue;
    }

    for (const product of products) {
      if (!product.mercariCategoryIds.includes(listing.categoryId)) {
        continue;
      }
      if (!matchesMercariTitle(product, listing.title)) {
        continue;
      }
      const maxBuy = thresholds.get(product.id)!;
      if (listing.price > maxBuy) {
        continue;
      }

      const opportunity = report.opportunities.find((entry) => entry.slug === product.id);
      const comp = opportunity?.ebay.medianLiveUsd;
      const lines = [
        `🎯 Arbitrage buy: ${product.label}`,
        `${listing.title}`,
        `Price: ¥${listing.price.toLocaleString()} (max buy ¥${maxBuy.toLocaleString()})`,
        comp != null ? `eBay comp (median live): $${comp}` : "eBay comp: n/a (manual threshold)",
        `https://jp.mercari.com/item/${listing.mercariId}`,
      ];

      await sendTelegramText(deps, lines.join("\n"), config.ARBITRAGE_ALERT_TOPIC_NAME || undefined);
      alertedIds.add(listing.mercariId);
      sent += 1;
      break; // one alert per listing even if multiple products match
    }
  }

  return sent;
}
