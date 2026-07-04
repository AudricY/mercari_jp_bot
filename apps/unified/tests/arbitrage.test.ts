import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/notifier.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/notifier.js")>();
  return { ...original, sendTelegramText: vi.fn() };
});

import { checkArbitrageAlerts } from "../src/arbitrage-alerts.js";
import { parseArbitrageCatalog } from "../src/arbitrage-config.js";
import {
  buildArbitrageReport,
  compileArbitrageProduct,
  matchesEbayTitle,
  matchesMercariTitle,
  resetArbitrageCache,
} from "../src/arbitrage.js";
import { sendTelegramText } from "../src/notifier.js";
import { createTestContext } from "./test-env.js";

const sendTelegramTextMock = vi.mocked(sendTelegramText);

const NOW_MS = Date.now();

const PRODUCT_SEED = {
  id: "ps3-console",
  label: "PS3 console",
  platform: "PS3",
  kind: "console",
  shippingClass: "console",
  mercariCategoryIds: [7091],
  mercariAliases: ["PS3 本体", "プレステ3 本体"],
  mercariExclude: ["ジャンク"],
  ebayAliases: ["ps3 console", "playstation 3 console"],
  ebayExclude: ["for parts"],
  ebayRequireAny: [],
};

function mercariListing(mercariId: string, overrides: Record<string, unknown> = {}) {
  return {
    mercariId,
    categoryId: 7091,
    title: "PS3 本体 CECH-3000",
    price: 5000,
    status: "on_sale",
    mercariCreatedSec: Math.floor(NOW_MS / 1000) - 3600,
    mercariUpdatedSec: Math.floor(NOW_MS / 1000) - 3600,
    firstSeenAt: new Date(NOW_MS - 3600_000),
    lastSeenAt: new Date(NOW_MS - 3600_000),
    ...overrides,
  };
}

function ebayListing(ebayItemId: string, overrides: Record<string, unknown> = {}) {
  return {
    ebayItemId,
    queryId: "us-ps3-console",
    title: "Sony PS3 Console Japan Import",
    price: "100.00",
    currency: "USD",
    status: "on_sale",
    itemWebUrl: `https://www.ebay.com/itm/${ebayItemId}`,
    firstSeenAt: new Date(NOW_MS - 3600_000),
    lastSeenAt: new Date(NOW_MS - 3600_000),
    ...overrides,
  };
}

describe("arbitrage", () => {
  let ctx: Awaited<ReturnType<typeof createTestContext>>;

  beforeAll(async () => {
    ctx = await createTestContext({
      ARBITRAGE_FX_JPY_PER_USD: 150,
      ARBITRAGE_CACHE_TTL_SEC: 0,
    });
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  beforeEach(async () => {
    resetArbitrageCache();
    sendTelegramTextMock.mockReset();
    await ctx.prisma.ebayListing.deleteMany();
    await ctx.prisma.ebayQuery.deleteMany();
    await ctx.prisma.marketListing.deleteMany();
    await ctx.prisma.marketCategory.deleteMany();
    await ctx.prisma.arbitrageProduct.deleteMany();

    await ctx.prisma.marketCategory.create({
      data: { id: 7091, label: "PS3 本体", platform: "PS3", kind: "console" },
    });
    await ctx.prisma.ebayQuery.create({
      data: {
        id: "us-ps3-console",
        label: "PS3 consoles (US)",
        marketplaceId: "EBAY_US",
        keyword: "playstation 3 console",
        platform: "PS3",
        kind: "console",
      },
    });
  });

  function deps() {
    return { config: ctx.config, logger: ctx.logger, metrics: ctx.metrics, prisma: ctx.prisma };
  }

  async function seedProduct(overrides: Record<string, unknown> = {}) {
    return ctx.prisma.arbitrageProduct.create({ data: { ...PRODUCT_SEED, ...overrides } });
  }

  describe("title matching", () => {
    it("matches Mercari aliases with normalization and honors excludes", async () => {
      const product = compileArbitrageProduct(await seedProduct());
      expect(matchesMercariTitle(product, "【美品】PS3本体 CECH-4000B すぐ遊べる")).toBe(true);
      expect(matchesMercariTitle(product, "プレステ3 本体 500GB")).toBe(true);
      expect(matchesMercariTitle(product, "PS3本体 ジャンク品")).toBe(false);
      expect(matchesMercariTitle(product, "PS3 ソフト まとめ売り")).toBe(false);
    });

    it("applies eBay excludes and require_any", async () => {
      const product = compileArbitrageProduct(
        await seedProduct({ ebayRequireAny: ["japan", "japanese"] }),
      );
      expect(matchesEbayTitle(product, "Sony PS3 Console Japan Import CECH-3000")).toBe(true);
      expect(matchesEbayTitle(product, "Sony PS3 Console US Version")).toBe(false);
      expect(matchesEbayTitle(product, "PS3 Console Japan - For Parts")).toBe(false);
    });
  });

  describe("report", () => {
    it("computes cross-market stats, economics, and verdicts", async () => {
      await seedProduct();
      await ctx.prisma.marketListing.createMany({
        data: [
          mercariListing("m-cheap", { price: 4000 }),
          mercariListing("m-mid", { price: 6000 }),
          mercariListing("m-junk", { title: "PS3 本体 ジャンク", price: 1000 }),
          mercariListing("m-sold", {
            price: 5500,
            status: "sold_out",
            soldPrice: 5500,
            soldObservedAt: new Date(NOW_MS - 2 * 86400_000),
          }),
        ],
      });
      await ctx.prisma.ebayListing.createMany({
        data: [
          ebayListing("v1|1|0", { price: "90.00" }),
          ebayListing("v1|2|0", { price: "110.00" }),
          ebayListing("v1|3|0", { title: "PS3 Console For Parts", price: "20.00" }),
          ebayListing("v1|4|0", { status: "gone", price: "95.00" }),
        ],
      });

      const report = await buildArbitrageReport(deps());
      expect(report.fx.jpyPerUsd).toBe(150);
      expect(report.fx.source).toBe("env");
      expect(report.opportunities).toHaveLength(1);

      const opportunity = report.opportunities[0]!;
      expect(opportunity.mercari.liveCount).toBe(2); // junk excluded
      expect(opportunity.mercari.cheapestLiveJpy).toBe(4000);
      expect(opportunity.mercari.medianSoldJpy).toBe(5500);
      expect(opportunity.mercari.soldCount30d).toBe(1);
      expect(opportunity.ebay.liveCount).toBe(2); // for-parts excluded
      expect(opportunity.ebay.lowestLiveUsd).toBe(90);
      expect(opportunity.ebay.medianLiveUsd).toBe(100);
      expect(opportunity.ebay.goneCount30d).toBe(1);

      // buy 4000: landed = (4000+500+800)/150 + 28 = 63.33; net = 100*0.8475-0.30 = 84.45
      expect(opportunity.economics).not.toBeNull();
      expect(opportunity.economics!.landedCostUsd).toBe(63.33);
      expect(opportunity.economics!.netProceedsUsd).toBe(84.45);
      expect(opportunity.economics!.marginUsd).toBe(21.12);
      // ROI 33.4% ≥ 30% target and 4000 ≤ derived max-buy → actionable now.
      expect(opportunity.verdict).toBe("buy");
      expect(opportunity.effectiveMaxBuyJpy).toBe(4244);
    });

    it("returns no_data when a side has no comps", async () => {
      await seedProduct();
      await ctx.prisma.marketListing.create({ data: mercariListing("m-only") });

      const report = await buildArbitrageReport(deps());
      expect(report.opportunities[0]!.verdict).toBe("no_data");
      expect(report.opportunities[0]!.economics).toBeNull();
    });
  });

  describe("routes", () => {
    it("serves ranked opportunities", async () => {
      await seedProduct();
      await ctx.prisma.marketListing.create({ data: mercariListing("m-1", { price: 4000 }) });
      await ctx.prisma.ebayListing.create({ data: ebayListing("v1|1|0") });

      const response = await ctx.app.inject({
        method: "GET",
        url: "/v1/analytics/arbitrage/opportunities",
        headers: ctx.authHeaders(),
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.fx.jpyPerUsd).toBe(150);
      expect(body.feeModel.targetRoiPct).toBeGreaterThan(0);
      expect(body.opportunities[0].slug).toBe("ps3-console");
      expect(body.opportunities[0].economics.netProceedsUsd).toBeGreaterThan(0);
    });

    it("serves product detail with per-listing economics and 404s unknown slugs", async () => {
      await seedProduct();
      await ctx.prisma.marketListing.create({ data: mercariListing("m-1", { price: 4000 }) });
      await ctx.prisma.ebayListing.create({ data: ebayListing("v1|1|0") });

      const detail = await ctx.app.inject({
        method: "GET",
        url: "/v1/analytics/arbitrage/products/ps3-console",
        headers: ctx.authHeaders(),
      });
      expect(detail.statusCode).toBe(200);
      const body = detail.json();
      expect(body.product.slug).toBe("ps3-console");
      expect(body.mercariLive).toHaveLength(1);
      expect(body.mercariLive[0].landedCostUsd).toBeGreaterThan(0);
      expect(body.ebayLive).toHaveLength(1);

      const missing = await ctx.app.inject({
        method: "GET",
        url: "/v1/analytics/arbitrage/products/nope",
        headers: ctx.authHeaders(),
      });
      expect(missing.statusCode).toBe(404);
    });
  });

  describe("alerts", () => {
    it("alerts once per fresh listing at or below the effective max-buy", async () => {
      await seedProduct({ maxBuyJpyOverride: 4500 });
      await ctx.prisma.marketListing.createMany({
        data: [
          mercariListing("m-deal", { price: 4200, firstSeenAt: new Date(NOW_MS - 60_000) }),
          mercariListing("m-expensive", { price: 9000, firstSeenAt: new Date(NOW_MS - 60_000) }),
          mercariListing("m-old", { price: 3000, firstSeenAt: new Date(NOW_MS - 86400_000) }),
        ],
      });

      const alerted = new Set<string>();
      const since = new Date(NOW_MS - 300_000);
      const sent = await checkArbitrageAlerts(deps(), since, alerted);

      expect(sent).toBe(1);
      expect(alerted.has("m-deal")).toBe(true);
      expect(sendTelegramTextMock).toHaveBeenCalledTimes(1);
      const [, text] = sendTelegramTextMock.mock.calls[0]!;
      expect(text).toContain("PS3 console");
      expect(text).toContain("¥4,200");
      expect(text).toContain("https://jp.mercari.com/item/m-deal");

      // Second pass: nothing new, no duplicate alert.
      const sentAgain = await checkArbitrageAlerts(deps(), since, alerted);
      expect(sentAgain).toBe(0);
      expect(sendTelegramTextMock).toHaveBeenCalledTimes(1);
    });
  });
});

describe("arbitrage catalog parsing", () => {
  const economics = `
economics:
  fx_jpy_per_usd_fallback: 150
  ebay_final_value_fee_pct: 13.25
  ebay_fixed_fee_usd: 0.30
  ebay_ad_rate_pct: 2.0
  proxy_fee_jpy: 500
  proxy_fee_pct: 0
  jp_domestic_shipping_jpy: 800
  intl_shipping_usd_by_class:
    small_packet: 8
    console: 28
  target_roi_pct: 30
`;

  it("parses a valid catalog", () => {
    const catalog = parseArbitrageCatalog(`${economics}
products:
  - id: ps3-console
    label: PS3 console
    platform: PS3
    kind: console
    shipping_class: console
    mercari:
      category_ids: [7091]
      aliases: ["PS3 本体"]
      exclude: ["ジャンク"]
    ebay:
      aliases: ["ps3 console"]
      require_any: ["japan"]
`);
    expect(catalog.feeModel.ebayFinalValueFeePct).toBe(13.25);
    expect(catalog.fxJpyPerUsdFallback).toBe(150);
    expect(catalog.products).toHaveLength(1);
    expect(catalog.products[0]!.mercariCategoryIds).toEqual([7091]);
    expect(catalog.products[0]!.ebayRequireAny).toEqual(["japan"]);
  });

  it("rejects an unknown shipping class", () => {
    expect(() =>
      parseArbitrageCatalog(`${economics}
products:
  - id: x
    kind: console
    shipping_class: freight
    mercari: { category_ids: [1], aliases: ["a"] }
    ebay: { aliases: ["b"] }
`),
    ).toThrow(/shipping_class "freight"/);
  });

  it("rejects products missing matchers", () => {
    expect(() =>
      parseArbitrageCatalog(`${economics}
products:
  - id: x
    kind: console
    shipping_class: console
    mercari: { category_ids: [1], aliases: [] }
    ebay: { aliases: ["b"] }
`),
    ).toThrow(/mercari.category_ids and mercari.aliases/);
  });
});
