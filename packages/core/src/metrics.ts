import { Counter, Histogram, Registry, collectDefaultMetrics } from "prom-client";

import { METRIC_NAMES } from "./constants.js";

export interface Metrics {
  registry: Registry;
  scanDurationSeconds: Histogram;
  scanItemsFoundTotal: Counter;
  scanItemsNewTotal: Counter;
  notificationSendTotal: Counter;
  scrapeRequestFailuresTotal: Counter;
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

  return {
    registry,
    scanDurationSeconds,
    scanItemsFoundTotal,
    scanItemsNewTotal,
    notificationSendTotal,
    scrapeRequestFailuresTotal,
  };
}
