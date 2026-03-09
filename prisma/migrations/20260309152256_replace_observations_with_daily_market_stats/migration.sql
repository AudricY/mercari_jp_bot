-- CreateTable
CREATE TABLE "daily_keyword_market_stats" (
    "date_utc" DATETIME NOT NULL,
    "keyword_id" TEXT NOT NULL,
    "listing_count" INTEGER NOT NULL,
    "min_price" DECIMAL NOT NULL,
    "median_price" DECIMAL NOT NULL,
    "max_price" DECIMAL NOT NULL,
    "latest_scraped_at" DATETIME NOT NULL,

    PRIMARY KEY ("date_utc", "keyword_id"),
    CONSTRAINT "daily_keyword_market_stats_keyword_id_fkey" FOREIGN KEY ("keyword_id") REFERENCES "keywords" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

WITH ranked AS (
    SELECT
        "keyword_id",
        (CAST("observed_at" AS INTEGER) / 86400000) * 86400000 AS "date_utc",
        COALESCE("source_listing_id", "listing_url") AS "listing_key",
        CAST("numeric_price" AS REAL) AS "numeric_price",
        CAST("observed_at" AS INTEGER) AS "observed_at",
        ROW_NUMBER() OVER (
            PARTITION BY "keyword_id", (CAST("observed_at" AS INTEGER) / 86400000)
            ORDER BY CAST("numeric_price" AS REAL)
        ) AS "row_num",
        COUNT(*) OVER (
            PARTITION BY "keyword_id", (CAST("observed_at" AS INTEGER) / 86400000)
        ) AS "row_count"
    FROM "listing_observations"
),
aggregated AS (
    SELECT
        "keyword_id",
        "date_utc",
        COUNT(DISTINCT "listing_key") AS "listing_count",
        MIN("numeric_price") AS "min_price",
        AVG(CASE
            WHEN "row_num" IN (("row_count" + 1) / 2, ("row_count" + 2) / 2)
            THEN "numeric_price"
        END) AS "median_price",
        MAX("numeric_price") AS "max_price",
        MAX("observed_at") AS "latest_scraped_at"
    FROM ranked
    GROUP BY "keyword_id", "date_utc"
)
INSERT INTO "daily_keyword_market_stats" (
    "date_utc",
    "keyword_id",
    "listing_count",
    "min_price",
    "median_price",
    "max_price",
    "latest_scraped_at"
)
SELECT
    "date_utc",
    "keyword_id",
    "listing_count",
    "min_price",
    "median_price",
    "max_price",
    "latest_scraped_at"
FROM aggregated;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "listing_observations";
PRAGMA foreign_keys=on;
