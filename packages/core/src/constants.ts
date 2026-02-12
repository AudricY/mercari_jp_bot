export const QUEUE_NAMES = {
  scan: "scan-keyword",
  notify: "notify-item",
  summary: "send-daily-summary",
  retryNotification: "retry-failed-notification",
} as const;

export const METRIC_NAMES = {
  scanDurationSeconds: "scan_duration_seconds",
  scanItemsFoundTotal: "scan_items_found_total",
  scanItemsNewTotal: "scan_items_new_total",
  notificationSendTotal: "notification_send_total",
  queueJobLatencySeconds: "queue_job_latency_seconds",
  playwrightPageLoadFailuresTotal: "playwright_page_load_failures_total",
} as const;
