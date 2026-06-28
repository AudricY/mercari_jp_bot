import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { PrismaClient } from "@prisma/client";
import { buildLogger, buildMetrics, loadConfig, type AppConfig } from "@mercari-bot/core";

import { createApi } from "../src/api.js";

const execFileAsync = promisify(execFile);
const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));

function buildTestConfig(databaseUrl: string, overrides: Partial<AppConfig> = {}): AppConfig {
  const config = loadConfig({
    NODE_ENV: "test",
    LOG_LEVEL: "silent",
    PORT: "3000",
    ADMIN_TOKEN: "test-token-123",
    ADMIN_ALLOWED_IPS: "127.0.0.1,::1",
    DATABASE_URL: databaseUrl,
    REDIS_URL: "",
    TELEGRAM_BOT_TOKEN: "telegram-token",
    TELEGRAM_CHAT_ID: "chat-id",
    TELEGRAM_MIN_DELAY_MS: "1",
    TELEGRAM_MAX_RETRIES: "1",
    TELEGRAM_BACKOFF_FACTOR: "2",
    SENTRY_DSN: "",
    SCRAPE_CONCURRENCY: "1",
    SCRAPE_HTTP_TIMEOUT_MS: "1000",
    SCRAPE_MAX_ITEMS_PER_TERM: "10",
    SCRAPE_SEARCH_MIN_DELAY_MS: "0",
    SCRAPE_DETAIL_ENABLED: "false",
    SCRAPE_DETAIL_DELAY_MS: "0",
    SCRAPE_DETAIL_MIN_DELAY_MS: "0",
    SCRAPE_RATE_LIMIT_COOLDOWN_MS: "0",
    SCHEDULER_TICK_SECONDS: "30",
    DISPLAY_TIMEZONE: "UTC",
    DAILY_SUMMARY_TIME: "12:30",
    TELEGRAM_SUMMARY_TOPIC_NAME: "",
  });

  return { ...config, ...overrides };
}

export async function createTestContext(configOverrides: Partial<AppConfig> = {}) {
  const tempDir = await mkdtemp(join(tmpdir(), "mercari-unified-test-"));
  const dbPath = join(tempDir, "test.db");
  const databaseUrl = `file:${dbPath}`;

  await execFileAsync("bash", ["-lc", `for file in $(find prisma/migrations -mindepth 2 -name migration.sql | sort); do sqlite3 "${dbPath}" < "$file" || exit 1; done`], {
    cwd: repoRoot,
    maxBuffer: 10 * 1024 * 1024,
  });

  const prisma = new PrismaClient({
    datasources: {
      db: { url: databaseUrl },
    },
  });
  await prisma.$connect();

  const config = buildTestConfig(databaseUrl, configOverrides);
  const logger = buildLogger("silent");
  const metrics = buildMetrics(`mercari_bot_test_${Date.now()}_`);
  const app = createApi({ config, logger, metrics, prisma });
  await app.ready();

  return {
    tempDir,
    dbPath,
    databaseUrl,
    prisma,
    config,
    logger,
    metrics,
    app,
    authHeaders(ip = "127.0.0.1") {
      return {
        authorization: `Bearer ${config.ADMIN_TOKEN}`,
        "x-forwarded-for": ip,
      };
    },
    async cleanup() {
      await app.close();
      await prisma.$disconnect();
      await rm(tempDir, { recursive: true, force: true });
    },
  };
}

export function isoDate(value: string): Date {
  return new Date(value);
}

export function uniqueId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}
