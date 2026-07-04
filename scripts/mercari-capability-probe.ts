#!/usr/bin/env tsx
/*
 * Probe Mercari search/detail API capabilities beyond what the bot uses today.
 *
 * Answers, empirically:
 *   1. Does STATUS_SOLD_OUT search work anonymously, and what do sold items look like?
 *   2. Does pageToken pagination work, and how deep can we go?
 *   3. Does a keyword-less category-only search work (category browsing)?
 *   4. Do SORT_PRICE / itemConditionId filters work?
 *   5. What fields does the search response carry that we currently discard?
 *   6. What does item detail carry (condition, category path, seller, engagement)?
 *
 * Low-volume by design: ~15-25 requests total with a fixed inter-request delay.
 * Run it from any IP; it discovers capabilities, not rate ceilings. Use
 * scripts/mercari-rate-probe.ts for rate-limit probing on the production IP.
 *
 * Usage:
 *   pnpm run probe:mercari-capabilities            # all scenarios
 *   pnpm run probe:mercari-capabilities -- --only sold,pagination
 *   pnpm run probe:mercari-capabilities -- --delay-ms 3000 --out tmp/probe.json
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  MercariApiError,
  fetchMercariItemDetail,
  searchMercari,
  type MercariSearchOrder,
  type MercariSearchSort,
  type MercariSearchStatus,
} from "@mercari-bot/core";

interface SearchConditionOverrides {
  keyword?: string;
  sort?: string;
  order?: string;
  status?: string[];
  categoryId?: number[];
  priceMin?: number;
  priceMax?: number;
  itemConditionId?: number[];
}

interface SearchCall {
  pageSize?: number;
  pageToken?: string;
  condition: SearchConditionOverrides;
}

interface ScenarioResult {
  scenario: string;
  ok: boolean;
  notes: string[];
  requests: number;
  samples: unknown[];
}

interface ProbeOptions {
  delayMs: number;
  only: string[] | null;
  out: string;
}

let requestCount = 0;

async function searchRaw(call: SearchCall, timeoutMs = 15000): Promise<{
  status: number;
  json: Record<string, unknown> | null;
  bodyText: string | null;
}> {
  requestCount += 1;
  try {
    const result = await searchMercari({
      keyword: call.condition.keyword ?? "",
      categoryId: call.condition.categoryId,
      status: call.condition.status as MercariSearchStatus[] | undefined,
      sort: call.condition.sort as MercariSearchSort | undefined,
      order: call.condition.order as MercariSearchOrder | undefined,
      priceMin: call.condition.priceMin,
      priceMax: call.condition.priceMax,
      itemConditionId: call.condition.itemConditionId,
      pageSize: call.pageSize ?? 120,
      pageToken: call.pageToken ?? "",
      timeoutMs,
    });
    return {
      status: 200,
      json: {
        items: result.items,
        meta: { numFound: result.numFound, nextPageToken: result.nextPageToken },
      },
      bodyText: null,
    };
  } catch (error) {
    if (error instanceof MercariApiError) {
      return { status: error.statusCode, json: null, bodyText: error.responseBody };
    }
    throw error;
  }
}

async function fetchDetailRaw(itemId: string, timeoutMs = 15000): Promise<{
  status: number;
  json: Record<string, unknown> | null;
  bodyText: string | null;
}> {
  requestCount += 1;
  try {
    const raw = await fetchMercariItemDetail({ itemId, timeoutMs });
    return { status: 200, json: JSON.parse(raw) as Record<string, unknown>, bodyText: null };
  } catch (error) {
    if (error instanceof MercariApiError) {
      return { status: error.statusCode, json: null, bodyText: error.responseBody };
    }
    throw error;
  }
}

function items(json: Record<string, unknown> | null): Array<Record<string, unknown>> {
  return (json?.items as Array<Record<string, unknown>>) ?? [];
}

function fieldInventory(records: Array<Record<string, unknown>>): Record<string, string> {
  const inventory: Record<string, string> = {};
  for (const record of records) {
    for (const [key, value] of Object.entries(record)) {
      if (inventory[key]) continue;
      if (value === null || value === undefined || value === "") continue;
      if (Array.isArray(value) && value.length === 0) continue;
      inventory[key] = Array.isArray(value) ? "array" : typeof value === "object" ? "object" : typeof value;
    }
  }
  return inventory;
}

function summarizeItem(item: Record<string, unknown>): Record<string, unknown> {
  return {
    id: item.id,
    name: typeof item.name === "string" ? (item.name as string).slice(0, 60) : item.name,
    price: item.price,
    status: item.status,
    created: item.created,
    updated: item.updated,
    itemConditionId: item.itemConditionId,
    itemType: item.itemType,
  };
}

const sleep = (ms: number) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

type Scenario = (delayMs: number) => Promise<ScenarioResult>;

const probeSoldSearch: Scenario = async (delayMs) => {
  const result: ScenarioResult = { scenario: "sold", ok: false, notes: [], requests: 0, samples: [] };

  const sold = await searchRaw({
    pageSize: 30,
    condition: {
      keyword: "ゼルダの伝説 Switch",
      categoryId: [702],
      status: ["STATUS_SOLD_OUT", "STATUS_TRADING"],
      sort: "SORT_CREATED_TIME",
    },
  });
  result.requests += 1;

  if (sold.status !== 200) {
    result.notes.push(`sold-status search failed: HTTP ${sold.status} body=${sold.bodyText?.slice(0, 300)}`);
    return result;
  }

  const soldItems = items(sold.json);
  result.ok = soldItems.length > 0;
  result.notes.push(`sold-status search returned ${soldItems.length} items`);
  const statuses = [...new Set(soldItems.map((item) => String(item.status)))];
  result.notes.push(`statuses seen: ${statuses.join(", ")}`);
  result.notes.push(`meta: ${JSON.stringify(sold.json?.meta ?? null)}`);
  result.samples.push({ fieldInventory: fieldInventory(soldItems), first: soldItems.slice(0, 3).map(summarizeItem) });

  await sleep(delayMs);

  // Sorted by updated recency? Compare created vs updated on sold items to see
  // whether `updated` approximates the sale time.
  const withTimes = soldItems
    .filter((item) => item.created && item.updated)
    .map((item) => ({ created: Number(item.created), updated: Number(item.updated) }));
  if (withTimes.length > 0) {
    const updatedAfterCreated = withTimes.filter((t) => t.updated > t.created).length;
    result.notes.push(`items with updated > created: ${updatedAfterCreated}/${withTimes.length} (updated ≈ sale/last-touch time)`);
  }

  return result;
};

const probePagination: Scenario = async (delayMs) => {
  const result: ScenarioResult = { scenario: "pagination", ok: false, notes: [], requests: 0, samples: [] };

  let pageToken = "";
  const seenIds = new Set<string>();
  const maxPages = 3;

  for (let page = 0; page < maxPages; page += 1) {
    const response = await searchRaw({
      pageSize: 120,
      pageToken,
      condition: { keyword: "", categoryId: [702], sort: "SORT_CREATED_TIME" },
    });
    result.requests += 1;

    if (response.status !== 200) {
      result.notes.push(`page ${page} failed: HTTP ${response.status} body=${response.bodyText?.slice(0, 300)}`);
      return result;
    }

    const pageItems = items(response.json);
    const newIds = pageItems.map((item) => String(item.id)).filter((id) => !seenIds.has(id));
    for (const id of newIds) seenIds.add(id);

    const meta = response.json?.meta as Record<string, unknown> | undefined;
    const nextToken = (meta?.nextPageToken as string) ?? "";
    result.notes.push(
      `page ${page}: ${pageItems.length} items (${newIds.length} unseen), nextPageToken=${nextToken ? `"${nextToken.slice(0, 24)}..."` : "EMPTY"}, numFound=${meta?.numFound ?? "?"}`,
    );
    if (page === 0) {
      result.samples.push({ meta });
    }

    if (!nextToken) break;
    pageToken = nextToken;
    await sleep(delayMs);
  }

  result.ok = seenIds.size > 120;
  result.notes.push(`total unique items across pages: ${seenIds.size}`);
  return result;
};

const probeCategoryBrowse: Scenario = async (delayMs) => {
  const result: ScenarioResult = { scenario: "category-browse", ok: false, notes: [], requests: 0, samples: [] };

  // Keyword-less browse of the console-hardware categories used in config.yaml
  for (const categoryId of [7091, 6988]) {
    const response = await searchRaw({
      pageSize: 20,
      condition: { keyword: "", categoryId: [categoryId], sort: "SORT_CREATED_TIME" },
    });
    result.requests += 1;

    if (response.status !== 200) {
      result.notes.push(`category ${categoryId}: HTTP ${response.status} body=${response.bodyText?.slice(0, 200)}`);
    } else {
      const found = items(response.json);
      const meta = response.json?.meta as Record<string, unknown> | undefined;
      result.notes.push(`category ${categoryId}: ${found.length} items, numFound=${meta?.numFound ?? "?"}`);
      result.samples.push({ categoryId, first: found.slice(0, 2).map(summarizeItem) });
      result.ok = result.ok || found.length > 0;
    }
    await sleep(delayMs);
  }

  return result;
};

const probeSortsAndFilters: Scenario = async (delayMs) => {
  const result: ScenarioResult = { scenario: "sorts-filters", ok: false, notes: [], requests: 0, samples: [] };

  const priceAsc = await searchRaw({
    pageSize: 20,
    condition: { keyword: "ポケットモンスター Switch", categoryId: [702], sort: "SORT_PRICE", order: "ORDER_ASC", priceMin: 500 },
  });
  result.requests += 1;
  if (priceAsc.status === 200) {
    const prices = items(priceAsc.json).map((item) => Number(item.price));
    const sorted = prices.every((price, index) => index === 0 || price >= prices[index - 1]!);
    result.notes.push(`SORT_PRICE ASC: ${prices.length} items, monotonic=${sorted}, first prices=${prices.slice(0, 5).join(",")}`);
    result.ok = sorted && prices.length > 0;
  } else {
    result.notes.push(`SORT_PRICE ASC failed: HTTP ${priceAsc.status}`);
  }

  await sleep(delayMs);

  const condition = await searchRaw({
    pageSize: 20,
    condition: { keyword: "ゼルダの伝説 Switch", categoryId: [702], itemConditionId: [1, 2] },
  });
  result.requests += 1;
  if (condition.status === 200) {
    const conditionIds = [...new Set(items(condition.json).map((item) => String(item.itemConditionId)))];
    result.notes.push(`itemConditionId [1,2] filter: ${items(condition.json).length} items, condition ids seen: ${conditionIds.join(",")}`);
  } else {
    result.notes.push(`itemConditionId filter failed: HTTP ${condition.status}`);
  }

  return result;
};

const probeItemDetail: Scenario = async (delayMs) => {
  const result: ScenarioResult = { scenario: "item-detail", ok: false, notes: [], requests: 0, samples: [] };

  const search = await searchRaw({
    pageSize: 5,
    condition: { keyword: "ゼルダの伝説 Switch", categoryId: [702] },
  });
  result.requests += 1;
  const first = items(search.json)[0];
  if (!first) {
    result.notes.push("no item found to fetch detail for");
    return result;
  }

  await sleep(delayMs);

  const detail = await fetchDetailRaw(String(first.id));
  result.requests += 1;
  if (detail.status !== 200 || !detail.json) {
    result.notes.push(`detail failed: HTTP ${detail.status} body=${detail.bodyText?.slice(0, 200)}`);
    return result;
  }

  const data = (detail.json.data ?? detail.json) as Record<string, unknown>;
  result.ok = true;
  result.notes.push(`detail fields: ${Object.keys(data).sort().join(", ")}`);

  const category = data.item_category as Record<string, unknown> | undefined;
  if (category) {
    result.notes.push(`item_category: ${JSON.stringify(category)}`);
  }
  const interesting: Record<string, unknown> = {};
  for (const key of [
    "id",
    "status",
    "price",
    "item_condition",
    "item_category",
    "num_likes",
    "num_comments",
    "updated",
    "created",
    "shipping_payer",
    "seller",
  ]) {
    if (data[key] !== undefined) {
      interesting[key] =
        key === "seller" ? { id: (data.seller as Record<string, unknown>)?.id, ratings: (data.seller as Record<string, unknown>)?.ratings, num_ratings: (data.seller as Record<string, unknown>)?.num_ratings } : data[key];
    }
  }
  result.samples.push(interesting);

  return result;
};

const probeSoldOnly: Scenario = async (delayMs) => {
  const result: ScenarioResult = { scenario: "sold-only", ok: false, notes: [], requests: 0, samples: [] };

  const sold = await searchRaw({
    pageSize: 30,
    condition: {
      keyword: "ゼルダの伝説 Switch",
      categoryId: [702],
      status: ["STATUS_SOLD_OUT"],
      sort: "SORT_CREATED_TIME",
    },
  });
  result.requests += 1;

  if (sold.status !== 200) {
    result.notes.push(`sold-only search failed: HTTP ${sold.status} body=${sold.bodyText?.slice(0, 300)}`);
    return result;
  }

  const soldItems = items(sold.json);
  const statuses = [...new Set(soldItems.map((item) => String(item.status)))];
  const meta = sold.json?.meta as Record<string, unknown> | undefined;
  result.ok = soldItems.some((item) => item.status === "ITEM_STATUS_SOLD_OUT");
  result.notes.push(`sold-only: ${soldItems.length} items, statuses: ${statuses.join(", ")}, numFound=${meta?.numFound ?? "?"}`);
  result.samples.push({ first: soldItems.slice(0, 5).map(summarizeItem) });

  await sleep(delayMs);

  // Freshness check: with SORT_CREATED_TIME DESC on sold items, how recent are
  // the most recently *updated* (≈ sold) items on the first page?
  const nowSec = Math.floor(Date.now() / 1000);
  const updatedAges = soldItems
    .map((item) => nowSec - Number(item.updated))
    .filter((age) => Number.isFinite(age))
    .sort((left, right) => left - right);
  if (updatedAges.length > 0) {
    result.notes.push(
      `updated-age (sec) min=${updatedAges[0]} p50=${updatedAges[Math.floor(updatedAges.length / 2)]} max=${updatedAges.at(-1)}`,
    );
  }

  return result;
};

const probeCategoryTree: Scenario = async (delayMs) => {
  const result: ScenarioResult = { scenario: "category-tree", ok: false, notes: [], requests: 0, samples: [] };

  // Browse the テレビゲーム parent category (76) keyword-less and collect the
  // leaf categoryId values that come back on items.
  const leafCounts = new Map<string, number>();
  let pageToken = "";
  for (let page = 0; page < 3; page += 1) {
    const response = await searchRaw({
      pageSize: 120,
      pageToken,
      condition: { keyword: "", categoryId: [76], sort: "SORT_CREATED_TIME" },
    });
    result.requests += 1;
    if (response.status !== 200) {
      result.notes.push(`browse category 76 page ${page} failed: HTTP ${response.status} body=${response.bodyText?.slice(0, 200)}`);
      return result;
    }
    const found = items(response.json);
    for (const item of found) {
      const categoryId = String(item.categoryId ?? "unknown");
      leafCounts.set(categoryId, (leafCounts.get(categoryId) ?? 0) + 1);
    }
    const meta = response.json?.meta as Record<string, unknown> | undefined;
    if (page === 0) {
      result.notes.push(`category 76 keyword-less browse: numFound=${meta?.numFound ?? "?"}`);
    }
    pageToken = (meta?.nextPageToken as string) ?? "";
    if (!pageToken) break;
    await sleep(delayMs);
  }

  const sorted = [...leafCounts.entries()].sort(([, left], [, right]) => right - left);
  result.ok = sorted.length > 1;
  result.notes.push(`leaf categoryIds seen in 360 newest items: ${sorted.map(([id, count]) => `${id}(${count})`).join(", ")}`);
  result.samples.push({ leafCounts: Object.fromEntries(sorted) });

  await sleep(delayMs);

  // Per-leaf on-sale volume via cheap pageSize=1 hit-count queries.
  const volumes: Record<string, string> = {};
  for (const [categoryId] of sorted.slice(0, 10)) {
    const response = await searchRaw({
      pageSize: 1,
      condition: { keyword: "", categoryId: [Number(categoryId)], sort: "SORT_CREATED_TIME" },
    });
    result.requests += 1;
    const meta = response.json?.meta as Record<string, unknown> | undefined;
    volumes[categoryId] = response.status === 200 ? String(meta?.numFound ?? "?") : `HTTP ${response.status}`;
    await sleep(delayMs);
  }
  result.notes.push(`on-sale numFound by leaf category: ${JSON.stringify(volumes)}`);
  result.samples.push({ volumes });

  return result;
};

// Video-game category leaves discovered via the category-tree scenario plus
// item-detail ntiers paths (see docs/mercari-scrape-intelligence.md).
const GAME_CATEGORY_LEAVES: Array<{ id: number; label: string }> = [
  { id: 702, label: "Switch ソフト" },
  { id: 7015, label: "Switch 2 ソフト" },
  { id: 6985, label: "PS5 ソフト" },
  { id: 6989, label: "PS4 ソフト" },
  { id: 7092, label: "PS3 ソフト" },
  { id: 704, label: "3DS/2DS ソフト" },
  { id: 7051, label: "DS ソフト" },
  { id: 7105, label: "Wii ソフト" },
  { id: 7145, label: "PS2 ソフト" },
  { id: 7172, label: "GBA ソフト" },
  { id: 7180, label: "GB ソフト" },
  { id: 7188, label: "SFC ソフト" },
  { id: 7200, label: "FC ソフト" },
  { id: 701, label: "Switch 本体" },
  { id: 703, label: "Switch Lite 本体" },
  { id: 6988, label: "PS4 本体" },
  { id: 7091, label: "PS3 本体" },
];

const probeVolumes: Scenario = async (delayMs) => {
  const result: ScenarioResult = { scenario: "volumes", ok: false, notes: [], requests: 0, samples: [] };
  const rows: Array<Record<string, unknown>> = [];

  for (const { id, label } of GAME_CATEGORY_LEAVES) {
    const onSale = await searchRaw({ pageSize: 120, condition: { keyword: "", categoryId: [id] } });
    result.requests += 1;
    await sleep(delayMs);
    const sold = await searchRaw({
      pageSize: 1,
      condition: { keyword: "", categoryId: [id], status: ["STATUS_SOLD_OUT"] },
    });
    result.requests += 1;
    await sleep(delayMs);

    if (onSale.status !== 200 || sold.status !== 200) {
      result.notes.push(`${id} ${label}: onSale HTTP ${onSale.status}, sold HTTP ${sold.status}`);
      continue;
    }

    const onSaleItems = items(onSale.json);
    const onSaleMeta = onSale.json?.meta as Record<string, unknown> | undefined;
    const soldMeta = sold.json?.meta as Record<string, unknown> | undefined;

    // Estimate new listings/day from the created-time span of the newest page.
    let newPerDay: number | null = null;
    if (onSaleItems.length >= 2) {
      const newest = Number(onSaleItems[0]!.created);
      const oldest = Number(onSaleItems[onSaleItems.length - 1]!.created);
      if (newest > oldest) {
        newPerDay = Math.round((onSaleItems.length / (newest - oldest)) * 86400);
      }
    }

    const row = {
      categoryId: id,
      label,
      onSaleCount: onSaleMeta?.numFound ?? null,
      soldIndexCount: soldMeta?.numFound ?? null,
      estNewListingsPerDay: newPerDay,
    };
    rows.push(row);
    result.notes.push(
      `${id} ${label}: onSale=${row.onSaleCount} soldIndex=${row.soldIndexCount} estNew/day=${row.estNewListingsPerDay ?? "?"}`,
    );
  }

  result.ok = rows.length > 0;
  result.samples.push({ rows });
  return result;
};

const SCENARIOS: Record<string, Scenario> = {
  "sold-only": probeSoldOnly,
  "category-tree": probeCategoryTree,
  volumes: probeVolumes,
  sold: probeSoldSearch,
  pagination: probePagination,
  "category-browse": probeCategoryBrowse,
  "sorts-filters": probeSortsAndFilters,
  "item-detail": probeItemDetail,
};

function parseArgs(args: string[]): ProbeOptions {
  const options: ProbeOptions = { delayMs: 2000, only: null, out: "tmp/mercari-capability-probe.json" };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!;
    if (arg === "--") {
      continue;
    } else if (arg === "--delay-ms") {
      options.delayMs = Number.parseInt(args[++i] ?? "", 10);
      if (!Number.isInteger(options.delayMs) || options.delayMs < 500) {
        throw new Error("--delay-ms must be an integer >= 500");
      }
    } else if (arg === "--only") {
      options.only = (args[++i] ?? "").split(",").map((part) => part.trim()).filter(Boolean);
    } else if (arg === "--out") {
      options.out = args[++i] ?? options.out;
    } else if (arg === "--help") {
      console.log(`Usage: pnpm run probe:mercari-capabilities -- [--delay-ms 2000] [--only ${Object.keys(SCENARIOS).join(",")}] [--out tmp/probe.json]`);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const names = options.only ?? Object.keys(SCENARIOS);

  for (const name of names) {
    if (!SCENARIOS[name]) {
      throw new Error(`Unknown scenario: ${name}. Available: ${Object.keys(SCENARIOS).join(", ")}`);
    }
  }

  console.log(`Mercari capability probe — scenarios: ${names.join(", ")}, delayMs=${options.delayMs}`);
  const results: ScenarioResult[] = [];

  for (const name of names) {
    console.log(`\n== ${name} ==`);
    try {
      const result = await SCENARIOS[name]!(options.delayMs);
      results.push(result);
      for (const note of result.notes) {
        console.log(`  ${note}`);
      }
      console.log(`  -> ok=${result.ok} requests=${result.requests}`);
    } catch (error) {
      results.push({ scenario: name, ok: false, notes: [String(error)], requests: 0, samples: [] });
      console.log(`  ERROR: ${error}`);
    }
    await sleep(options.delayMs);
  }

  const outPath = resolve(options.out);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify({ ranAt: new Date().toISOString(), totalRequests: requestCount, results }, null, 2));
  console.log(`\nTotal Mercari requests: ${requestCount}`);
  console.log(`Full results written to ${outPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
