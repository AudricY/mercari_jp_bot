-- AlterTable
ALTER TABLE "scan_runs" ADD COLUMN "terms_attempted" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "scan_runs" ADD COLUMN "terms_succeeded" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "scan_runs" ADD COLUMN "terms_rate_limited" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "scan_runs" ADD COLUMN "terms_failed" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "scan_run_terms" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scan_run_id" TEXT NOT NULL,
    "term" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "status_code" INTEGER,
    "items_found" INTEGER NOT NULL DEFAULT 0,
    "items_new" INTEGER NOT NULL DEFAULT 0,
    "duration_ms" INTEGER NOT NULL DEFAULT 0,
    "error_message" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "scan_run_terms_scan_run_id_fkey" FOREIGN KEY ("scan_run_id") REFERENCES "scan_runs" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "scan_run_terms_scan_run_id_idx" ON "scan_run_terms"("scan_run_id");

-- CreateIndex
CREATE INDEX "scan_run_terms_status_idx" ON "scan_run_terms"("status");
