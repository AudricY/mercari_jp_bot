-- CreateTable
CREATE TABLE "ebay_queries" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "label" TEXT NOT NULL,
    "marketplace_id" TEXT NOT NULL,
    "keyword" TEXT,
    "category_id" TEXT,
    "filter" TEXT,
    "platform" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "snapshot_interval_sec" INTEGER,
    "new_sweep_interval_sec" INTEGER,
    "new_cursor_created_at" DATETIME,
    "last_snapshot_at" DATETIME,
    "last_new_sweep_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ebay_listings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ebay_item_id" TEXT NOT NULL,
    "query_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "price" DECIMAL NOT NULL,
    "currency" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "condition" TEXT,
    "condition_id" INTEGER,
    "buying_options" TEXT,
    "seller_username" TEXT,
    "item_web_url" TEXT NOT NULL,
    "image_url" TEXT,
    "ebay_created_at" DATETIME,
    "first_seen_at" DATETIME NOT NULL,
    "last_seen_at" DATETIME NOT NULL,
    CONSTRAINT "ebay_listings_query_id_fkey" FOREIGN KEY ("query_id") REFERENCES "ebay_queries" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "ebay_listings_ebay_item_id_key" ON "ebay_listings"("ebay_item_id");

-- CreateIndex
CREATE INDEX "ebay_listings_query_id_status_price_idx" ON "ebay_listings"("query_id", "status", "price");

-- CreateIndex
CREATE INDEX "ebay_listings_query_id_ebay_created_at_idx" ON "ebay_listings"("query_id", "ebay_created_at");

-- CreateIndex
CREATE INDEX "ebay_listings_status_last_seen_at_idx" ON "ebay_listings"("status", "last_seen_at");
