import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.string().default("info"),
  PORT: z.coerce.number().int().positive().default(3000),
  ADMIN_TOKEN: z.string().min(8),
  ADMIN_ALLOWED_IPS: z.string().default("127.0.0.1,::1"),
  DATABASE_URL: z.string().url().or(z.string().startsWith("postgresql://")).or(z.string().startsWith("file:")),
  REDIS_URL: z.string().optional().default(""),
  TELEGRAM_BOT_TOKEN: z.string().min(8),
  TELEGRAM_CHAT_ID: z.string().min(1),
  TELEGRAM_MIN_DELAY_MS: z.coerce.number().int().positive().default(1200),
  TELEGRAM_MAX_RETRIES: z.coerce.number().int().min(0).max(10).default(3),
  TELEGRAM_BACKOFF_FACTOR: z.coerce.number().positive().default(2),
  SENTRY_DSN: z.string().optional().default(""),
  SCRAPE_CONCURRENCY: z.coerce.number().int().positive().default(2),
  SCRAPE_HTTP_TIMEOUT_MS: z.coerce.number().int().positive().default(15000),
  SCRAPE_MAX_ITEMS_PER_TERM: z.coerce.number().int().positive().default(100),
  SCRAPE_DETAIL_ENABLED: z.coerce.boolean().default(true),
  SCRAPE_DETAIL_DELAY_MS: z.coerce.number().int().min(0).default(500),
  SCHEDULER_TICK_SECONDS: z.coerce.number().int().positive().default(30),
  DISPLAY_TIMEZONE: z.string().default("UTC"),
  DAILY_SUMMARY_TIME: z.string().regex(/^\d{2}:\d{2}$/).default("12:30"),
});

export type AppConfig = z.infer<typeof envSchema> & {
  adminAllowedIps: Set<string>;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.parse(env);
  const adminAllowedIps = new Set(
    parsed.ADMIN_ALLOWED_IPS.split(",")
      .map((ip) => ip.trim())
      .filter(Boolean),
  );

  return {
    ...parsed,
    adminAllowedIps,
  };
}
