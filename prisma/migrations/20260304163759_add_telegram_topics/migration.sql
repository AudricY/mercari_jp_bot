-- CreateTable
CREATE TABLE "telegram_topics" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "chat_id" TEXT NOT NULL,
    "topic_name" TEXT NOT NULL,
    "thread_id" INTEGER NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_keywords" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "terms" JSONB NOT NULL,
    "filters" JSONB NOT NULL,
    "interval_sec" INTEGER NOT NULL DEFAULT 60,
    "topic_name" TEXT,
    "topic_id" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "keywords_topic_id_fkey" FOREIGN KEY ("topic_id") REFERENCES "telegram_topics" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_keywords" ("created_at", "enabled", "filters", "id", "interval_sec", "name", "terms", "updated_at") SELECT "created_at", "enabled", "filters", "id", "interval_sec", "name", "terms", "updated_at" FROM "keywords";
DROP TABLE "keywords";
ALTER TABLE "new_keywords" RENAME TO "keywords";
CREATE UNIQUE INDEX "keywords_name_key" ON "keywords"("name");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "telegram_topics_chat_id_topic_name_key" ON "telegram_topics"("chat_id", "topic_name");
