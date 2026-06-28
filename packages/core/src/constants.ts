export const METRIC_NAMES = {
  scanDurationSeconds: "scan_duration_seconds",
  scanItemsFoundTotal: "scan_items_found_total",
  scanItemsNewTotal: "scan_items_new_total",
  scanTermsTotal: "scan_terms_total",
  notificationSendTotal: "notification_send_total",
  scrapeRequestFailuresTotal: "scrape_request_failures_total",
  mercariRequestsTotal: "mercari_requests_total",
  mercariRequestDurationSeconds: "mercari_request_duration_seconds",
  mercariRateLimitCooldownsTotal: "mercari_rate_limit_cooldowns_total",
  mercariRequestQueueDepth: "mercari_request_queue_depth",
} as const;
