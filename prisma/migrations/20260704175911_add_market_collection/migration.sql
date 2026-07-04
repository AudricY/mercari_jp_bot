-- CreateTable
CREATE TABLE "market_categories" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "label" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "snapshot_interval_sec" INTEGER,
    "sold_sweep_interval_sec" INTEGER,
    "new_sweep_interval_sec" INTEGER,
    "new_cursor_created_sec" INTEGER,
    "last_snapshot_at" DATETIME,
    "last_sold_sweep_at" DATETIME,
    "last_new_sweep_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "market_listings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "mercari_id" TEXT NOT NULL,
    "category_id" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "price" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "condition_id" INTEGER,
    "seller_id" TEXT,
    "shipping_payer_id" INTEGER,
    "thumbnail_url" TEXT,
    "mercari_created_sec" INTEGER NOT NULL,
    "mercari_updated_sec" INTEGER NOT NULL,
    "sold_price" INTEGER,
    "sold_observed_at" DATETIME,
    "first_seen_at" DATETIME NOT NULL,
    "last_seen_at" DATETIME NOT NULL,
    CONSTRAINT "market_listings_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "market_categories" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "daily_category_market_stats" (
    "date_utc" DATETIME NOT NULL,
    "category_id" INTEGER NOT NULL,
    "on_sale_count" INTEGER NOT NULL,
    "new_listing_count" INTEGER NOT NULL,
    "sold_count" INTEGER NOT NULL,
    "asking_min_price" DECIMAL,
    "asking_median_price" DECIMAL,
    "asking_p25_price" DECIMAL,
    "asking_p75_price" DECIMAL,
    "sold_min_price" DECIMAL,
    "sold_median_price" DECIMAL,
    "sold_p25_price" DECIMAL,
    "sold_p75_price" DECIMAL,
    "sold_max_price" DECIMAL,

    PRIMARY KEY ("date_utc", "category_id"),
    CONSTRAINT "daily_category_market_stats_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "market_categories" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "market_listings_mercari_id_key" ON "market_listings"("mercari_id");

-- CreateIndex
CREATE INDEX "market_listings_category_id_status_price_idx" ON "market_listings"("category_id", "status", "price");

-- CreateIndex
CREATE INDEX "market_listings_category_id_mercari_created_sec_idx" ON "market_listings"("category_id", "mercari_created_sec");

-- CreateIndex
CREATE INDEX "market_listings_category_id_sold_observed_at_idx" ON "market_listings"("category_id", "sold_observed_at");

-- CreateIndex
CREATE INDEX "market_listings_status_last_seen_at_idx" ON "market_listings"("status", "last_seen_at");
