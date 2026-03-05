import type { PrismaClient } from "@prisma/client";
import type { Logger } from "pino";

import type { AppConfig } from "./config.js";


interface EnsureResult {
  threadId: number | null;
  dbId: string | null;
  created: boolean;
}

export async function ensureTelegramTopic(
  topicName: string,
  config: AppConfig,
  prisma: PrismaClient,
  logger: Logger,
): Promise<EnsureResult> {
  const chatId = config.TELEGRAM_CHAT_ID;

  // Check DB first
  const existing = await prisma.telegramTopic.findUnique({
    where: { chatId_topicName: { chatId, topicName } },
  });

  if (existing) {
    return { threadId: existing.threadId, dbId: existing.id, created: false };
  }

  // Create via Telegram API
  const endpoint = `https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/createForumTopic`;

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        name: topicName,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      logger.warn({ topicName, status: response.status, body }, "Failed to create forum topic");
      return { threadId: null, dbId: null, created: false };
    }

    const data = (await response.json()) as {
      result: { message_thread_id: number };
    };
    const threadId = data.result.message_thread_id;

    // Persist to DB
    try {
      const record = await prisma.telegramTopic.create({
        data: { chatId, topicName, threadId },
      });
      logger.info({ topicName, threadId }, "Created forum topic");
      return { threadId, dbId: record.id, created: true };
    } catch (error: unknown) {
      // Race condition: another process created it
      const isUniqueViolation =
        error instanceof Error && error.message.includes("Unique constraint");
      if (isUniqueViolation) {
        const retry = await prisma.telegramTopic.findUnique({
          where: { chatId_topicName: { chatId, topicName } },
        });
        if (retry) {
          return { threadId: retry.threadId, dbId: retry.id, created: false };
        }
      }
      throw error;
    }
  } catch (error) {
    if (error instanceof TypeError || (error instanceof Error && error.message.includes("fetch"))) {
      logger.warn({ topicName, error: String(error) }, "Network error creating forum topic");
      return { threadId: null, dbId: null, created: false };
    }
    throw error;
  }
}

export async function lookupTopicThreadId(
  topicName: string | null,
  chatId: string,
  prisma: PrismaClient,
): Promise<number | null> {
  if (!topicName) return null;

  const record = await prisma.telegramTopic.findUnique({
    where: { chatId_topicName: { chatId, topicName } },
  });

  return record?.threadId ?? null;
}
