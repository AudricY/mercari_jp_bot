import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";

import type { PrismaClient } from "@prisma/client";
import { parse } from "yaml";

const EBAY_CATALOG_PATH = fileURLToPath(new URL("../../../catalog/ebay-queries.yaml", import.meta.url));

export interface EbayQuerySeed {
  id: string;
  label: string;
  marketplaceId: string;
  keyword: string | null;
  categoryId: string | null;
  filter: string | null;
  platform: string;
  kind: "software" | "console" | "accessory" | "other";
  snapshotIntervalSec: number | null;
  newSweepIntervalSec: number | null;
}

export interface EbayQuerySyncResult {
  created: string[];
  updated: string[];
  disabled: string[];
}

interface RawEbayQuery {
  id?: unknown;
  label?: unknown;
  marketplace_id?: unknown;
  keyword?: unknown;
  category_id?: unknown;
  filter?: unknown;
  platform?: unknown;
  kind?: unknown;
  snapshot_interval_sec?: unknown;
  new_sweep_interval_sec?: unknown;
}

const VALID_KINDS = new Set(["software", "console", "accessory", "other"]);
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

function parseIntervalSec(value: unknown, field: string, queryId: string): number | null {
  if (value === undefined || value === null) {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 300) {
    throw new Error(`ebay-queries.yaml: query ${queryId} has invalid ${field} (min 300 seconds)`);
  }
  return parsed;
}

function parseOptionalString(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

export function parseEbayQueries(content: string): EbayQuerySeed[] {
  const raw = parse(content) as { queries?: RawEbayQuery[] } | null;
  const queries = raw?.queries ?? [];
  const seeds: EbayQuerySeed[] = [];
  const seen = new Set<string>();

  for (const entry of queries) {
    const id = String(entry.id ?? "").trim();
    if (!SLUG_PATTERN.test(id)) {
      throw new Error(`ebay-queries.yaml: invalid id ${JSON.stringify(entry.id)} (lowercase slug required)`);
    }
    if (seen.has(id)) {
      throw new Error(`ebay-queries.yaml: duplicate id ${id}`);
    }
    seen.add(id);

    const kind = String(entry.kind ?? "other");
    if (!VALID_KINDS.has(kind)) {
      throw new Error(`ebay-queries.yaml: query ${id} has invalid kind "${kind}"`);
    }

    const keyword = parseOptionalString(entry.keyword);
    const categoryId = parseOptionalString(entry.category_id);
    if (!keyword && !categoryId) {
      throw new Error(`ebay-queries.yaml: query ${id} needs keyword and/or category_id`);
    }

    seeds.push({
      id,
      label: String(entry.label ?? id),
      marketplaceId: parseOptionalString(entry.marketplace_id) ?? "EBAY_US",
      keyword,
      categoryId,
      filter: parseOptionalString(entry.filter),
      platform: String(entry.platform ?? "unknown"),
      kind: kind as EbayQuerySeed["kind"],
      snapshotIntervalSec: parseIntervalSec(entry.snapshot_interval_sec, "snapshot_interval_sec", id),
      newSweepIntervalSec: parseIntervalSec(entry.new_sweep_interval_sec, "new_sweep_interval_sec", id),
    });
  }

  return seeds;
}

export async function loadEbayQuerySeeds(): Promise<EbayQuerySeed[]> {
  const content = await fs.readFile(EBAY_CATALOG_PATH, "utf-8");
  return parseEbayQueries(content);
}

/** Reconcile catalog/ebay-queries.yaml into the ebay_queries table. */
export async function syncEbayQueriesFromDisk(prisma: PrismaClient): Promise<EbayQuerySyncResult> {
  const seeds = await loadEbayQuerySeeds();
  const existing = await prisma.ebayQuery.findMany();
  const existingById = new Map(existing.map((query) => [query.id, query]));
  const seedIds = new Set(seeds.map((seed) => seed.id));
  const result: EbayQuerySyncResult = { created: [], updated: [], disabled: [] };

  for (const seed of seeds) {
    const data = {
      label: seed.label,
      marketplaceId: seed.marketplaceId,
      keyword: seed.keyword,
      categoryId: seed.categoryId,
      filter: seed.filter,
      platform: seed.platform,
      kind: seed.kind,
      enabled: true,
      snapshotIntervalSec: seed.snapshotIntervalSec,
      newSweepIntervalSec: seed.newSweepIntervalSec,
    };

    if (existingById.has(seed.id)) {
      await prisma.ebayQuery.update({ where: { id: seed.id }, data });
      result.updated.push(seed.id);
    } else {
      await prisma.ebayQuery.create({ data: { id: seed.id, ...data } });
      result.created.push(seed.id);
    }
  }

  for (const query of existing) {
    if (!seedIds.has(query.id) && query.enabled) {
      await prisma.ebayQuery.update({ where: { id: query.id }, data: { enabled: false } });
      result.disabled.push(query.id);
    }
  }

  return result;
}
