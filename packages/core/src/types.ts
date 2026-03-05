export type Channel = "telegram";

export interface KeywordFilters {
  priceMin: number | null;
  priceMax: number | null;
  titleMustContain: string[];
  excludeKeyword: string | null;
}

export interface KeywordConfig {
  id: string;
  name: string;
  enabled: boolean;
  terms: string[];
  filters: KeywordFilters;
  intervalSec: number;
  topicName: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Listing {
  sourceListingId: string | null;
  title: string;
  url: string;
  imageUrl: string;
  currency: string;
  numericPrice: number;
  rawPriceDisplay: string;
  rawJson?: string;
  rawDetailJson?: string;
  scrapedAt: Date;
}

export interface ScanKeywordJob {
  keywordId: string;
  triggeredBy: "scheduler" | "manual" | "retry";
  runId?: string;
}

export interface NotifyItemJob {
  itemId: string;
  keywordId: string;
  channel: Channel;
}

export interface SendDailySummaryJob {
  dateUtc: string;
  timezone: string;
  channel: Channel;
}

export interface RetryFailedNotificationJob {
  notificationId: string;
  reasonCode: string;
}

export interface ParsedPrice {
  currency: string;
  numericPrice: number;
  displayPrice: string;
}
