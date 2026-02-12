import type {
  NotifyItemJob,
  RetryFailedNotificationJob,
  ScanKeywordJob,
  SendDailySummaryJob,
} from "./types.js";

export type QueuePayloadMap = {
  "scan-keyword": ScanKeywordJob;
  "notify-item": NotifyItemJob;
  "send-daily-summary": SendDailySummaryJob;
  "retry-failed-notification": RetryFailedNotificationJob;
};
