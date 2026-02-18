import type { PrismaClient } from "@prisma/client";
import type { Logger } from "pino";

import {
  buildDedupeKey,
  deriveSourceListingId,
  redactUnknown,
  scanMercariTerm,
  type AppConfig,
  type Metrics,
} from "@mercari-bot/core";

export interface ScannerDeps {
  config: AppConfig;
  logger: Logger;
  metrics: Metrics;
  prisma: PrismaClient;
}

function parseFilters(raw: unknown): {
  priceMin: number | null;
  priceMax: number | null;
  titleMustContain: string[];
  excludeKeyword: string | null;
} {
  if (!raw || typeof raw !== "object") {
    return {
      priceMin: null,
      priceMax: null,
      titleMustContain: [],
      excludeKeyword: null,
    };
  }

  const row = raw as Record<string, unknown>;

  return {
    priceMin: typeof row.priceMin === "number" ? row.priceMin : null,
    priceMax: typeof row.priceMax === "number" ? row.priceMax : null,
    titleMustContain: Array.isArray(row.titleMustContain)
      ? row.titleMustContain.filter((term): term is string => typeof term === "string")
      : [],
    excludeKeyword: typeof row.excludeKeyword === "string" ? row.excludeKeyword : null,
  };
}

export async function scanKeyword(
  keywordId: string,
  triggeredBy: "scheduler" | "manual" | "retry",
  deps: ScannerDeps,
): Promise<{ runId: string; itemsFound: number; itemsNew: number }> {
  const { config, logger, metrics, prisma } = deps;

  const keyword = await prisma.keyword.findUnique({ where: { id: keywordId } });
  if (!keyword || !keyword.enabled) {
    logger.warn({ keywordId, triggeredBy }, "Scan skipped because keyword is missing or disabled");
    return { runId: "", itemsFound: 0, itemsNew: 0 };
  }

  const run = await prisma.scanRun.create({
    data: {
      keywordId: keyword.id,
      status: "running",
    },
  });

  const startedAt = Date.now();
  let itemsFound = 0;
  let itemsNew = 0;

  try {
    const filters = parseFilters(keyword.filters);
    const terms = Array.isArray(keyword.terms)
      ? keyword.terms.filter((term): term is string => typeof term === "string")
      : [];

    for (const term of terms) {
      let scraped = [];

      try {
        scraped = await scanMercariTerm({
          term,
          filters,
          timeoutMs: config.SCRAPE_HTTP_TIMEOUT_MS,
          maxItems: config.SCRAPE_MAX_ITEMS_PER_TERM,
        });
      } catch (error) {
        metrics.scrapeRequestFailuresTotal.labels(keyword.name).inc();
        logger.error(
          {
            keywordId: keyword.id,
            keywordName: keyword.name,
            term,
            error: redactUnknown(error),
          },
          "Mercari API scan failed for term",
        );
        continue;
      }

      itemsFound += scraped.length;

      for (const listing of scraped) {
        const sourceListingId = deriveSourceListingId(listing.url);
        const dedupeKey = buildDedupeKey({
          sourceListingId,
          url: listing.url,
          title: listing.title,
          imageUrl: listing.imageUrl,
        });

        const savedListing = await prisma.listing.upsert({
          where: { url: listing.url },
          create: {
            sourceListingId,
            title: listing.title,
            url: listing.url,
            imageUrl: listing.imageUrl,
            currency: listing.currency,
            numericPrice: listing.numericPrice,
            rawPriceDisplay: listing.rawPriceDisplay,
            rawJson: listing.rawJson,
            scrapedAt: new Date(),
            keywordId: keyword.id,
          },
          update: {
            title: listing.title,
            imageUrl: listing.imageUrl,
            currency: listing.currency,
            numericPrice: listing.numericPrice,
            rawPriceDisplay: listing.rawPriceDisplay,
            rawJson: listing.rawJson,
            scrapedAt: new Date(),
          },
        });

        const seen = await prisma.seenListing.findUnique({ where: { dedupeKey } });
        const isNewOrCheaper = !seen || Number(seen.lastPrice) > listing.numericPrice;

        if (seen) {
          await prisma.seenListing.update({
            where: { dedupeKey },
            data: {
              listingId: savedListing.id,
              keywordId: keyword.id,
              lastSeenAt: new Date(),
              lastPrice: listing.numericPrice,
            },
          });
        } else {
          await prisma.seenListing.create({
            data: {
              dedupeKey,
              listingId: savedListing.id,
              keywordId: keyword.id,
              lastPrice: listing.numericPrice,
              firstSeenAt: new Date(),
              lastSeenAt: new Date(),
            },
          });
        }

        if (!isNewOrCheaper) {
          continue;
        }

        itemsNew += 1;
        await prisma.notification.create({
          data: {
            listingId: savedListing.id,
            keywordId: keyword.id,
            channel: "telegram",
            status: "pending",
          },
        });
      }
    }

    await prisma.scanRun.update({
      where: { id: run.id },
      data: {
        status: "success",
        itemsFound,
        itemsNew,
        finishedAt: new Date(),
      },
    });

    metrics.scanItemsFoundTotal.labels(keyword.name).inc(itemsFound);
    metrics.scanItemsNewTotal.labels(keyword.name).inc(itemsNew);
    metrics.scanDurationSeconds.labels(keyword.name).observe((Date.now() - startedAt) / 1000);

    logger.info(
      {
        keywordId: keyword.id,
        keywordName: keyword.name,
        itemsFound,
        itemsNew,
        triggeredBy,
      },
      "Scan finished",
    );
  } catch (error) {
    await prisma.scanRun.update({
      where: { id: run.id },
      data: {
        status: "failed",
        errorCode: "scan_failed",
        errorMessage: error instanceof Error ? error.message.slice(0, 500) : "unknown_error",
        finishedAt: new Date(),
      },
    });

    logger.error(
      {
        keywordId: keyword.id,
        error: redactUnknown(error),
      },
      "Scan failed",
    );

    throw error;
  }

  return { runId: run.id, itemsFound, itemsNew };
}
