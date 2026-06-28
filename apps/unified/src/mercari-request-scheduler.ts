import { MercariApiError, type AppConfig, type Logger, type Metrics } from "@mercari-bot/core";

export type MercariEndpoint = "search" | "detail";

export interface MercariRequestSchedulerDeps {
  config: Pick<AppConfig, "SCRAPE_SEARCH_MIN_DELAY_MS" | "SCRAPE_DETAIL_MIN_DELAY_MS" | "SCRAPE_RATE_LIMIT_COOLDOWN_MS">;
  logger: Logger;
  metrics: Metrics;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export class MercariRequestScheduler {
  private tail: Promise<unknown> = Promise.resolve();
  private nextAllowedAt = 0;
  private globalCooldownUntil = 0;
  private readonly queuedByEndpoint: Record<MercariEndpoint, number> = {
    search: 0,
    detail: 0,
  };

  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;

  constructor(private readonly deps: MercariRequestSchedulerDeps) {
    this.sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.now = deps.now ?? Date.now;
  }

  request<T>(endpoint: MercariEndpoint, operation: () => Promise<T>): Promise<T> {
    this.updateQueueDepth(endpoint, 1);

    const run = async () => {
      this.updateQueueDepth(endpoint, -1);
      return this.execute(endpoint, operation);
    };

    const result = this.tail.then(run, run);
    this.tail = result.catch(() => undefined);
    return result;
  }

  private async execute<T>(endpoint: MercariEndpoint, operation: () => Promise<T>): Promise<T> {
    await this.waitUntilAllowed(endpoint);

    const startedAt = this.now();
    try {
      const result = await operation();
      this.observeRequest(endpoint, "200", "success", startedAt);
      this.nextAllowedAt = this.now() + this.delayFor(endpoint);
      return result;
    } catch (error) {
      const statusCode = mercariStatusCode(error);
      const statusCodeLabel = statusCode === null ? "unknown" : String(statusCode);
      const result = statusCode === 429 ? "rate_limited" : "failure";
      this.observeRequest(endpoint, statusCodeLabel, result, startedAt);

      if (statusCode === 429) {
        this.startCooldown(endpoint);
      } else {
        this.nextAllowedAt = this.now() + this.delayFor(endpoint);
      }

      throw error;
    }
  }

  private async waitUntilAllowed(endpoint: MercariEndpoint): Promise<void> {
    const waitMs = Math.max(this.nextAllowedAt, this.globalCooldownUntil) - this.now();
    if (waitMs <= 0) {
      return;
    }

    this.deps.logger.debug({ endpoint, waitMs }, "Waiting before Mercari request");
    await this.sleep(waitMs);
  }

  private startCooldown(endpoint: MercariEndpoint) {
    const baseCooldownMs = this.deps.config.SCRAPE_RATE_LIMIT_COOLDOWN_MS;
    const jitterMs = Math.floor(baseCooldownMs * 0.2 * Math.random());
    const cooldownMs = baseCooldownMs + jitterMs;
    const until = this.now() + cooldownMs;

    this.globalCooldownUntil = Math.max(this.globalCooldownUntil, until);
    this.nextAllowedAt = Math.max(this.nextAllowedAt, until);
    this.deps.metrics.mercariRateLimitCooldownsTotal.labels(endpoint).inc();
    this.deps.logger.warn({ endpoint, cooldownMs }, "Mercari rate limit cooldown started");
  }

  private delayFor(endpoint: MercariEndpoint): number {
    if (endpoint === "detail") {
      return this.deps.config.SCRAPE_DETAIL_MIN_DELAY_MS;
    }
    return this.deps.config.SCRAPE_SEARCH_MIN_DELAY_MS;
  }

  private observeRequest(endpoint: MercariEndpoint, statusCode: string, result: string, startedAt: number) {
    this.deps.metrics.mercariRequestsTotal.labels(endpoint, statusCode, result).inc();
    this.deps.metrics.mercariRequestDurationSeconds.labels(endpoint).observe((this.now() - startedAt) / 1000);
  }

  private updateQueueDepth(endpoint: MercariEndpoint, delta: number) {
    this.queuedByEndpoint[endpoint] += delta;
    this.deps.metrics.mercariRequestQueueDepth.labels(endpoint).set(this.queuedByEndpoint[endpoint]);
  }
}

export function mercariStatusCode(error: unknown): number | null {
  if (error instanceof MercariApiError) {
    return error.statusCode;
  }

  if (error instanceof Error) {
    const match = error.message.match(/responded with (\d{3})/);
    return match?.[1] ? Number.parseInt(match[1], 10) : null;
  }

  return null;
}
