import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { MercariSearchParams, MercariSearchResult } from "@mercari-bot/core";

vi.mock("@mercari-bot/core", async (importOriginal) => {
  const original = await importOriginal<typeof import("@mercari-bot/core")>();
  return {
    ...original,
    searchMercari: vi.fn(),
  };
});

import { searchMercari } from "@mercari-bot/core";

import { MercariRequestScheduler } from "../src/mercari-request-scheduler.js";
import { runDueMarketScans } from "../src/market-scanner.js";
import { createTestContext } from "./test-env.js";

const searchMercariMock = vi.mocked(searchMercari);

const NOW_SEC = Math.floor(Date.now() / 1000);

function item(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    name: `Listing ${id}`,
    price: "5000",
    status: "ITEM_STATUS_ON_SALE",
    created: String(NOW_SEC - 3600),
    updated: String(NOW_SEC - 3600),
    categoryId: "7091",
    itemConditionId: "3",
    sellerId: "seller-1",
    thumbnails: ["https://example.com/t.jpg"],
    ...overrides,
  };
}

function page(items: unknown[], nextPageToken: string): MercariSearchResult {
  return { items: items as MercariSearchResult["items"], numFound: null, nextPageToken };
}

describe("market scanner", () => {
  let ctx: Awaited<ReturnType<typeof createTestContext>>;

  beforeAll(async () => {
    ctx = await createTestContext();
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  beforeEach(async () => {
    searchMercariMock.mockReset();
    await ctx.prisma.marketListing.deleteMany();
    await ctx.prisma.marketCategory.deleteMany();
  });

  function deps() {
    return {
      config: ctx.config,
      logger: ctx.logger,
      metrics: ctx.metrics,
      prisma: ctx.prisma,
      mercariRequests: new MercariRequestScheduler({
        config: ctx.config,
        logger: ctx.logger,
        metrics: ctx.metrics,
      }),
    };
  }

  it("snapshot pages until exhaustion, filters foreign categories, marks vanished listings gone", async () => {
    await ctx.prisma.marketCategory.create({
      data: { id: 7091, label: "PS3 本体", platform: "PS3", kind: "console", snapshotIntervalSec: 3600 },
    });
    // Listing we saw before that will NOT be returned by the sweep.
    await ctx.prisma.marketListing.create({
      data: {
        mercariId: "m-vanished",
        categoryId: 7091,
        title: "gone soon",
        price: 100,
        status: "on_sale",
        mercariCreatedSec: NOW_SEC - 86400,
        mercariUpdatedSec: NOW_SEC - 86400,
        firstSeenAt: new Date(Date.now() - 86400_000),
        lastSeenAt: new Date(Date.now() - 86400_000),
      },
    });

    searchMercariMock
      .mockResolvedValueOnce(page([item("m-1"), item("m-foreign", { categoryId: "702" })], "v1:1"))
      .mockResolvedValueOnce(page([item("m-2", { price: "7000" })], ""));

    await runDueMarketScans(deps());

    const listings = await ctx.prisma.marketListing.findMany({ orderBy: { mercariId: "asc" } });
    const byId = new Map(listings.map((listing) => [listing.mercariId, listing]));
    expect(byId.has("m-1")).toBe(true);
    expect(byId.has("m-foreign")).toBe(false);
    expect(byId.get("m-2")!.price).toBe(7000);
    expect(byId.get("m-vanished")!.status).toBe("gone");

    const category = await ctx.prisma.marketCategory.findUnique({ where: { id: 7091 } });
    expect(category!.lastSnapshotAt).not.toBeNull();

    // Only STATUS_ON_SALE searches were issued for a snapshot-only category.
    for (const call of searchMercariMock.mock.calls) {
      expect((call[0] as MercariSearchParams).status).toEqual(["STATUS_ON_SALE"]);
    }
  });

  it("sold sweep stamps sold price/time once and keeps the first observation", async () => {
    await ctx.prisma.marketCategory.create({
      data: { id: 7091, label: "PS3 本体", platform: "PS3", kind: "console", soldSweepIntervalSec: 60 },
    });

    searchMercariMock.mockResolvedValueOnce(
      page([item("m-sold", { status: "ITEM_STATUS_SOLD_OUT", price: "6500" })], ""),
    );
    await runDueMarketScans(deps());

    const first = await ctx.prisma.marketListing.findUnique({ where: { mercariId: "m-sold" } });
    expect(first!.status).toBe("sold_out");
    expect(first!.soldPrice).toBe(6500);
    expect(first!.soldObservedAt).not.toBeNull();
    const firstObservedAt = first!.soldObservedAt!.getTime();

    // Force the sweep due again; same item returns with a different price.
    await ctx.prisma.marketCategory.update({
      where: { id: 7091 },
      data: { lastSoldSweepAt: new Date(Date.now() - 3600_000) },
    });
    searchMercariMock.mockResolvedValueOnce(
      page([item("m-sold", { status: "ITEM_STATUS_SOLD_OUT", price: "9999" })], ""),
    );
    await runDueMarketScans(deps());

    const second = await ctx.prisma.marketListing.findUnique({ where: { mercariId: "m-sold" } });
    expect(second!.soldPrice).toBe(6500); // original sold price preserved
    expect(second!.soldObservedAt!.getTime()).toBe(firstObservedAt);
  });

  it("new sweep takes one page on first run and advances the created cursor", async () => {
    await ctx.prisma.marketCategory.create({
      data: { id: 702, label: "Switch ソフト", platform: "Nintendo Switch", kind: "software", newSweepIntervalSec: 60 },
    });

    searchMercariMock.mockResolvedValueOnce(
      page(
        [
          item("m-new-1", { categoryId: "702", created: String(NOW_SEC - 100) }),
          item("m-new-2", { categoryId: "702", created: String(NOW_SEC - 200) }),
        ],
        "v1:1",
      ),
    );
    await runDueMarketScans(deps());

    let category = await ctx.prisma.marketCategory.findUnique({ where: { id: 702 } });
    expect(category!.newCursorCreatedSec).toBe(NOW_SEC - 100);
    expect(searchMercariMock).toHaveBeenCalledTimes(1); // first run bounded to one page

    // Second run: stops as soon as the page reaches the cursor.
    await ctx.prisma.marketCategory.update({
      where: { id: 702 },
      data: { lastNewSweepAt: new Date(Date.now() - 3600_000) },
    });
    searchMercariMock.mockResolvedValueOnce(
      page(
        [
          item("m-new-3", { categoryId: "702", created: String(NOW_SEC - 50) }),
          item("m-new-1", { categoryId: "702", created: String(NOW_SEC - 100) }),
        ],
        "v1:1",
      ),
    );
    await runDueMarketScans(deps());

    expect(searchMercariMock).toHaveBeenCalledTimes(2); // cursor stop, no second page
    category = await ctx.prisma.marketCategory.findUnique({ where: { id: 702 } });
    expect(category!.newCursorCreatedSec).toBe(NOW_SEC - 50);
    const count = await ctx.prisma.marketListing.count();
    expect(count).toBe(3);
  });
});
