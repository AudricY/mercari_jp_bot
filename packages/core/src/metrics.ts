import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from "prom-client";

import { METRIC_NAMES } from "./constants.js";

export interface Metrics {
  registry: Registry;
  scanDurationSeconds: Histogram;
  scanItemsFoundTotal: Counter;
  scanItemsNewTotal: Counter;
  scanTermsTotal: Counter;
  notificationSendTotal: Counter;
  scrapeRequestFailuresTotal: Counter;
  mercariRequestsTotal: Counter;
  mercariRequestDurationSeconds: Histogram;
  mercariRateLimitCooldownsTotal: Counter;
  mercariRequestQueueDepth: Gauge;
  ebayRequestsTotal: Counter;
  ebayRequestDurationSeconds: Histogram;
  ebayRateLimitCooldownsTotal: Counter;
  ebayRequestQueueDepth: Gauge;
}

export function buildMetrics(prefix = "mercari_bot_"): Metrics {
  const registry = new Registry();
  collectDefaultMetrics({ register: registry, prefix });

  const scanDurationSeconds = new Histogram({
    name: `${prefix}${METRIC_NAMES.scanDurationSeconds}`,
    help: "Duration of scan jobs in seconds",
    buckets: [0.1, 0.5, 1, 2, 5, 10, 20, 30, 60],
    registers: [registry],
    labelNames: ["keyword"] as const,
  });

  const scanItemsFoundTotal = new Counter({
    name: `${prefix}${METRIC_NAMES.scanItemsFoundTotal}`,
    help: "Total scraped items discovered",
    registers: [registry],
    labelNames: ["keyword"] as const,
  });

  const scanItemsNewTotal = new Counter({
    name: `${prefix}${METRIC_NAMES.scanItemsNewTotal}`,
    help: "Total new items after dedupe",
    registers: [registry],
    labelNames: ["keyword"] as const,
  });

  const scanTermsTotal = new Counter({
    name: `${prefix}${METRIC_NAMES.scanTermsTotal}`,
    help: "Total scan terms by result",
    registers: [registry],
    labelNames: ["keyword", "result"] as const,
  });

  const notificationSendTotal = new Counter({
    name: `${prefix}${METRIC_NAMES.notificationSendTotal}`,
    help: "Total notification sends by status",
    registers: [registry],
    labelNames: ["channel", "status"] as const,
  });

  const scrapeRequestFailuresTotal = new Counter({
    name: `${prefix}${METRIC_NAMES.scrapeRequestFailuresTotal}`,
    help: "Total scrape request failures",
    registers: [registry],
    labelNames: ["keyword"] as const,
  });

  const mercariRequestsTotal = new Counter({
    name: `${prefix}${METRIC_NAMES.mercariRequestsTotal}`,
    help: "Total Mercari API requests by endpoint, status code, and result",
    registers: [registry],
    labelNames: ["endpoint", "status_code", "result"] as const,
  });

  const mercariRequestDurationSeconds = new Histogram({
    name: `${prefix}${METRIC_NAMES.mercariRequestDurationSeconds}`,
    help: "Duration of Mercari API requests in seconds",
    buckets: [0.1, 0.25, 0.5, 1, 2, 5, 10, 20],
    registers: [registry],
    labelNames: ["endpoint"] as const,
  });

  const mercariRateLimitCooldownsTotal = new Counter({
    name: `${prefix}${METRIC_NAMES.mercariRateLimitCooldownsTotal}`,
    help: "Total Mercari rate-limit cooldowns entered",
    registers: [registry],
    labelNames: ["endpoint"] as const,
  });

  const mercariRequestQueueDepth = new Gauge({
    name: `${prefix}${METRIC_NAMES.mercariRequestQueueDepth}`,
    help: "Queued Mercari API requests by endpoint",
    registers: [registry],
    labelNames: ["endpoint"] as const,
  });

  const ebayRequestsTotal = new Counter({
    name: `${prefix}${METRIC_NAMES.ebayRequestsTotal}`,
    help: "Total eBay API requests by endpoint, status code, and result",
    registers: [registry],
    labelNames: ["endpoint", "status_code", "result"] as const,
  });

  const ebayRequestDurationSeconds = new Histogram({
    name: `${prefix}${METRIC_NAMES.ebayRequestDurationSeconds}`,
    help: "Duration of eBay API requests in seconds",
    buckets: [0.1, 0.25, 0.5, 1, 2, 5, 10, 20],
    registers: [registry],
    labelNames: ["endpoint"] as const,
  });

  const ebayRateLimitCooldownsTotal = new Counter({
    name: `${prefix}${METRIC_NAMES.ebayRateLimitCooldownsTotal}`,
    help: "Total eBay rate-limit cooldowns entered",
    registers: [registry],
    labelNames: ["endpoint"] as const,
  });

  const ebayRequestQueueDepth = new Gauge({
    name: `${prefix}${METRIC_NAMES.ebayRequestQueueDepth}`,
    help: "Queued eBay API requests by endpoint",
    registers: [registry],
    labelNames: ["endpoint"] as const,
  });

  return {
    registry,
    scanDurationSeconds,
    scanItemsFoundTotal,
    scanItemsNewTotal,
    scanTermsTotal,
    notificationSendTotal,
    scrapeRequestFailuresTotal,
    mercariRequestsTotal,
    mercariRequestDurationSeconds,
    mercariRateLimitCooldownsTotal,
    mercariRequestQueueDepth,
    ebayRequestsTotal,
    ebayRequestDurationSeconds,
    ebayRateLimitCooldownsTotal,
    ebayRequestQueueDepth,
  };
}
