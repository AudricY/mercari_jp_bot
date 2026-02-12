import "dotenv/config";

import {
  QUEUE_NAMES,
  buildLogger,
  createQueue,
  loadConfig,
  parseDailySummaryTime,
  utcDateString,
  type ScanKeywordJob,
  type SendDailySummaryJob,
} from "@mercari-bot/core";
import { createPrismaClient, getEnabledKeywords } from "@mercari-bot/db";

const config = loadConfig();
const logger = buildLogger(config.LOG_LEVEL);
const prisma = createPrismaClient();

const scanQueue = createQueue("scan-keyword", config.REDIS_URL);
const summaryQueue = createQueue("send-daily-summary", config.REDIS_URL);

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

async function getRuntimeSummarySettings(): Promise<{ dailySummaryTime: string; displayTimezone: string }> {
  const configs = await prisma.systemConfig.findMany({
    where: {
      key: {
        in: ["daily_summary_time", "display_timezone"],
      },
    },
  });

  const map = new Map(configs.map((row) => [row.key, row.value]));

  const dailySummaryTime =
    typeof map.get("daily_summary_time") === "string" ? String(map.get("daily_summary_time")) : config.DAILY_SUMMARY_TIME;
  const displayTimezone =
    typeof map.get("display_timezone") === "string" ? String(map.get("display_timezone")) : config.DISPLAY_TIMEZONE;

  return { dailySummaryTime, displayTimezone };
}

async function enqueueKeywordScans(nowEpochSec: number): Promise<void> {
  const keywords = await getEnabledKeywords(prisma);

  for (const keyword of keywords) {
    const last = lastKeywordSchedule.get(keyword.id) ?? 0;
    if (nowEpochSec - last < keyword.intervalSec) {
      continue;
    }

    const payload: ScanKeywordJob = {
      keywordId: keyword.id,
      triggeredBy: "scheduler",
    };

    const jitter = Math.floor(Math.random() * Math.min(keyword.intervalSec, 10));
    const slot = Math.floor((nowEpochSec + jitter) / Math.max(keyword.intervalSec, 1));
    const jobId = `${keyword.id}:${slot}`;

    await scanQueue.add(QUEUE_NAMES.scan, payload, {
      jobId,
      removeOnComplete: true,
      removeOnFail: 1000,
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 1000,
      },
    });

    lastKeywordSchedule.set(keyword.id, nowEpochSec);
  }
}

async function maybeEnqueueDailySummary(nowEpochSec: number): Promise<void> {
  const { dailySummaryTime, displayTimezone } = await getRuntimeSummarySettings();
  const { hour, minute } = parseDailySummaryTime(dailySummaryTime);
  const tzNow = nowInTimezone(displayTimezone);

  if (tzNow.hour !== hour || tzNow.minute !== minute) {
    return;
  }

  if (lastSummaryRunDate === tzNow.date) {
    return;
  }

  const payload: SendDailySummaryJob = {
    dateUtc: utcDateString(new Date(nowEpochSec * 1000)),
    timezone: displayTimezone,
    channel: "telegram",
  };

  await summaryQueue.add(QUEUE_NAMES.summary, payload, {
    jobId: `summary:${tzNow.date}`,
    removeOnComplete: true,
    removeOnFail: 100,
    attempts: 3,
  });

  lastSummaryRunDate = tzNow.date;
}

async function tick(): Promise<void> {
  const nowEpochSec = Math.floor(Date.now() / 1000);

  try {
    await enqueueKeywordScans(nowEpochSec);
    await maybeEnqueueDailySummary(nowEpochSec);
  } catch (error) {
    logger.error({ error }, "Scheduler tick failed");
  }
}

async function main(): Promise<void> {
  logger.info(
    {
      tickSeconds: config.SCHEDULER_TICK_SECONDS,
    },
    "Scheduler started",
  );

  await tick();

  setInterval(() => {
    void tick();
  }, config.SCHEDULER_TICK_SECONDS * 1000);
}

const shutdown = async (): Promise<void> => {
  await Promise.all([scanQueue.close(), summaryQueue.close()]);
  await prisma.$disconnect();
};

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    logger.info({ signal }, "Shutting down scheduler");
    void shutdown().finally(() => process.exit(0));
  });
}

void main();
