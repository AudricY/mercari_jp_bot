import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { backfillListingItems, classifyListing } from "../src/items.js";
import { createTestContext, uniqueId } from "./test-env.js";

describe("item classification", () => {
  it("matches software titles, flags bundles, and extracts hardware subfamily", () => {
    const items = [
      {
        id: "pokemon-violet-id",
        slug: "pokemon-violet",
        displayName: "Pokemon Violet",
        kind: "software",
        platform: "Nintendo Switch",
        series: "Pokemon",
        targetBuyPrice: 3600,
        normalizedAliases: ["ポケットモンスターバイオレット", "pokemonviolet"],
      },
      {
        id: "pokemon-sword-id",
        slug: "pokemon-sword",
        displayName: "Pokemon Sword",
        kind: "software",
        platform: "Nintendo Switch",
        series: "Pokemon",
        targetBuyPrice: 3450,
        normalizedAliases: ["ポケットモンスターソード", "pokemonsword"],
      },
      {
        id: "pokemon-shield-id",
        slug: "pokemon-shield",
        displayName: "Pokemon Shield",
        kind: "software",
        platform: "Nintendo Switch",
        series: "Pokemon",
        targetBuyPrice: 3250,
        normalizedAliases: ["ポケットモンスターシールド", "pokemonshield"],
      },
      {
        id: "switch-oled-id",
        slug: "switch_oled",
        displayName: "Nintendo Switch OLED",
        kind: "hardware",
        platform: "Nintendo Switch",
        series: "Handhelds",
        targetBuyPrice: null,
        normalizedAliases: ["nintendoswitch有機el", "switcholed", "heg001"],
      },
    ] as const;

    expect(classifyListing({ title: "ポケットモンスター バイオレット" }, [...items])).toMatchObject({
      itemId: "pokemon-violet-id",
      itemSlug: "pokemon-violet",
      itemMatchStatus: "matched",
    });

    expect(classifyListing({ title: "ポケットモンスター ソード / ポケットモンスター シールド" }, [...items])).toMatchObject({
      itemId: null,
      itemSlug: null,
      itemMatchStatus: "bundle",
    });

    expect(classifyListing({ title: "ドンキーコング バナンザ 立つうちわ" }, [
      ...items,
      {
        id: "ns2-dk-id",
        slug: "ns2-donkey-kong-bananza",
        displayName: "NS2 Donkey Kong Bananza",
        kind: "software",
        platform: "Nintendo Switch 2",
        series: "Donkey Kong",
        targetBuyPrice: null,
        normalizedAliases: ["ドンキーコングバナンザ", "donkeykongbananza"],
      },
    ])).toMatchObject({
      itemId: null,
      itemSlug: null,
      itemMatchStatus: "unmatched",
    });

    expect(
      classifyListing(
        {
          title: "Nintendo Switch 有機EL HEG-001 本体",
          keywordName: "switch_handhelds",
        },
        [...items],
      ),
    ).toMatchObject({
      itemId: "switch-oled-id",
      itemSlug: "switch_oled",
      itemMatchStatus: "matched",
      itemSubfamily: "HEG-001",
    });

    expect(
      classifyListing(
        {
          title: "Minecraft Nintendo Switch",
          keywordName: "switch_niche2",
        },
        [...items],
      ),
    ).toMatchObject({
      itemId: null,
      itemSlug: null,
      itemMatchStatus: "unmatched",
    });
  });
});

describe("item backfill", () => {
  let ctx: Awaited<ReturnType<typeof createTestContext>>;

  beforeAll(async () => {
    ctx = await createTestContext();
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it("is idempotent across repeated runs", async () => {
    const keyword = await ctx.prisma.keyword.create({
      data: {
        id: uniqueId("kw"),
        name: "pokemon",
        enabled: true,
        terms: ["pokemon"],
        filters: {},
        intervalSec: 60,
      },
    });

    const item = await ctx.prisma.item.create({
      data: {
        slug: "pokemon-violet",
        displayName: "Pokemon Violet",
        kind: "software",
        platform: "Nintendo Switch",
        series: "Pokemon",
        targetBuyPrice: 3600,
        enabled: true,
        matchers: {
          aliases: ["ポケットモンスターバイオレット", "pokemonviolet"],
        },
      },
    });

    await ctx.prisma.listing.create({
      data: {
        id: uniqueId("listing"),
        keywordId: keyword.id,
        sourceListingId: "m-violet",
        title: "ポケットモンスター バイオレット",
        url: "https://jp.mercari.com/item/m-violet",
        imageUrl: "https://example.com/violet.jpg",
        currency: "¥",
        numericPrice: 3200,
        rawPriceDisplay: "¥3200",
        rawJson: "{}",
        scrapedAt: new Date(),
      },
    });

    const first = await backfillListingItems(ctx.prisma, 50);
    expect(first.scanned).toBe(1);
    expect(first.updated).toBe(1);

    const listing = await ctx.prisma.listing.findUniqueOrThrow({
      where: { url: "https://jp.mercari.com/item/m-violet" },
    });
    expect(listing.itemId).toBe(item.id);
    expect(listing.itemMatchStatus).toBe("matched");

    const second = await backfillListingItems(ctx.prisma, 50);
    expect(second.scanned).toBe(1);
    expect(second.updated).toBe(0);
  });
});
