import { afterEach, describe, expect, it, vi } from "vitest";

import { MercariApiError, buildLogger, buildMetrics, loadConfig } from "@mercari-bot/core";

import { MercariRequestScheduler } from "../src/mercari-request-scheduler.js";

describe("MercariRequestScheduler", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("serializes search and detail requests through one global queue", async () => {
    let now = 1_000;
    const sleeps: number[] = [];
    const scheduler = new MercariRequestScheduler({
      config: config({ SCRAPE_SEARCH_MIN_DELAY_MS: 1_000, SCRAPE_DETAIL_MIN_DELAY_MS: 2_000 }),
      logger: buildLogger("silent"),
      metrics: buildMetrics(`mercari_scheduler_test_${Date.now()}_`),
      now: () => now,
      sleep: async (ms) => {
        sleeps.push(ms);
        now += ms;
      },
    });
    const calls: string[] = [];

    const first = await scheduler.request("search", async () => {
      calls.push("search");
      return "search-ok";
    });
    const second = await scheduler.request("detail", async () => {
      calls.push("detail");
      return "detail-ok";
    });

    expect(first).toBe("search-ok");
    expect(second).toBe("detail-ok");
    expect(calls).toEqual(["search", "detail"]);
    expect(sleeps).toEqual([1_000]);
  });

  it("starts a global cooldown after a 429 before later requests run", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);

    let now = 1_000;
    const sleeps: number[] = [];
    const scheduler = new MercariRequestScheduler({
      config: config({ SCRAPE_SEARCH_MIN_DELAY_MS: 100, SCRAPE_RATE_LIMIT_COOLDOWN_MS: 5_000 }),
      logger: buildLogger("silent"),
      metrics: buildMetrics(`mercari_scheduler_test_${Date.now()}_`),
      now: () => now,
      sleep: async (ms) => {
        sleeps.push(ms);
        now += ms;
      },
    });

    await expect(
      scheduler.request("search", async () => {
        throw new MercariApiError("Mercari API responded with 429: Too Many Requests", "search", 429, "Too Many Requests");
      }),
    ).rejects.toThrow("429");

    await scheduler.request("search", async () => "ok");

    expect(sleeps).toEqual([5_000]);
  });
});

function config(overrides: Partial<ReturnType<typeof loadConfig>> = {}) {
  return {
    ...loadConfig({
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
      PORT: "3000",
      ADMIN_TOKEN: "test-token-123",
      ADMIN_ALLOWED_IPS: "127.0.0.1,::1",
      DATABASE_URL: "file:test.db",
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
    }),
    ...overrides,
  };
}
