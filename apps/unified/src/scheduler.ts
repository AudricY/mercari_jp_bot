import type { PrismaClient } from "@prisma/client";
import type { Logger } from "pino";

import {
  parseDailySummaryTime,
  redactUnknown,
  utcDateString,
  type AppConfig,
  type Metrics,
} from "@mercari-bot/core";
import { getEnabledKeywords } from "@mercari-bot/db";

import { scanKeyword } from "./scanner.js";
import { sendDailySummary } from "./notifier.js";

export interface SchedulerDeps {
  config: AppConfig;
  logger: Logger;
  metrics: Metrics;
  prisma: PrismaClient;
}

const lastKeywordSchedule = new Map<string, number>();
let lastSummaryRunDate = "";

function nowInTimezone(timezone: string): { hour: number; minute: number; date: string } {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(new Date());
  const values: Record<string, string> = {};
  for (const part of parts) {
    values[part.type] = part.value;
  }

  return {
    hour: Number.parseInt(values.hour ?? "0", 10),
    minute: Number.parseInt(values.minute ?? "0", 10),
    date: `${values.year}-${values.month}-${values.day}`,
  };
}

async function runKeywordScans(nowEpochSec: number, deps: SchedulerDeps): Promise<void> {
  const { config, logger, prisma } = deps;
  const keywords = await getEnabledKeywords(prisma);

  const due = keywords.filter((keyword) => {
    const last = lastKeywordSchedule.get(keyword.id) ?? 0;
    const jitter = Math.floor(Math.random() * 11) - 5; // ±5s
    return nowEpochSec - last >= keyword.intervalSec + jitter;
  });

  // Process in chunks capped by SCRAPE_CONCURRENCY
  for (let i = 0; i < due.length; i += config.SCRAPE_CONCURRENCY) {
    const chunk = due.slice(i, i + config.SCRAPE_CONCURRENCY);
    await Promise.allSettled(
      chunk.map(async (keyword) => {
        lastKeywordSchedule.set(keyword.id, nowEpochSec);
        try {
          await scanKeyword(keyword.id, "scheduler", deps);
        } catch (error) {
          logger.error(
            { keywordId: keyword.id, error: redactUnknown(error) },
            "Scheduled scan failed",
          );
        }
      }),
    );
  }
}

async function maybeRunDailySummary(nowEpochSec: number, deps: SchedulerDeps): Promise<void> {
  const { config, logger } = deps;
  const { hour, minute } = parseDailySummaryTime(config.DAILY_SUMMARY_TIME);
  const tzNow = nowInTimezone(config.DISPLAY_TIMEZONE);

  if (tzNow.hour !== hour || tzNow.minute !== minute) {
    return;
  }

  if (lastSummaryRunDate === tzNow.date) {
    return;
  }

  lastSummaryRunDate = tzNow.date;

  try {
    await sendDailySummary(
      {
        dateUtc: utcDateString(new Date(nowEpochSec * 1000)),
        timezone: config.DISPLAY_TIMEZONE,
        channel: "telegram",
      },
      deps,
    );
  } catch (error) {
    logger.error({ error: redactUnknown(error) }, "Daily summary failed");
  }
}

let tickRunning = false;

async function tick(deps: SchedulerDeps): Promise<void> {
  if (tickRunning) {
    deps.logger.warn("Scheduler tick skipped — previous tick still running");
    return;
  }
  tickRunning = true;
  try {
    const nowEpochSec = Math.floor(Date.now() / 1000);
    await runKeywordScans(nowEpochSec, deps);
    await maybeRunDailySummary(nowEpochSec, deps);
  } catch (error) {
    deps.logger.error({ error: redactUnknown(error) }, "Scheduler tick failed");
  } finally {
    tickRunning = false;
  }
}

export function startScheduler(deps: SchedulerDeps): { stop: () => void } {
  const { config, logger } = deps;
  let stopped = false;

  logger.info(
    { tickSeconds: config.SCHEDULER_TICK_SECONDS },
    "Scheduler started",
  );

  async function loop(): Promise<void> {
    while (!stopped) {
      await tick(deps);
      if (!stopped) {
        await new Promise((resolve) => setTimeout(resolve, config.SCHEDULER_TICK_SECONDS * 1000));
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
