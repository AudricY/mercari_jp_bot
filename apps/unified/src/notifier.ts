import type { PrismaClient } from "@prisma/client";
import type { Logger } from "pino";

import {
  lookupTopicThreadId,
  redactSensitiveText,
  type AppConfig,
  type Metrics,
  type SendDailySummaryJob,
} from "@mercari-bot/core";

export interface NotifierDeps {
  config: AppConfig;
  logger: Logger;
  metrics: Metrics;
  prisma: PrismaClient;
}

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

async function waitForRateLimit(config: AppConfig): Promise<void> {
  const elapsed = Date.now() - lastTelegramRequestAt;
  const waitMs = config.TELEGRAM_MIN_DELAY_MS - elapsed;
  if (waitMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
}

async function telegramPost(
  config: AppConfig,
  method: "sendMessage" | "sendPhoto",
  payload: Record<string, string | number>,
): Promise<any> {
  const endpoint = `https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/${method}`;
  const stringPayload: Record<string, string> = {};
  for (const [k, v] of Object.entries(payload)) {
    stringPayload[k] = String(v);
  }

  for (let attempt = 0; attempt <= config.TELEGRAM_MAX_RETRIES; attempt += 1) {
    await waitForRateLimit(config);

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(stringPayload).toString(),
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

async function sendListingNotification(notificationId: string, deps: NotifierDeps): Promise<void> {
  const { config, logger, metrics, prisma } = deps;

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

  // Resolve topic thread_id for this keyword
  const threadId = await lookupTopicThreadId(
    notification.keyword?.topicName ?? null,
    config.TELEGRAM_CHAT_ID,
    prisma,
  );

  try {
    let telegramResponse: any;
    const basePhotoPayload: Record<string, string | number> = {
      chat_id: config.TELEGRAM_CHAT_ID,
      photo: notification.listing.imageUrl,
      caption,
      parse_mode: "HTML",
    };
    const baseTextPayload: Record<string, string | number> = {
      chat_id: config.TELEGRAM_CHAT_ID,
      text: `${notification.listing.title}\n${notification.listing.rawPriceDisplay}\n${notification.listing.url}`,
    };

    if (threadId) {
      basePhotoPayload.message_thread_id = threadId;
      baseTextPayload.message_thread_id = threadId;
    }

    try {
      telegramResponse = await telegramPost(config, "sendPhoto", basePhotoPayload);
    } catch (error) {
      const canFallback = error instanceof TelegramError && error.status >= 400 && error.status < 500 && error.status !== 429;
      if (!canFallback) {
        throw error;
      }

      try {
        telegramResponse = await telegramPost(config, "sendMessage", baseTextPayload);
      } catch (fallbackError) {
        // If thread_id caused the error, retry without it (send to General)
        if (threadId && fallbackError instanceof TelegramError && fallbackError.status === 400) {
          const { message_thread_id: _, ...noThreadPayload } = baseTextPayload;
          telegramResponse = await telegramPost(config, "sendMessage", noThreadPayload);
        } else {
          throw fallbackError;
        }
      }
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

export async function sendDailySummary(payload: SendDailySummaryJob, deps: NotifierDeps): Promise<void> {
  const { config, prisma } = deps;

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

  const summaryPayload: Record<string, string | number> = {
    chat_id: config.TELEGRAM_CHAT_ID,
    text: lines.join("\n"),
  };

  if (config.TELEGRAM_SUMMARY_TOPIC_NAME) {
    const summaryThreadId = await lookupTopicThreadId(
      config.TELEGRAM_SUMMARY_TOPIC_NAME,
      config.TELEGRAM_CHAT_ID,
      prisma,
    );
    if (summaryThreadId) {
      summaryPayload.message_thread_id = summaryThreadId;
    }
  }

  await telegramPost(config, "sendMessage", summaryPayload);
}

const POLL_INTERVAL_MS = 2000;
const RETRY_SWEEP_INTERVAL_MS = 60_000;
const RETRY_COOLDOWN_MS = 30_000;

export function startNotificationProcessor(deps: NotifierDeps): { stop: () => void } {
  const { config, logger, prisma } = deps;
  let running = true;
  let lastRetrySweep = 0;

  const loop = async () => {
    while (running) {
      try {
        // Retry sweep: reset eligible failed notifications
        if (Date.now() - lastRetrySweep >= RETRY_SWEEP_INTERVAL_MS) {
          const cutoff = new Date(Date.now() - RETRY_COOLDOWN_MS);
          await prisma.notification.updateMany({
            where: {
              status: "failed",
              attemptCount: { lt: config.TELEGRAM_MAX_RETRIES + 1 },
              updatedAt: { lt: cutoff },
            },
            data: { status: "pending" },
          });
          lastRetrySweep = Date.now();
        }

        // Poll for pending notifications
        const pending = await prisma.notification.findFirst({
          where: { status: "pending" },
          orderBy: { createdAt: "asc" },
        });

        if (!pending) {
          await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
          continue;
        }

        try {
          await sendListingNotification(pending.id, deps);
        } catch (error) {
          logger.error(
            { notificationId: pending.id, error: String(error) },
            "Notification send failed (will retry)",
          );
        }
      } catch (error) {
        logger.error({ error: String(error) }, "Notification processor loop error");
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      }
    }
  };

  void loop();

  return {
    stop() {
      running = false;
    },
  };
}
