-- Create enums
CREATE TYPE "ScanRunStatus" AS ENUM ('running', 'success', 'failed');
CREATE TYPE "NotificationStatus" AS ENUM ('pending', 'sent', 'failed', 'suppressed');

-- keywords
CREATE TABLE "keywords" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "terms" JSONB NOT NULL,
  "filters" JSONB NOT NULL,
  "interval_sec" INTEGER NOT NULL DEFAULT 60,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "keywords_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "keywords_name_key" ON "keywords"("name");

-- listings
CREATE TABLE "listings" (
  "id" TEXT NOT NULL,
  "source_listing_id" TEXT,
  "title" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "image_url" TEXT NOT NULL,
  "currency" TEXT NOT NULL,
  "numeric_price" DECIMAL(12,2) NOT NULL,
  "raw_price_display" TEXT NOT NULL,
  "scraped_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "keyword_id" TEXT,
  CONSTRAINT "listings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "listings_url_key" ON "listings"("url");
CREATE INDEX "listings_keyword_id_scraped_at_idx" ON "listings"("keyword_id", "scraped_at");

-- seen_listings
CREATE TABLE "seen_listings" (
  "id" TEXT NOT NULL,
  "dedupe_key" TEXT NOT NULL,
  "listing_id" TEXT NOT NULL,
  "keyword_id" TEXT NOT NULL,
  "last_price" DECIMAL(12,2) NOT NULL,
  "first_seen_at" TIMESTAMP(3) NOT NULL,
  "last_seen_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "seen_listings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "seen_listings_dedupe_key_key" ON "seen_listings"("dedupe_key");
CREATE INDEX "seen_listings_keyword_id_idx" ON "seen_listings"("keyword_id");

-- scan_runs
CREATE TABLE "scan_runs" (
  "id" TEXT NOT NULL,
  "keyword_id" TEXT NOT NULL,
  "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finished_at" TIMESTAMP(3),
  "status" "ScanRunStatus" NOT NULL DEFAULT 'running',
  "items_found" INTEGER NOT NULL DEFAULT 0,
  "items_new" INTEGER NOT NULL DEFAULT 0,
  "error_code" TEXT,
  "error_message" TEXT,
  CONSTRAINT "scan_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "scan_runs_keyword_id_started_at_idx" ON "scan_runs"("keyword_id", "started_at");

-- notifications
CREATE TABLE "notifications" (
  "id" TEXT NOT NULL,
  "listing_id" TEXT NOT NULL,
  "keyword_id" TEXT NOT NULL,
  "channel" TEXT NOT NULL,
  "status" "NotificationStatus" NOT NULL DEFAULT 'pending',
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "last_error" TEXT,
  "provider_message_id" TEXT,
  "sent_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "notifications_keyword_id_channel_status_idx" ON "notifications"("keyword_id", "channel", "status");

-- daily_keyword_counts
CREATE TABLE "daily_keyword_counts" (
  "date_utc" DATE NOT NULL,
  "keyword_id" TEXT NOT NULL,
  "sent_count" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "daily_keyword_counts_pkey" PRIMARY KEY ("date_utc", "keyword_id")
);

-- system_config
CREATE TABLE "system_config" (
  "key" TEXT NOT NULL,
  "value" JSONB NOT NULL,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "system_config_pkey" PRIMARY KEY ("key")
);

-- foreign keys
ALTER TABLE "listings"
  ADD CONSTRAINT "listings_keyword_id_fkey"
  FOREIGN KEY ("keyword_id") REFERENCES "keywords"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "seen_listings"
  ADD CONSTRAINT "seen_listings_keyword_id_fkey"
  FOREIGN KEY ("keyword_id") REFERENCES "keywords"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "scan_runs"
  ADD CONSTRAINT "scan_runs_keyword_id_fkey"
  FOREIGN KEY ("keyword_id") REFERENCES "keywords"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "notifications"
  ADD CONSTRAINT "notifications_listing_id_fkey"
  FOREIGN KEY ("listing_id") REFERENCES "listings"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "notifications"
  ADD CONSTRAINT "notifications_keyword_id_fkey"
  FOREIGN KEY ("keyword_id") REFERENCES "keywords"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "daily_keyword_counts"
  ADD CONSTRAINT "daily_keyword_counts_keyword_id_fkey"
  FOREIGN KEY ("keyword_id") REFERENCES "keywords"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
