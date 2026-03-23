-- CreateTable
CREATE TABLE "items" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "slug" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "series" TEXT,
    "target_buy_price" DECIMAL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "matchers" JSONB NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "daily_item_market_stats" (
    "date_utc" DATETIME NOT NULL,
    "item_id" TEXT NOT NULL,
    "listing_count" INTEGER NOT NULL,
    "min_price" DECIMAL NOT NULL,
    "median_price" DECIMAL NOT NULL,
    "max_price" DECIMAL NOT NULL,
    "latest_scraped_at" DATETIME NOT NULL,

    PRIMARY KEY ("date_utc", "item_id"),
    CONSTRAINT "daily_item_market_stats_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_listings" (
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
    "raw_json" TEXT,
    "raw_detail_json" TEXT,
    "keyword_id" TEXT,
    "item_id" TEXT,
    "item_match_status" TEXT,
    "item_subfamily" TEXT,
    CONSTRAINT "listings_keyword_id_fkey" FOREIGN KEY ("keyword_id") REFERENCES "keywords" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "listings_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_listings" ("created_at", "currency", "id", "image_url", "keyword_id", "numeric_price", "raw_detail_json", "raw_json", "raw_price_display", "scraped_at", "source_listing_id", "title", "updated_at", "url") SELECT "created_at", "currency", "id", "image_url", "keyword_id", "numeric_price", "raw_detail_json", "raw_json", "raw_price_display", "scraped_at", "source_listing_id", "title", "updated_at", "url" FROM "listings";
DROP TABLE "listings";
ALTER TABLE "new_listings" RENAME TO "listings";
CREATE UNIQUE INDEX "listings_url_key" ON "listings"("url");
CREATE INDEX "listings_keyword_id_scraped_at_idx" ON "listings"("keyword_id", "scraped_at");
CREATE INDEX "listings_item_id_scraped_at_idx" ON "listings"("item_id", "scraped_at");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "items_slug_key" ON "items"("slug");
