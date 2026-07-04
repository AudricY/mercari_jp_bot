import { ebayStatusCode, type AppConfig, type Logger, type Metrics } from "@mercari-bot/core";

export type EbaySchedulerEndpoint = "search";

export interface EbayRequestSchedulerDeps {
  config: Pick<AppConfig, "EBAY_SEARCH_MIN_DELAY_MS" | "EBAY_RATE_LIMIT_COOLDOWN_MS">;
  logger: Logger;
  metrics: Metrics;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/**
 * Serializes all eBay API calls behind one queue with a minimum delay between
 * requests and a global cooldown after a 429 — same protection contract as
 * MercariRequestScheduler. All eBay search calls must go through this.
 */
export class EbayRequestScheduler {
  private tail: Promise<unknown> = Promise.resolve();
  private nextAllowedAt = 0;
  private globalCooldownUntil = 0;
  private readonly queuedByEndpoint: Record<EbaySchedulerEndpoint, number> = {
    search: 0,
  };

  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;

  constructor(private readonly deps: EbayRequestSchedulerDeps) {
    this.sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.now = deps.now ?? Date.now;
  }

  request<T>(endpoint: EbaySchedulerEndpoint, operation: () => Promise<T>): Promise<T> {
    this.updateQueueDepth(endpoint, 1);

    const run = async () => {
      this.updateQueueDepth(endpoint, -1);
      return this.execute(endpoint, operation);
    };

    const result = this.tail.then(run, run);
    this.tail = result.catch(() => undefined);
    return result;
  }

  private async execute<T>(endpoint: EbaySchedulerEndpoint, operation: () => Promise<T>): Promise<T> {
    await this.waitUntilAllowed(endpoint);

    const startedAt = this.now();
    try {
      const result = await operation();
      this.observeRequest(endpoint, "200", "success", startedAt);
      this.nextAllowedAt = this.now() + this.deps.config.EBAY_SEARCH_MIN_DELAY_MS;
      return result;
    } catch (error) {
      const statusCode = ebayStatusCode(error);
      const statusCodeLabel = statusCode === null ? "unknown" : String(statusCode);
      const result = statusCode === 429 ? "rate_limited" : "failure";
      this.observeRequest(endpoint, statusCodeLabel, result, startedAt);

      if (statusCode === 429) {
        this.startCooldown(endpoint);
      } else {
        this.nextAllowedAt = this.now() + this.deps.config.EBAY_SEARCH_MIN_DELAY_MS;
      }

      throw error;
    }
  }

  private async waitUntilAllowed(endpoint: EbaySchedulerEndpoint): Promise<void> {
    const waitMs = Math.max(this.nextAllowedAt, this.globalCooldownUntil) - this.now();
    if (waitMs <= 0) {
      return;
    }

    this.deps.logger.debug({ endpoint, waitMs }, "Waiting before eBay request");
    await this.sleep(waitMs);
  }

  private startCooldown(endpoint: EbaySchedulerEndpoint) {
    const baseCooldownMs = this.deps.config.EBAY_RATE_LIMIT_COOLDOWN_MS;
    const jitterMs = Math.floor(baseCooldownMs * 0.2 * Math.random());
    const cooldownMs = baseCooldownMs + jitterMs;
    const until = this.now() + cooldownMs;

    this.globalCooldownUntil = Math.max(this.globalCooldownUntil, until);
    this.nextAllowedAt = Math.max(this.nextAllowedAt, until);
    this.deps.metrics.ebayRateLimitCooldownsTotal.labels(endpoint).inc();
    this.deps.logger.warn({ endpoint, cooldownMs }, "eBay rate limit cooldown started");
  }

  private observeRequest(endpoint: EbaySchedulerEndpoint, statusCode: string, result: string, startedAt: number) {
    this.deps.metrics.ebayRequestsTotal.labels(endpoint, statusCode, result).inc();
    this.deps.metrics.ebayRequestDurationSeconds.labels(endpoint).observe((this.now() - startedAt) / 1000);
  }

  private updateQueueDepth(endpoint: EbaySchedulerEndpoint, delta: number) {
    this.queuedByEndpoint[endpoint] += delta;
    this.deps.metrics.ebayRequestQueueDepth.labels(endpoint).set(this.queuedByEndpoint[endpoint]);
  }
}
