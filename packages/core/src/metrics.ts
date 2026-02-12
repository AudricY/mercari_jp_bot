import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from "prom-client";

import { METRIC_NAMES } from "./constants.js";

export interface Metrics {
  registry: Registry;
  scanDurationSeconds: Histogram;
  scanItemsFoundTotal: Counter;
  scanItemsNewTotal: Counter;
  notificationSendTotal: Counter;
  queueJobLatencySeconds: Histogram;
  playwrightPageLoadFailuresTotal: Counter;
  activeWorkers: Gauge;
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

  const queueJobLatencySeconds = new Histogram({
    name: `${prefix}${METRIC_NAMES.queueJobLatencySeconds}`,
    help: "Queue job latency in seconds",
    buckets: [0.01, 0.1, 0.5, 1, 2, 5, 10, 30],
    registers: [registry],
    labelNames: ["queue"] as const,
  });

  const playwrightPageLoadFailuresTotal = new Counter({
    name: `${prefix}${METRIC_NAMES.playwrightPageLoadFailuresTotal}`,
    help: "Total Playwright page load failures",
    registers: [registry],
    labelNames: ["keyword"] as const,
  });

  const activeWorkers = new Gauge({
    name: `${prefix}active_workers`,
    help: "Number of active worker processes",
    registers: [registry],
    labelNames: ["worker"] as const,
  });

  return {
    registry,
    scanDurationSeconds,
    scanItemsFoundTotal,
    scanItemsNewTotal,
    notificationSendTotal,
    queueJobLatencySeconds,
    playwrightPageLoadFailuresTotal,
    activeWorkers,
  };
}
