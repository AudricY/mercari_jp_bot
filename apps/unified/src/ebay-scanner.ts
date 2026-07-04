import type { EbayQuery, PrismaClient } from "@prisma/client";
import type { Logger } from "pino";

import {
  EbayClient,
  ebayStatusCode,
  redactUnknown,
  type AppConfig,
  type EbayItemSummary,
  type Metrics,
} from "@mercari-bot/core";

import { EbayRequestScheduler } from "./ebay-request-scheduler.js";

export interface EbayScannerDeps {
  config: AppConfig;
  logger: Logger;
  metrics: Metrics;
  prisma: PrismaClient;
  ebayClient: EbayClient;
  ebayRequests: EbayRequestScheduler;
}

type EbayJobKind = "new_sweep" | "snapshot";

interface EbayJob {
  kind: EbayJobKind;
  query: EbayQuery;
}

interface PageOutcome {
  pagesFetched: number;
  itemsSeen: number;
  completed: boolean;
}

/** Browse API rejects requests where offset + limit exceeds this. */
const EBAY_MAX_RESULT_WINDOW = 10000;

/** In-memory backoff after a failed job so a broken query cannot spin. */
const jobBackoffUntil = new Map<string, number>();

function jobKey(job: EbayJob): string {
  return `${job.kind}:${job.query.id}`;
}

function isDue(lastRunAt: Date | null, intervalSec: number | null, nowEpochSec: number): boolean {
  if (intervalSec === null) {
    return false;
  }
  if (lastRunAt === null) {
    return true;
  }
  return nowEpochSec - Math.floor(lastRunAt.getTime() / 1000) >= intervalSec;
}

export async function collectDueEbayJobs(prisma: PrismaClient, nowEpochSec: number): Promise<EbayJob[]> {
  const queries = await prisma.ebayQuery.findMany({ where: { enabled: true } });
  const jobs: EbayJob[] = [];

  // Cheap delta sweeps first so a due snapshot cannot starve them.
  for (const query of queries) {
    if (isDue(query.lastNewSweepAt, query.newSweepIntervalSec, nowEpochSec)) {
      jobs.push({ kind: "new_sweep", query });
    }
  }
  for (const query of queries) {
    if (isDue(query.lastSnapshotAt, query.snapshotIntervalSec, nowEpochSec)) {
      jobs.push({ kind: "snapshot", query });
    }
  }

  return jobs;
}

function parseCreationDate(item: EbayItemSummary): Date | null {
  if (!item.itemCreationDate) {
    return null;
  }
  const parsed = new Date(item.itemCreationDate);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Items without a fixed price or web URL (rare API gaps) are not collectible. */
function isCollectible(item: EbayItemSummary): boolean {
  return Boolean(item.itemId && item.title && item.price?.value && item.itemWebUrl);
}

async function upsertPage(
  prisma: PrismaClient,
  queryId: string,
  items: EbayItemSummary[],
  seenAt: Date,
): Promise<void> {
  await prisma.$transaction(
    items.map((item) =>
      prisma.ebayListing.upsert({
        where: { ebayItemId: item.itemId },
        create: {
          ebayItemId: item.itemId,
          queryId,
          title: item.title,
          price: item.price!.value,
          currency: item.price!.currency,
          status: "on_sale",
          condition: item.condition ?? null,
          conditionId: item.conditionId ? Number(item.conditionId) : null,
          buyingOptions: item.buyingOptions?.join(",") ?? null,
          sellerUsername: item.seller?.username ?? null,
          itemWebUrl: item.itemWebUrl!,
          imageUrl: item.image?.imageUrl ?? null,
          ebayCreatedAt: parseCreationDate(item),
          firstSeenAt: seenAt,
          lastSeenAt: seenAt,
        },
        update: {
          title: item.title,
          price: item.price!.value,
          currency: item.price!.currency,
          status: "on_sale",
          condition: item.condition ?? null,
          conditionId: item.conditionId ? Number(item.conditionId) : null,
          buyingOptions: item.buyingOptions?.join(",") ?? null,
          lastSeenAt: seenAt,
        },
      }),
    ),
  );
}

async function runPagedSweep(
  deps: EbayScannerDeps,
  query: EbayQuery,
  options: {
    maxPages: number;
    /** Stop when a page's oldest creation date is at or below this cursor. */
    stopAtCreatedAt?: Date | null;
  },
): Promise<PageOutcome> {
  const { config, prisma, ebayClient, ebayRequests } = deps;
  const outcome: PageOutcome = { pagesFetched: 0, itemsSeen: 0, completed: false };
  const limit = config.EBAY_SCAN_PAGE_SIZE;
  let offset = 0;

  while (outcome.pagesFetched < options.maxPages && offset + limit <= EBAY_MAX_RESULT_WINDOW) {
    const result = await ebayRequests.request("search", () =>
      ebayClient.search({
        q: query.keyword ?? undefined,
        categoryIds: query.categoryId ? [query.categoryId] : undefined,
        filter: query.filter ?? undefined,
        sort: "newlyListed",
        limit,
        offset,
        marketplaceId: query.marketplaceId,
        timeoutMs: config.SCRAPE_HTTP_TIMEOUT_MS,
      }),
    );

    outcome.pagesFetched += 1;

    const collectible = result.items.filter(isCollectible);
    outcome.itemsSeen += collectible.length;

    if (collectible.length > 0) {
      const seenAt = new Date();
      await upsertPage(prisma, query.id, collectible, seenAt);
    }

    const oldestCreatedAt = collectible.reduce<Date | null>((oldest, item) => {
      const created = parseCreationDate(item);
      if (created === null) {
        return oldest;
      }
      return oldest === null || created < oldest ? created : oldest;
    }, null);
    const reachedCursor =
      options.stopAtCreatedAt != null && oldestCreatedAt != null && oldestCreatedAt <= options.stopAtCreatedAt;

    if (!result.hasMore || result.items.length === 0 || reachedCursor) {
      outcome.completed = true;
      return outcome;
    }

    offset += limit;
  }

  // Page/window cap hit; sweep is partial but not an error.
  return outcome;
}

async function runJob(deps: EbayScannerDeps, job: EbayJob): Promise<void> {
  const { config, logger, prisma } = deps;
  const startedAtMs = Date.now();
  const { query } = job;

  if (job.kind === "new_sweep") {
    const cursor = query.newCursorCreatedAt;
    const outcome = await runPagedSweep(deps, query, {
      // Delta sweeps are bounded: without a cursor (first run) take one page.
      maxPages: cursor == null ? 1 : 30,
      stopAtCreatedAt: cursor,
    });

    const newestListing = await prisma.ebayListing.aggregate({
      where: { queryId: query.id },
      _max: { ebayCreatedAt: true },
    });

    await prisma.ebayQuery.update({
      where: { id: query.id },
      data: {
        lastNewSweepAt: new Date(),
        newCursorCreatedAt: newestListing._max.ebayCreatedAt ?? cursor,
      },
    });
    logJob(logger, job, outcome, startedAtMs);
    return;
  }

  // snapshot
  const sweepStartedAt = new Date();
  const outcome = await runPagedSweep(deps, query, {
    maxPages: config.EBAY_SCAN_MAX_PAGES_PER_JOB,
  });

  if (outcome.completed) {
    // Anything we believed was live but the full sweep no longer returned has
    // ended on eBay (sold, expired, or delisted — Browse API can't tell which).
    const gone = await prisma.ebayListing.updateMany({
      where: {
        queryId: query.id,
        status: "on_sale",
        lastSeenAt: { lt: sweepStartedAt },
      },
      data: { status: "gone" },
    });
    if (gone.count > 0) {
      logger.info({ queryId: query.id, goneCount: gone.count }, "Marked vanished eBay listings as gone");
    }
  }

  await prisma.ebayQuery.update({
    where: { id: query.id },
    data: { lastSnapshotAt: new Date() },
  });
  logJob(logger, job, outcome, startedAtMs);
}

function logJob(logger: Logger, job: EbayJob, outcome: PageOutcome, startedAtMs: number): void {
  logger.info(
    {
      job: job.kind,
      queryId: job.query.id,
      label: job.query.label,
      pages: outcome.pagesFetched,
      items: outcome.itemsSeen,
      completed: outcome.completed,
      durationMs: Date.now() - startedAtMs,
    },
    "eBay scan job finished",
  );
}

export async function runDueEbayScans(deps: EbayScannerDeps): Promise<void> {
  const { config, logger, prisma } = deps;
  const nowEpochSec = Math.floor(Date.now() / 1000);
  const jobs = await collectDueEbayJobs(prisma, nowEpochSec);

  for (const job of jobs) {
    const backoffUntil = jobBackoffUntil.get(jobKey(job)) ?? 0;
    if (nowEpochSec < backoffUntil) {
      continue;
    }

    try {
      await runJob(deps, job);
      jobBackoffUntil.delete(jobKey(job));
    } catch (error) {
      jobBackoffUntil.set(jobKey(job), nowEpochSec + config.EBAY_SCAN_FAILURE_BACKOFF_SEC);
      const statusCode = ebayStatusCode(error);
      logger.error(
        {
          job: job.kind,
          queryId: job.query.id,
          statusCode,
          backoffSec: config.EBAY_SCAN_FAILURE_BACKOFF_SEC,
          error: redactUnknown(error),
        },
        "eBay scan job failed",
      );
      if (statusCode === 429) {
        // Scheduler cooldown is already active; stop starting new jobs this cycle.
        return;
      }
    }
  }
}

/**
 * Builds the eBay client/scheduler from config and starts the scan loop.
 * No-ops (with a log line) when disabled or when credentials are missing, so
 * the app runs fine without an eBay developer account.
 */
export function maybeStartEbayScanner(
  deps: Omit<EbayScannerDeps, "ebayClient" | "ebayRequests">,
): { stop: () => void } {
  const { config, logger, metrics } = deps;

  if (!config.EBAY_SCAN_ENABLED) {
    logger.info("eBay scanner disabled (EBAY_SCAN_ENABLED=false)");
    return { stop() {} };
  }
  if (!config.EBAY_CLIENT_ID || !config.EBAY_CLIENT_SECRET) {
    logger.warn("eBay scanner disabled: EBAY_CLIENT_ID / EBAY_CLIENT_SECRET not set");
    return { stop() {} };
  }

  const ebayClient = new EbayClient({
    clientId: config.EBAY_CLIENT_ID,
    clientSecret: config.EBAY_CLIENT_SECRET,
    marketplaceId: config.EBAY_MARKETPLACE_ID,
    environment: config.EBAY_ENVIRONMENT,
    timeoutMs: config.SCRAPE_HTTP_TIMEOUT_MS,
  });
  const ebayRequests = new EbayRequestScheduler({ config, logger, metrics });

  return startEbayScanner({ ...deps, ebayClient, ebayRequests });
}

export function startEbayScanner(deps: EbayScannerDeps): { stop: () => void } {
  const { config, logger } = deps;
  let stopped = false;

  logger.info({ tickSeconds: config.EBAY_SCAN_TICK_SECONDS }, "eBay scanner started");

  let running = false;
  async function loop(): Promise<void> {
    while (!stopped) {
      if (!running) {
        running = true;
        try {
          await runDueEbayScans(deps);
        } catch (error) {
          logger.error({ error: redactUnknown(error) }, "eBay scan cycle failed");
        } finally {
          running = false;
        }
      }
      if (!stopped) {
        await new Promise((resolve) => setTimeout(resolve, config.EBAY_SCAN_TICK_SECONDS * 1000));
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
