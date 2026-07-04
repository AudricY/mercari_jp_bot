import type { MarketCategory, PrismaClient } from "@prisma/client";
import type { Logger } from "pino";

import {
  redactUnknown,
  searchMercari,
  type AppConfig,
  type MercariSearchItem,
  type MercariSearchStatus,
  type Metrics,
} from "@mercari-bot/core";

import { mercariStatusCode, type MercariRequestScheduler } from "./mercari-request-scheduler.js";

export interface MarketScannerDeps {
  config: AppConfig;
  logger: Logger;
  metrics: Metrics;
  prisma: PrismaClient;
  mercariRequests: MercariRequestScheduler;
}

type MarketJobKind = "new_sweep" | "sold_sweep" | "snapshot";

interface MarketJob {
  kind: MarketJobKind;
  category: MarketCategory;
}

interface PageOutcome {
  pagesFetched: number;
  itemsSeen: number;
  completed: boolean;
}

/** In-memory backoff after a failed job so a broken category cannot spin. */
const jobBackoffUntil = new Map<string, number>();

function jobKey(job: MarketJob): string {
  return `${job.kind}:${job.category.id}`;
}

function mapItemStatus(status: string | undefined): string {
  switch (status) {
    case "ITEM_STATUS_ON_SALE":
      return "on_sale";
    case "ITEM_STATUS_TRADING":
      return "trading";
    case "ITEM_STATUS_SOLD_OUT":
      return "sold_out";
    default:
      return status ? status.replace("ITEM_STATUS_", "").toLowerCase() : "unknown";
  }
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

export async function collectDueMarketJobs(
  prisma: PrismaClient,
  nowEpochSec: number,
): Promise<MarketJob[]> {
  const categories = await prisma.marketCategory.findMany({ where: { enabled: true } });
  const jobs: MarketJob[] = [];

  // Cheap, freshness-sensitive sweeps first; heavy snapshots last so a due
  // snapshot cannot starve delta sweeps for the whole cycle.
  for (const category of categories) {
    if (isDue(category.lastNewSweepAt, category.newSweepIntervalSec, nowEpochSec)) {
      jobs.push({ kind: "new_sweep", category });
    }
  }
  for (const category of categories) {
    if (isDue(category.lastSoldSweepAt, category.soldSweepIntervalSec, nowEpochSec)) {
      jobs.push({ kind: "sold_sweep", category });
    }
  }
  for (const category of categories) {
    if (isDue(category.lastSnapshotAt, category.snapshotIntervalSec, nowEpochSec)) {
      jobs.push({ kind: "snapshot", category });
    }
  }

  return jobs;
}

async function upsertPage(
  prisma: PrismaClient,
  categoryId: number,
  items: MercariSearchItem[],
  seenAt: Date,
): Promise<void> {
  await prisma.$transaction(
    items.map((item) =>
      prisma.marketListing.upsert({
        where: { mercariId: item.id },
        create: {
          mercariId: item.id,
          categoryId,
          title: item.name,
          price: Number(item.price),
          status: mapItemStatus(item.status),
          conditionId: item.itemConditionId ? Number(item.itemConditionId) : null,
          sellerId: item.sellerId ?? null,
          shippingPayerId: item.shippingPayerId ? Number(item.shippingPayerId) : null,
          thumbnailUrl: item.thumbnails?.[0] ?? null,
          mercariCreatedSec: Number(item.created ?? 0),
          mercariUpdatedSec: Number(item.updated ?? 0),
          firstSeenAt: seenAt,
          lastSeenAt: seenAt,
        },
        update: {
          title: item.name,
          price: Number(item.price),
          status: mapItemStatus(item.status),
          conditionId: item.itemConditionId ? Number(item.itemConditionId) : null,
          mercariUpdatedSec: Number(item.updated ?? 0),
          lastSeenAt: seenAt,
        },
      }),
    ),
  );
}

/** Stamp sold price/time once, the first sweep that observes an item sold. */
async function markNewlySold(prisma: PrismaClient, mercariIds: string[], observedAt: Date): Promise<void> {
  if (mercariIds.length === 0) {
    return;
  }
  const placeholders = mercariIds.map(() => "?").join(",");
  // Prisma stores SQLite DateTime columns as epoch milliseconds.
  await prisma.$executeRawUnsafe(
    `UPDATE market_listings
     SET sold_price = price, sold_observed_at = ?
     WHERE mercari_id IN (${placeholders})
       AND status = 'sold_out'
       AND sold_observed_at IS NULL`,
    observedAt.getTime(),
    ...mercariIds,
  );
}

async function runPagedSweep(
  deps: MarketScannerDeps,
  category: MarketCategory,
  options: {
    status: MercariSearchStatus[];
    maxPages: number;
    markSold: boolean;
    /** Stop when a page's oldest created-time is at or below this cursor. */
    stopAtCreatedSec?: number | null;
  },
): Promise<PageOutcome> {
  const { config, prisma, mercariRequests } = deps;
  const outcome: PageOutcome = { pagesFetched: 0, itemsSeen: 0, completed: false };
  let pageToken = "";

  while (outcome.pagesFetched < options.maxPages) {
    const result = await mercariRequests.request("search", () =>
      searchMercari({
        categoryId: [category.id],
        status: options.status,
        sort: "SORT_CREATED_TIME",
        order: "ORDER_DESC",
        pageSize: config.MARKET_SCAN_PAGE_SIZE,
        pageToken,
        timeoutMs: config.SCRAPE_HTTP_TIMEOUT_MS,
      }),
    );

    outcome.pagesFetched += 1;

    // Past the true result set Mercari pads pages with "similar item"
    // recommendations from other leaves; keep only items whose own reported
    // categoryId matches the leaf we asked for.
    const matching = result.items.filter(
      (item) => item.categoryId === undefined || Number(item.categoryId) === category.id,
    );
    outcome.itemsSeen += matching.length;

    if (matching.length > 0) {
      const seenAt = new Date();
      await upsertPage(prisma, category.id, matching, seenAt);
      if (options.markSold) {
        await markNewlySold(
          prisma,
          matching.map((item) => item.id),
          seenAt,
        );
      }
    }

    const oldestCreatedSec = matching.reduce(
      (oldest, item) => Math.min(oldest, Number(item.created ?? Number.MAX_SAFE_INTEGER)),
      Number.MAX_SAFE_INTEGER,
    );
    const reachedCursor =
      options.stopAtCreatedSec != null &&
      matching.length > 0 &&
      oldestCreatedSec <= options.stopAtCreatedSec;
    const paddingOnly = result.items.length > 0 && matching.length === 0;

    if (!result.nextPageToken || result.items.length === 0 || paddingOnly || reachedCursor) {
      outcome.completed = true;
      return outcome;
    }

    pageToken = result.nextPageToken;
  }

  // Page cap hit; sweep is partial but not an error.
  return outcome;
}

async function runJob(deps: MarketScannerDeps, job: MarketJob): Promise<void> {
  const { config, logger, prisma } = deps;
  const startedAtMs = Date.now();
  const { category } = job;

  if (job.kind === "new_sweep") {
    const cursor = category.newCursorCreatedSec;
    const outcome = await runPagedSweep(deps, category, {
      status: ["STATUS_ON_SALE"],
      // Delta sweeps are bounded: without a cursor (first run) take one page.
      maxPages: cursor == null ? 1 : 30,
      markSold: false,
      stopAtCreatedSec: cursor,
    });

    const newestListing = await prisma.marketListing.aggregate({
      where: { categoryId: category.id },
      _max: { mercariCreatedSec: true },
    });

    await prisma.marketCategory.update({
      where: { id: category.id },
      data: {
        lastNewSweepAt: new Date(),
        newCursorCreatedSec: newestListing._max.mercariCreatedSec ?? cursor,
      },
    });
    logJob(logger, job, outcome, startedAtMs);
    return;
  }

  if (job.kind === "sold_sweep") {
    const outcome = await runPagedSweep(deps, category, {
      status: ["STATUS_SOLD_OUT", "STATUS_TRADING"],
      maxPages: config.MARKET_SCAN_MAX_PAGES_PER_JOB,
      markSold: true,
    });
    await prisma.marketCategory.update({
      where: { id: category.id },
      data: { lastSoldSweepAt: new Date() },
    });
    logJob(logger, job, outcome, startedAtMs);
    return;
  }

  // snapshot
  const sweepStartedAt = new Date();
  const outcome = await runPagedSweep(deps, category, {
    status: ["STATUS_ON_SALE"],
    maxPages: config.MARKET_SCAN_MAX_PAGES_PER_JOB,
    markSold: false,
  });

  if (outcome.completed) {
    // Anything we believed was on sale but the full sweep no longer returned
    // has left the market (sold and not yet swept, or deleted).
    const gone = await prisma.marketListing.updateMany({
      where: {
        categoryId: category.id,
        status: "on_sale",
        lastSeenAt: { lt: sweepStartedAt },
      },
      data: { status: "gone" },
    });
    if (gone.count > 0) {
      deps.logger.info(
        { categoryId: category.id, goneCount: gone.count },
        "Marked vanished market listings as gone",
      );
    }
  }

  await prisma.marketCategory.update({
    where: { id: category.id },
    data: { lastSnapshotAt: new Date() },
  });
  logJob(logger, job, outcome, startedAtMs);
}

function logJob(logger: Logger, job: MarketJob, outcome: PageOutcome, startedAtMs: number): void {
  logger.info(
    {
      job: job.kind,
      categoryId: job.category.id,
      label: job.category.label,
      pages: outcome.pagesFetched,
      items: outcome.itemsSeen,
      completed: outcome.completed,
      durationMs: Date.now() - startedAtMs,
    },
    "Market scan job finished",
  );
}

export async function runDueMarketScans(deps: MarketScannerDeps): Promise<void> {
  const { config, logger, prisma } = deps;
  const nowEpochSec = Math.floor(Date.now() / 1000);
  const jobs = await collectDueMarketJobs(prisma, nowEpochSec);

  for (const job of jobs) {
    const backoffUntil = jobBackoffUntil.get(jobKey(job)) ?? 0;
    if (nowEpochSec < backoffUntil) {
      continue;
    }

    try {
      await runJob(deps, job);
      jobBackoffUntil.delete(jobKey(job));
    } catch (error) {
      jobBackoffUntil.set(jobKey(job), nowEpochSec + config.MARKET_SCAN_FAILURE_BACKOFF_SEC);
      const statusCode = mercariStatusCode(error);
      logger.error(
        {
          job: job.kind,
          categoryId: job.category.id,
          statusCode,
          backoffSec: config.MARKET_SCAN_FAILURE_BACKOFF_SEC,
          error: redactUnknown(error),
        },
        "Market scan job failed",
      );
      if (statusCode === 429) {
        // Scheduler cooldown is already active; stop starting new jobs this cycle.
        return;
      }
    }
  }
}

export function startMarketScanner(deps: MarketScannerDeps): { stop: () => void } {
  const { config, logger } = deps;
  let stopped = false;

  if (!config.MARKET_SCAN_ENABLED) {
    logger.info("Market scanner disabled (MARKET_SCAN_ENABLED=false)");
    return { stop() {} };
  }

  logger.info({ tickSeconds: config.MARKET_SCAN_TICK_SECONDS }, "Market scanner started");

  let running = false;
  async function loop(): Promise<void> {
    while (!stopped) {
      if (!running) {
        running = true;
        try {
          await runDueMarketScans(deps);
        } catch (error) {
          logger.error({ error: redactUnknown(error) }, "Market scan cycle failed");
        } finally {
          running = false;
        }
      }
      if (!stopped) {
        await new Promise((resolve) => setTimeout(resolve, config.MARKET_SCAN_TICK_SECONDS * 1000));
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
