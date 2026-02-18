import "dotenv/config";

import {
  QUEUE_NAMES,
  buildLogger,
  buildMetrics,
  createQueue,
  createWorker,
  loadConfig,
  redactSensitiveText,
  redactUnknown,
  type NotifyItemJob,
  type RetryFailedNotificationJob,
  type SendDailySummaryJob,
} from "@mercari-bot/core";
import { createPrismaClient, initPrisma } from "@mercari-bot/db";

const config = loadConfig();
const logger = buildLogger(config.LOG_LEVEL);
const metrics = buildMetrics();
const prisma = createPrismaClient();
void initPrisma(prisma);

const notifyQueue = createQueue("notify-item", config.REDIS_URL);

let lastTelegramRequestAt = 0;

class TelegramError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly transient: boolean,
  ) {
    super(message);
  }
}

async function waitForRateLimit(): Promise<void> {
  const elapsed = Date.now() - lastTelegramRequestAt;
  const waitMs = config.TELEGRAM_MIN_DELAY_MS - elapsed;
  if (waitMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
}

async function telegramPost(method: "sendMessage" | "sendPhoto", payload: Record<string, string>): Promise<any> {
  const endpoint = `https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/${method}`;

  for (let attempt = 0; attempt <= config.TELEGRAM_MAX_RETRIES; attempt += 1) {
    await waitForRateLimit();

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(payload).toString(),
    });

    lastTelegramRequestAt = Date.now();

    if (response.ok) {
      return response.json();
    }

    const body = await response.text();
    const sanitizedBody = redactSensitiveText(body);

    const isTransient = response.status === 429 || response.status >= 500;
    const baseMessage = `Telegram ${method} failed (${response.status}): ${sanitizedBody}`;

    if (isTransient && attempt < config.TELEGRAM_MAX_RETRIES) {
      const retryAfterHeader = response.headers.get("retry-after");
      const retryAfterSec = retryAfterHeader ? Number.parseInt(retryAfterHeader, 10) : 0;
      const backoffMs = Math.max(
        retryAfterSec * 1000,
        config.TELEGRAM_MIN_DELAY_MS * Math.pow(config.TELEGRAM_BACKOFF_FACTOR, attempt),
      );

      await new Promise((resolve) => setTimeout(resolve, backoffMs));
      continue;
    }

    throw new TelegramError(baseMessage, response.status, isTransient);
  }

  throw new TelegramError("Telegram request exhausted retries", 500, true);
}

function truncateCaption(value: string, max = 1000): string {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max - 1)}…`;
}

async function sendListingNotification(notificationId: string): Promise<void> {
  const notification = await prisma.notification.findUnique({
    where: { id: notificationId },
    include: {
      listing: true,
      keyword: true,
    },
  });

  if (!notification) {
    logger.warn({ notificationId }, "Notification record missing");
    return;
  }

  await prisma.notification.update({
    where: { id: notification.id },
    data: {
      attemptCount: {
        increment: 1,
      },
    },
  });

  const caption = truncateCaption(
    `<b>${notification.listing.title}</b>\nPrice: ${notification.listing.rawPriceDisplay}\nTime: ${notification.listing.scrapedAt.toISOString()}\n${notification.listing.url}`,
  );

  try {
    let telegramResponse: any;
    try {
      telegramResponse = await telegramPost("sendPhoto", {
        chat_id: config.TELEGRAM_CHAT_ID,
        photo: notification.listing.imageUrl,
        caption,
        parse_mode: "HTML",
      });
    } catch (error) {
      const canFallback = error instanceof TelegramError && error.status >= 400 && error.status < 500 && error.status !== 429;
      if (!canFallback) {
        throw error;
      }

      telegramResponse = await telegramPost("sendMessage", {
        chat_id: config.TELEGRAM_CHAT_ID,
        text: `${notification.listing.title}\n${notification.listing.rawPriceDisplay}\n${notification.listing.url}`,
      });
    }

    await prisma.$transaction([
      prisma.notification.update({
        where: { id: notification.id },
        data: {
          status: "sent",
          providerMessageId:
            telegramResponse && typeof telegramResponse === "object" && typeof telegramResponse.result?.message_id !== "undefined"
              ? String(telegramResponse.result.message_id)
              : null,
          sentAt: new Date(),
          lastError: null,
        },
      }),
      prisma.dailyKeywordCount.upsert({
        where: {
          dateUtc_keywordId: {
            dateUtc: new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`),
            keywordId: notification.keywordId,
          },
        },
        create: {
          dateUtc: new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`),
          keywordId: notification.keywordId,
          sentCount: 1,
        },
        update: {
          sentCount: {
            increment: 1,
          },
        },
      }),
    ]);

    metrics.notificationSendTotal.labels("telegram", "sent").inc();
  } catch (error) {
    const err = error instanceof TelegramError ? error : new TelegramError("Unknown telegram error", 500, true);
    const finalStatus = err.transient ? "failed" : "suppressed";

    await prisma.notification.update({
      where: { id: notification.id },
      data: {
        status: finalStatus,
        lastError: err.message.slice(0, 500),
      },
    });

    metrics.notificationSendTotal.labels("telegram", finalStatus).inc();

    if (err.transient) {
      throw err;
    }

    logger.warn(
      {
        notificationId,
        status: err.status,
        message: redactSensitiveText(err.message),
      },
      "Permanent telegram failure suppressed",
    );
  }
}

async function sendDailySummary(payload: SendDailySummaryJob): Promise<void> {
  const date = new Date(`${payload.dateUtc}T00:00:00.000Z`);
  const stats = await prisma.dailyKeywordCount.findMany({
    where: { dateUtc: date },
    include: { keyword: true },
    orderBy: { keyword: { name: "asc" } },
  });

  const lines = [`Mercari Summary - ${payload.dateUtc} (${payload.timezone})`, ""];

  if (stats.length === 0) {
    lines.push("No activity recorded.");
  } else {
    for (const row of stats) {
      lines.push(`- ${row.keyword.name}: ${row.sentCount} sent`);
    }
  }

  await telegramPost("sendMessage", {
    chat_id: config.TELEGRAM_CHAT_ID,
    text: lines.join("\n"),
  });
}

const notifyWorker = createWorker(
  "notify-item",
  config.REDIS_URL,
  async (job) => {
    const payload = job.data as NotifyItemJob;
    const queueLatencySeconds = Math.max(0, (Date.now() - job.timestamp) / 1000);
    metrics.queueJobLatencySeconds.labels("notify-item").observe(queueLatencySeconds);
    await sendListingNotification(payload.itemId);
  },
  {
    concurrency: 1,
  },
);

const summaryWorker = createWorker(
  "send-daily-summary",
  config.REDIS_URL,
  async (job) => {
    const payload = job.data as SendDailySummaryJob;
    const queueLatencySeconds = Math.max(0, (Date.now() - job.timestamp) / 1000);
    metrics.queueJobLatencySeconds.labels("send-daily-summary").observe(queueLatencySeconds);
    await sendDailySummary(payload);
  },
  {
    concurrency: 1,
  },
);

const retryWorker = createWorker(
  "retry-failed-notification",
  config.REDIS_URL,
  async (job) => {
    const payload = job.data as RetryFailedNotificationJob;
    const queueLatencySeconds = Math.max(0, (Date.now() - job.timestamp) / 1000);
    metrics.queueJobLatencySeconds.labels("retry-failed-notification").observe(queueLatencySeconds);

    const notification = await prisma.notification.findUnique({ where: { id: payload.notificationId } });
    if (!notification) {
      return;
    }

    await notifyQueue.add(
      QUEUE_NAMES.notify,
      {
        itemId: payload.notificationId,
        keywordId: notification.keywordId,
        channel: "telegram",
      },
      {
        removeOnComplete: true,
        removeOnFail: 1000,
        attempts: 3,
      },
    );
  },
  {
    concurrency: 1,
  },
);

for (const worker of [notifyWorker, summaryWorker, retryWorker]) {
  worker.on("failed", (job, error) => {
    logger.error(
      {
        queue: worker.name,
        jobId: job?.id,
        error: redactUnknown(error),
      },
      "Notification worker job failed",
    );
  });
}

metrics.activeWorkers.labels("notify").set(1);

async function shutdown(): Promise<void> {
  metrics.activeWorkers.labels("notify").set(0);
  await Promise.all([notifyWorker.close(), summaryWorker.close(), retryWorker.close(), notifyQueue.close()]);
  await prisma.$disconnect();
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    logger.info({ signal }, "Shutting down notify worker");
    void shutdown().finally(() => process.exit(0));
  });
}

logger.info(
  {
    queues: [QUEUE_NAMES.notify, QUEUE_NAMES.summary, QUEUE_NAMES.retryNotification],
  },
  "Notify worker started",
);
