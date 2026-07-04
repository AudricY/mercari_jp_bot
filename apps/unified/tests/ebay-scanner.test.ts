import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { EbayClient, EbayItemSummary, EbaySearchParams, EbaySearchResult } from "@mercari-bot/core";

import { EbayRequestScheduler } from "../src/ebay-request-scheduler.js";
import { runDueEbayScans } from "../src/ebay-scanner.js";
import { parseEbayQueries } from "../src/ebay-config.js";
import { createTestContext } from "./test-env.js";

const NOW_MS = Date.now();

function item(id: string, overrides: Partial<EbayItemSummary> = {}): EbayItemSummary {
  return {
    itemId: id,
    title: `Listing ${id}`,
    price: { value: "49.99", currency: "USD" },
    itemWebUrl: `https://www.ebay.com/itm/${id}`,
    image: { imageUrl: "https://example.com/t.jpg" },
    condition: "Used",
    conditionId: "3000",
    buyingOptions: ["FIXED_PRICE"],
    seller: { username: "seller-1" },
    itemCreationDate: new Date(NOW_MS - 3600_000).toISOString(),
    ...overrides,
  };
}

function page(items: EbayItemSummary[], hasMore: boolean): EbaySearchResult {
  return { items, total: items.length, offset: 0, limit: 200, hasMore };
}

describe("ebay scanner", () => {
  let ctx: Awaited<ReturnType<typeof createTestContext>>;
  const searchMock = vi.fn<(params: EbaySearchParams) => Promise<EbaySearchResult>>();

  beforeAll(async () => {
    ctx = await createTestContext();
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  beforeEach(async () => {
    searchMock.mockReset();
    await ctx.prisma.ebayListing.deleteMany();
    await ctx.prisma.ebayQuery.deleteMany();
  });

  function deps() {
    return {
      config: ctx.config,
      logger: ctx.logger,
      metrics: ctx.metrics,
      prisma: ctx.prisma,
      ebayClient: { search: searchMock } as unknown as EbayClient,
      ebayRequests: new EbayRequestScheduler({
        config: ctx.config,
        logger: ctx.logger,
        metrics: ctx.metrics,
      }),
    };
  }

  it("snapshot pages until exhaustion, skips uncollectible items, marks vanished listings gone", async () => {
    await ctx.prisma.ebayQuery.create({
      data: {
        id: "us-ps3-console",
        label: "PS3 consoles (US)",
        marketplaceId: "EBAY_US",
        keyword: "playstation 3 console",
        categoryId: "139971",
        platform: "PS3",
        kind: "console",
        snapshotIntervalSec: 3600,
      },
    });
    // Listing we saw before that will NOT be returned by the sweep.
    await ctx.prisma.ebayListing.create({
      data: {
        ebayItemId: "v1|100|0",
        queryId: "us-ps3-console",
        title: "gone soon",
        price: "10.00",
        currency: "USD",
        status: "on_sale",
        itemWebUrl: "https://www.ebay.com/itm/100",
        firstSeenAt: new Date(NOW_MS - 86400_000),
        lastSeenAt: new Date(NOW_MS - 86400_000),
      },
    });

    searchMock
      .mockResolvedValueOnce(page([item("v1|1|0"), item("v1|no-price|0", { price: undefined })], true))
      .mockResolvedValueOnce(page([item("v1|2|0", { price: { value: "70.00", currency: "USD" } })], false));

    await runDueEbayScans(deps());

    const listings = await ctx.prisma.ebayListing.findMany({ orderBy: { ebayItemId: "asc" } });
    const byId = new Map(listings.map((listing) => [listing.ebayItemId, listing]));
    expect(byId.has("v1|1|0")).toBe(true);
    expect(byId.has("v1|no-price|0")).toBe(false);
    expect(byId.get("v1|2|0")!.price.toString()).toBe("70");
    expect(byId.get("v1|100|0")!.status).toBe("gone");

    const query = await ctx.prisma.ebayQuery.findUnique({ where: { id: "us-ps3-console" } });
    expect(query!.lastSnapshotAt).not.toBeNull();

    // Second page was requested with an advanced offset.
    expect(searchMock.mock.calls[1]![0].offset).toBe(ctx.config.EBAY_SCAN_PAGE_SIZE);
  });

  it("new sweep seeds the cursor on first run and stops at the cursor afterwards", async () => {
    await ctx.prisma.ebayQuery.create({
      data: {
        id: "us-switch-console",
        label: "Switch consoles (US)",
        marketplaceId: "EBAY_US",
        keyword: "nintendo switch console",
        platform: "Nintendo Switch",
        kind: "console",
        newSweepIntervalSec: 300,
      },
    });

    const newest = new Date(NOW_MS - 60_000);
    // First run: one page only (seeding), even though eBay reports more.
    searchMock.mockResolvedValueOnce(
      page([item("v1|10|0", { itemCreationDate: newest.toISOString() })], true),
    );
    await runDueEbayScans(deps());
    expect(searchMock).toHaveBeenCalledTimes(1);

    let query = await ctx.prisma.ebayQuery.findUnique({ where: { id: "us-switch-console" } });
    expect(query!.newCursorCreatedAt?.getTime()).toBe(newest.getTime());
    expect(query!.lastNewSweepAt).not.toBeNull();

    // Force the sweep due again: next run pages until it reaches the cursor.
    await ctx.prisma.ebayQuery.update({
      where: { id: "us-switch-console" },
      data: { lastNewSweepAt: new Date(NOW_MS - 3600_000) },
    });
    searchMock.mockReset();
    const newer = new Date(NOW_MS - 30_000);
    searchMock.mockResolvedValueOnce(
      page(
        [
          item("v1|11|0", { itemCreationDate: newer.toISOString() }),
          // At the cursor -> stop paging even though hasMore is true.
          item("v1|10|0", { itemCreationDate: newest.toISOString() }),
        ],
        true,
      ),
    );

    await runDueEbayScans(deps());
    expect(searchMock).toHaveBeenCalledTimes(1);

    query = await ctx.prisma.ebayQuery.findUnique({ where: { id: "us-switch-console" } });
    expect(query!.newCursorCreatedAt?.getTime()).toBe(newer.getTime());

    const listings = await ctx.prisma.ebayListing.findMany();
    expect(listings).toHaveLength(2);
  });

  it("passes query parameters through to the eBay client", async () => {
    await ctx.prisma.ebayQuery.create({
      data: {
        id: "us-ps5-software",
        label: "PS5 games (US)",
        marketplaceId: "EBAY_GB",
        keyword: "ps5",
        categoryId: "139973",
        filter: "buyingOptions:{FIXED_PRICE}",
        platform: "PS5",
        kind: "software",
        snapshotIntervalSec: 3600,
      },
    });

    searchMock.mockResolvedValueOnce(page([], false));
    await runDueEbayScans(deps());

    const params = searchMock.mock.calls[0]![0];
    expect(params.q).toBe("ps5");
    expect(params.categoryIds).toEqual(["139973"]);
    expect(params.filter).toBe("buyingOptions:{FIXED_PRICE}");
    expect(params.marketplaceId).toBe("EBAY_GB");
    expect(params.sort).toBe("newlyListed");
  });
});

describe("ebay query catalog parsing", () => {
  it("parses a valid catalog", () => {
    const seeds = parseEbayQueries(`
queries:
  - id: us-ps3-console
    label: PS3 consoles (US)
    keyword: playstation 3 console
    category_id: "139971"
    filter: "buyingOptions:{FIXED_PRICE}"
    platform: PS3
    kind: console
    snapshot_interval_sec: 86400
    new_sweep_interval_sec: 3600
`);
    expect(seeds).toHaveLength(1);
    expect(seeds[0]).toMatchObject({
      id: "us-ps3-console",
      marketplaceId: "EBAY_US",
      keyword: "playstation 3 console",
      categoryId: "139971",
      snapshotIntervalSec: 86400,
      newSweepIntervalSec: 3600,
    });
  });

  it("rejects queries without keyword or category", () => {
    expect(() =>
      parseEbayQueries(`
queries:
  - id: bad-query
    kind: other
`),
    ).toThrow(/keyword and\/or category_id/);
  });

  it("rejects duplicate ids, bad slugs, and short intervals", () => {
    expect(() =>
      parseEbayQueries(`
queries:
  - id: dup
    keyword: a
    kind: other
  - id: dup
    keyword: b
    kind: other
`),
    ).toThrow(/duplicate id/);
    expect(() =>
      parseEbayQueries(`
queries:
  - id: "Bad Slug"
    keyword: a
    kind: other
`),
    ).toThrow(/invalid id/);
    expect(() =>
      parseEbayQueries(`
queries:
  - id: ok
    keyword: a
    kind: other
    snapshot_interval_sec: 60
`),
    ).toThrow(/min 300/);
  });
});
