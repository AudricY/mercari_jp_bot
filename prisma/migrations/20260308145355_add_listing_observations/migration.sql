-- CreateTable
CREATE TABLE "listing_observations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "keyword_id" TEXT NOT NULL,
    "listing_id" TEXT,
    "source_listing_id" TEXT,
    "listing_url" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "image_url" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "numeric_price" DECIMAL NOT NULL,
    "raw_price_display" TEXT NOT NULL,
    "observed_at" DATETIME NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "listing_observations_keyword_id_fkey" FOREIGN KEY ("keyword_id") REFERENCES "keywords" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "listing_observations_keyword_id_observed_at_idx" ON "listing_observations"("keyword_id", "observed_at");

-- CreateIndex
CREATE INDEX "listing_observations_keyword_id_numeric_price_observed_at_idx" ON "listing_observations"("keyword_id", "numeric_price", "observed_at");

-- CreateIndex
CREATE INDEX "listing_observations_source_listing_id_idx" ON "listing_observations"("source_listing_id");
