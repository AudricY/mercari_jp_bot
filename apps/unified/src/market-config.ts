import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";

import type { PrismaClient } from "@prisma/client";
import { parse } from "yaml";

const MARKET_CATALOG_PATH = fileURLToPath(new URL("../../../catalog/market-categories.yaml", import.meta.url));

export interface MarketCategorySeed {
  categoryId: number;
  label: string;
  platform: string;
  kind: "software" | "console" | "accessory" | "other";
  snapshotIntervalSec: number | null;
  soldSweepIntervalSec: number | null;
  newSweepIntervalSec: number | null;
}

export interface MarketCategorySyncResult {
  created: number[];
  updated: number[];
  disabled: number[];
}

interface RawMarketCategory {
  category_id?: unknown;
  label?: unknown;
  platform?: unknown;
  kind?: unknown;
  snapshot_interval_sec?: unknown;
  sold_sweep_interval_sec?: unknown;
  new_sweep_interval_sec?: unknown;
}

const VALID_KINDS = new Set(["software", "console", "accessory", "other"]);

function parseIntervalSec(value: unknown, field: string, categoryId: number): number | null {
  if (value === undefined || value === null) {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 300) {
    throw new Error(`market-categories.yaml: category ${categoryId} has invalid ${field} (min 300 seconds)`);
  }
  return parsed;
}

export function parseMarketCategories(content: string): MarketCategorySeed[] {
  const raw = parse(content) as { categories?: RawMarketCategory[] } | null;
  const categories = raw?.categories ?? [];
  const seeds: MarketCategorySeed[] = [];
  const seen = new Set<number>();

  for (const entry of categories) {
    const categoryId = Number(entry.category_id);
    if (!Number.isInteger(categoryId) || categoryId <= 0) {
      throw new Error(`market-categories.yaml: invalid category_id ${JSON.stringify(entry.category_id)}`);
    }
    if (seen.has(categoryId)) {
      throw new Error(`market-categories.yaml: duplicate category_id ${categoryId}`);
    }
    seen.add(categoryId);

    const kind = String(entry.kind ?? "other");
    if (!VALID_KINDS.has(kind)) {
      throw new Error(`market-categories.yaml: category ${categoryId} has invalid kind "${kind}"`);
    }

    seeds.push({
      categoryId,
      label: String(entry.label ?? categoryId),
      platform: String(entry.platform ?? "unknown"),
      kind: kind as MarketCategorySeed["kind"],
      snapshotIntervalSec: parseIntervalSec(entry.snapshot_interval_sec, "snapshot_interval_sec", categoryId),
      soldSweepIntervalSec: parseIntervalSec(entry.sold_sweep_interval_sec, "sold_sweep_interval_sec", categoryId),
      newSweepIntervalSec: parseIntervalSec(entry.new_sweep_interval_sec, "new_sweep_interval_sec", categoryId),
    });
  }

  return seeds;
}

export async function loadMarketCategorySeeds(): Promise<MarketCategorySeed[]> {
  const content = await fs.readFile(MARKET_CATALOG_PATH, "utf-8");
  return parseMarketCategories(content);
}

/** Reconcile catalog/market-categories.yaml into the market_categories table. */
export async function syncMarketCategoriesFromDisk(prisma: PrismaClient): Promise<MarketCategorySyncResult> {
  const seeds = await loadMarketCategorySeeds();
  const existing = await prisma.marketCategory.findMany();
  const existingById = new Map(existing.map((category) => [category.id, category]));
  const seedIds = new Set(seeds.map((seed) => seed.categoryId));
  const result: MarketCategorySyncResult = { created: [], updated: [], disabled: [] };

  for (const seed of seeds) {
    const data = {
      label: seed.label,
      platform: seed.platform,
      kind: seed.kind,
      enabled: true,
      snapshotIntervalSec: seed.snapshotIntervalSec,
      soldSweepIntervalSec: seed.soldSweepIntervalSec,
      newSweepIntervalSec: seed.newSweepIntervalSec,
    };

    if (existingById.has(seed.categoryId)) {
      await prisma.marketCategory.update({ where: { id: seed.categoryId }, data });
      result.updated.push(seed.categoryId);
    } else {
      await prisma.marketCategory.create({ data: { id: seed.categoryId, ...data } });
      result.created.push(seed.categoryId);
    }
  }

  for (const category of existing) {
    if (!seedIds.has(category.id) && category.enabled) {
      await prisma.marketCategory.update({ where: { id: category.id }, data: { enabled: false } });
      result.disabled.push(category.id);
    }
  }

  return result;
}
