-- CreateTable
CREATE TABLE "keywords" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "terms" JSONB NOT NULL,
    "filters" JSONB NOT NULL,
    "interval_sec" INTEGER NOT NULL DEFAULT 60,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "listings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "source_listing_id" TEXT,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "image_url" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "numeric_price" DECIMAL NOT NULL,
    "raw_price_display" TEXT NOT NULL,
    "scraped_at" DATETIME NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "keyword_id" TEXT,
    CONSTRAINT "listings_keyword_id_fkey" FOREIGN KEY ("keyword_id") REFERENCES "keywords" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "seen_listings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "dedupe_key" TEXT NOT NULL,
    "listing_id" TEXT NOT NULL,
    "keyword_id" TEXT NOT NULL,
    "last_price" DECIMAL NOT NULL,
    "first_seen_at" DATETIME NOT NULL,
    "last_seen_at" DATETIME NOT NULL,
    CONSTRAINT "seen_listings_keyword_id_fkey" FOREIGN KEY ("keyword_id") REFERENCES "keywords" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "scan_runs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "keyword_id" TEXT NOT NULL,
    "started_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'running',
    "items_found" INTEGER NOT NULL DEFAULT 0,
    "items_new" INTEGER NOT NULL DEFAULT 0,
    "error_code" TEXT,
    "error_message" TEXT,
    CONSTRAINT "scan_runs_keyword_id_fkey" FOREIGN KEY ("keyword_id") REFERENCES "keywords" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "listing_id" TEXT NOT NULL,
    "keyword_id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "provider_message_id" TEXT,
    "sent_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "notifications_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "notifications_keyword_id_fkey" FOREIGN KEY ("keyword_id") REFERENCES "keywords" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "daily_keyword_counts" (
    "date_utc" DATETIME NOT NULL,
    "keyword_id" TEXT NOT NULL,
    "sent_count" INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY ("date_utc", "keyword_id"),
    CONSTRAINT "daily_keyword_counts_keyword_id_fkey" FOREIGN KEY ("keyword_id") REFERENCES "keywords" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "system_config" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" JSONB NOT NULL,
    "updated_at" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "keywords_name_key" ON "keywords"("name");

-- CreateIndex
CREATE UNIQUE INDEX "listings_url_key" ON "listings"("url");

-- CreateIndex
CREATE INDEX "listings_keyword_id_scraped_at_idx" ON "listings"("keyword_id", "scraped_at");

-- CreateIndex
CREATE UNIQUE INDEX "seen_listings_dedupe_key_key" ON "seen_listings"("dedupe_key");

-- CreateIndex
CREATE INDEX "seen_listings_keyword_id_idx" ON "seen_listings"("keyword_id");

-- CreateIndex
CREATE INDEX "scan_runs_keyword_id_started_at_idx" ON "scan_runs"("keyword_id", "started_at");

-- CreateIndex
CREATE INDEX "notifications_keyword_id_channel_status_idx" ON "notifications"("keyword_id", "channel", "status");
