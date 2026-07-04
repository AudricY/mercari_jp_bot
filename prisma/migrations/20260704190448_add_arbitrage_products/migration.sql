-- CreateTable
CREATE TABLE "arbitrage_products" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "label" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "shipping_class" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "mercari_category_ids" JSONB NOT NULL,
    "mercari_aliases" JSONB NOT NULL,
    "mercari_exclude" JSONB NOT NULL,
    "ebay_aliases" JSONB NOT NULL,
    "ebay_exclude" JSONB NOT NULL,
    "ebay_require_any" JSONB NOT NULL,
    "max_buy_jpy_override" INTEGER,
    "notes" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);
