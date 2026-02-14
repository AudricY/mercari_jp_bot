import "dotenv/config";

import { NotificationStatus } from "@prisma/client";

import {
  QUEUE_NAMES,
  buildDedupeKey,
  buildLogger,
  buildMetrics,
  createQueue,
  createWorker,
  deriveSourceListingId,
  loadConfig,
  redactUnknown,
  type NotifyItemJob,
  type QueuePayloadMap,
  type ScanKeywordJob,
} from "@mercari-bot/core";
import { createPrismaClient } from "@mercari-bot/db";

import { scanMercariTerm } from "./scrape.js";

const config = loadConfig();
const logger = buildLogger(config.LOG_LEVEL);
const metrics = buildMetrics();
const prisma = createPrismaClient();

const notifyQueue = createQueue("notify-item", config.REDIS_URL);

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

const worker = createWorker(
  "scan-keyword",
  config.REDIS_URL,
  async (job) => {
    const payload = job.data as ScanKeywordJob;
    const queueLatencySeconds = Math.max(0, (Date.now() - job.timestamp) / 1000);
    metrics.queueJobLatencySeconds.labels("scan-keyword").observe(queueLatencySeconds);

    const keyword = await prisma.keyword.findUnique({ where: { id: payload.keywordId } });
    if (!keyword || !keyword.enabled) {
      logger.warn({ payload }, "Scan job skipped because keyword is missing or disabled");
      return;
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
              scrapedAt: new Date(),
              keywordId: keyword.id,
            },
            update: {
              title: listing.title,
              imageUrl: listing.imageUrl,
              currency: listing.currency,
              numericPrice: listing.numericPrice,
              rawPriceDisplay: listing.rawPriceDisplay,
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
          const notification = await prisma.notification.create({
            data: {
              listingId: savedListing.id,
              keywordId: keyword.id,
              channel: "telegram",
              status: NotificationStatus.pending,
            },
          });

          const notifyPayload: NotifyItemJob = {
            itemId: notification.id,
            keywordId: keyword.id,
            channel: "telegram",
          };

          await notifyQueue.add(QUEUE_NAMES.notify, notifyPayload, {
            removeOnComplete: true,
            removeOnFail: 1000,
            attempts: 4,
            backoff: {
              type: "exponential",
              delay: 1000,
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
          triggeredBy: payload.triggeredBy,
        },
        "Scan job finished",
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
          jobId: job.id,
          keywordId: keyword.id,
          error: redactUnknown(error),
        },
        "Scan job failed",
      );

      throw error;
    }
  },
  {
    concurrency: config.SCRAPE_CONCURRENCY,
  },
);

metrics.activeWorkers.labels("scrape").set(1);

worker.on("failed", (job, error) => {
  logger.error(
    {
      queue: QUEUE_NAMES.scan,
      jobId: job?.id,
      error: redactUnknown(error),
    },
    "Queue job failed",
  );
});

worker.on("completed", (job) => {
  logger.debug({ queue: QUEUE_NAMES.scan, jobId: job.id }, "Queue job completed");
});

async function shutdown(): Promise<void> {
  metrics.activeWorkers.labels("scrape").set(0);
  await worker.close();
  await notifyQueue.close();
  await prisma.$disconnect();
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    logger.info({ signal }, "Shutting down scrape worker");
    void shutdown().finally(() => process.exit(0));
  });
}

logger.info(
  {
    queue: QUEUE_NAMES.scan,
    concurrency: config.SCRAPE_CONCURRENCY,
  },
  "Scrape worker started",
);
