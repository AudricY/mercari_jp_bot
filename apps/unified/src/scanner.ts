import type { PrismaClient } from "@prisma/client";
import type { Logger } from "pino";

import { setTimeout } from "node:timers/promises";

import {
  buildDedupeKey,
  deriveSourceListingId,
  fetchMercariItemDetail,
  redactUnknown,
  scanMercariTerm,
  type AppConfig,
  type Metrics,
} from "@mercari-bot/core";

import { classifyListing, loadCompiledItems } from "./items.js";
import { MercariRequestScheduler, mercariStatusCode } from "./mercari-request-scheduler.js";

export interface ScannerDeps {
  config: AppConfig;
  logger: Logger;
  metrics: Metrics;
  prisma: PrismaClient;
  mercariRequests?: MercariRequestScheduler;
}

function parseFilters(raw: unknown): {
  priceMin: number | null;
  priceMax: number | null;
  titleMustContain: string[];
  excludeKeyword: string | null;
  categoryId: number[];
} {
  if (!raw || typeof raw !== "object") {
    return {
      priceMin: null,
      priceMax: null,
      titleMustContain: [],
      excludeKeyword: null,
      categoryId: [],
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
    categoryId: Array.isArray(row.categoryId)
      ? row.categoryId.filter((id): id is number => typeof id === "number")
      : [],
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
  let termsAttempted = 0;
  let termsSucceeded = 0;
  let termsRateLimited = 0;
  let termsFailed = 0;

  try {
    const filters = parseFilters(keyword.filters);
    const terms = Array.isArray(keyword.terms)
      ? keyword.terms.filter((term): term is string => typeof term === "string")
      : [];
    const items = await loadCompiledItems(prisma);
    const mercariRequests =
      deps.mercariRequests ?? new MercariRequestScheduler({ config, logger, metrics });

    for (const term of terms) {
      let scraped = [];
      let termItemsNew = 0;
      const termStartedAt = Date.now();

      try {
        termsAttempted += 1;
        scraped = await mercariRequests.request("search", () =>
          scanMercariTerm({
            term,
            filters,
            timeoutMs: config.SCRAPE_HTTP_TIMEOUT_MS,
            maxItems: config.SCRAPE_MAX_ITEMS_PER_TERM,
          }),
        );
        termsSucceeded += 1;
        metrics.scanTermsTotal.labels(keyword.name, "success").inc();
      } catch (error) {
        const statusCode = mercariStatusCode(error);
        metrics.scrapeRequestFailuresTotal.labels(keyword.name).inc();
        if (statusCode === 429) {
          termsRateLimited += 1;
          metrics.scanTermsTotal.labels(keyword.name, "rate_limited").inc();
        } else {
          termsFailed += 1;
          metrics.scanTermsTotal.labels(keyword.name, "failed").inc();
        }
        logger.error(
          {
            keywordId: keyword.id,
            keywordName: keyword.name,
            term,
            statusCode,
            error: redactUnknown(error),
          },
          "Mercari API scan failed for term",
        );
        await prisma.scanRunTerm.create({
          data: {
            scanRunId: run.id,
            term,
            status: statusCode === 429 ? "rate_limited" : "failed",
            statusCode,
            durationMs: Date.now() - termStartedAt,
            errorMessage: error instanceof Error ? error.message.slice(0, 500) : "unknown_error",
          },
        });
        if (statusCode === 429) {
          break;
        }
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

        const now = new Date();
        const initialMatch = classifyListing(
          {
            title: listing.title,
            rawJson: listing.rawJson,
            keywordName: keyword.name,
          },
          items,
        );

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
            scrapedAt: now,
            keywordId: keyword.id,
            itemId: initialMatch.itemId,
            itemMatchStatus: initialMatch.itemMatchStatus,
            itemSubfamily: initialMatch.itemSubfamily,
          },
          update: {
            title: listing.title,
            imageUrl: listing.imageUrl,
            currency: listing.currency,
            numericPrice: listing.numericPrice,
            rawPriceDisplay: listing.rawPriceDisplay,
            rawJson: listing.rawJson,
            scrapedAt: now,
            itemId: initialMatch.itemId,
            itemMatchStatus: initialMatch.itemMatchStatus,
            itemSubfamily: initialMatch.itemSubfamily,
          },
        });

        if (savedListing.rawDetailJson) {
          const refinedMatch = classifyListing(
            {
              title: savedListing.title,
              rawJson: savedListing.rawJson,
              rawDetailJson: savedListing.rawDetailJson,
              keywordName: keyword.name,
            },
            items,
          );
          if (
            refinedMatch.itemId !== initialMatch.itemId
            || refinedMatch.itemMatchStatus !== initialMatch.itemMatchStatus
            || refinedMatch.itemSubfamily !== initialMatch.itemSubfamily
          ) {
            await prisma.listing.update({
              where: { id: savedListing.id },
              data: {
                itemId: refinedMatch.itemId,
                itemMatchStatus: refinedMatch.itemMatchStatus,
                itemSubfamily: refinedMatch.itemSubfamily,
              },
            });
          }
        }

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

        if (config.SCRAPE_DETAIL_ENABLED && sourceListingId) {
          try {
            const rawDetailJson = await mercariRequests.request("detail", () =>
              fetchMercariItemDetail({
                itemId: sourceListingId,
                timeoutMs: config.SCRAPE_HTTP_TIMEOUT_MS,
              }),
            );
            const refinedMatch = classifyListing(
              {
                title: listing.title,
                rawJson: listing.rawJson,
                rawDetailJson,
                keywordName: keyword.name,
              },
              items,
            );
            await prisma.listing.update({
              where: { id: savedListing.id },
              data: {
                rawDetailJson,
                itemId: refinedMatch.itemId,
                itemMatchStatus: refinedMatch.itemMatchStatus,
                itemSubfamily: refinedMatch.itemSubfamily,
              },
            });
          } catch (error) {
            logger.warn(
              {
                listingId: savedListing.id,
                sourceListingId,
                error: redactUnknown(error),
              },
              "Failed to fetch item detail, continuing without it",
            );
          }
          const jitteredDelay = Math.floor(config.SCRAPE_DETAIL_DELAY_MS * (0.6 + Math.random() * 0.8));
          await setTimeout(jitteredDelay);
        }

        itemsNew += 1;
        termItemsNew += 1;
        await prisma.notification.create({
          data: {
            listingId: savedListing.id,
            keywordId: keyword.id,
            channel: "telegram",
            status: "pending",
          },
        });
      }

      await prisma.scanRunTerm.create({
        data: {
          scanRunId: run.id,
          term,
          status: "success",
          itemsFound: scraped.length,
          itemsNew: termItemsNew,
          durationMs: Date.now() - termStartedAt,
        },
      });
    }

    await prisma.scanRun.update({
      where: { id: run.id },
      data: {
        status: scanRunStatus({ terms, termsSucceeded, termsRateLimited, termsFailed }),
        itemsFound,
        itemsNew,
        termsAttempted,
        termsSucceeded,
        termsRateLimited,
        termsFailed,
        errorCode: termsRateLimited > 0 ? "rate_limited" : termsFailed > 0 ? "term_failed" : null,
        errorMessage: scanRunErrorMessage({ terms, termsAttempted, termsSucceeded, termsRateLimited, termsFailed }),
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
        termsAttempted,
        termsSucceeded,
        termsRateLimited,
        termsFailed,
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

function scanRunStatus(params: {
  terms: string[];
  termsSucceeded: number;
  termsRateLimited: number;
  termsFailed: number;
}): string {
  if (params.termsRateLimited > 0 && params.termsSucceeded === 0) {
    return "rate_limited";
  }
  if (params.termsRateLimited > 0 || params.termsFailed > 0 || params.termsSucceeded < params.terms.length) {
    return "partial";
  }
  return "success";
}

function scanRunErrorMessage(params: {
  terms: string[];
  termsAttempted: number;
  termsSucceeded: number;
  termsRateLimited: number;
  termsFailed: number;
}): string | null {
  if (params.termsRateLimited === 0 && params.termsFailed === 0) {
    return null;
  }

  return [
    `terms=${params.terms.length}`,
    `attempted=${params.termsAttempted}`,
    `succeeded=${params.termsSucceeded}`,
    `rateLimited=${params.termsRateLimited}`,
    `failed=${params.termsFailed}`,
  ].join(" ");
}
