import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@mercari-bot/core", async () => {
  const actual = await vi.importActual<typeof import("@mercari-bot/core")>("@mercari-bot/core");
  return {
    ...actual,
    fetchMercariItemDetail: vi.fn(),
    scanMercariTerm: vi.fn(),
  };
});

import type { ScrapedListing } from "@mercari-bot/core";
import { fetchMercariItemDetail, scanMercariTerm } from "@mercari-bot/core";

import { scanKeyword } from "../src/scanner.js";
import { createTestContext, uniqueId } from "./test-env.js";

describe("scanKeyword listing ingestion", () => {
  let ctx: Awaited<ReturnType<typeof createTestContext>>;

  beforeAll(async () => {
    ctx = await createTestContext();
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    await ctx.prisma.notification.deleteMany();
    await ctx.prisma.seenListing.deleteMany();
    await ctx.prisma.listing.deleteMany();
    await ctx.prisma.scanRun.deleteMany();
    await ctx.prisma.keyword.deleteMany();
  });

  it("creates a listing and notification for a new listing", async () => {
    const keyword = await createKeyword();
    mockScanResults([listing({ id: "m-new", price: 12000 })]);

    const result = await scanKeyword(keyword.id, "manual", {
      config: ctx.config,
      logger: ctx.logger,
      metrics: ctx.metrics,
      prisma: ctx.prisma,
    });

    expect(result.itemsFound).toBe(1);
    expect(result.itemsNew).toBe(1);
    expect(await ctx.prisma.listing.count()).toBe(1);
    expect(await ctx.prisma.notification.count()).toBe(1);
    expect(await ctx.prisma.seenListing.count()).toBe(1);
  });

  it("updates a repeated same-price listing without notifying again", async () => {
    const keyword = await createKeyword();
    mockScanResults([listing({ id: "m-repeat", price: 15000 })]);
    await scanKeyword(keyword.id, "manual", {
      config: ctx.config,
      logger: ctx.logger,
      metrics: ctx.metrics,
      prisma: ctx.prisma,
    });

    mockScanResults([listing({ id: "m-repeat", price: 15000 })]);
    const result = await scanKeyword(keyword.id, "manual", {
      config: ctx.config,
      logger: ctx.logger,
      metrics: ctx.metrics,
      prisma: ctx.prisma,
    });

    expect(result.itemsFound).toBe(1);
    expect(result.itemsNew).toBe(0);
    expect(await ctx.prisma.listing.count()).toBe(1);
    expect(await ctx.prisma.notification.count()).toBe(1);

    const seen = await ctx.prisma.seenListing.findFirstOrThrow();
    expect(Number(seen.lastPrice)).toBe(15000);
  });

  it("creates a new notification when a listing gets cheaper", async () => {
    const keyword = await createKeyword();
    mockScanResults([listing({ id: "m-cheaper", price: 20000 })]);
    await scanKeyword(keyword.id, "manual", {
      config: ctx.config,
      logger: ctx.logger,
      metrics: ctx.metrics,
      prisma: ctx.prisma,
    });

    mockScanResults([listing({ id: "m-cheaper", price: 18000 })]);
    const result = await scanKeyword(keyword.id, "manual", {
      config: ctx.config,
      logger: ctx.logger,
      metrics: ctx.metrics,
      prisma: ctx.prisma,
    });

    expect(result.itemsFound).toBe(1);
    expect(result.itemsNew).toBe(1);
    expect(await ctx.prisma.notification.count()).toBe(2);

    const savedListing = await ctx.prisma.listing.findFirstOrThrow();
    expect(Number(savedListing.numericPrice)).toBe(18000);
  });

  it("continues when detail fetch fails after a new listing is discovered", async () => {
    const config = { ...ctx.config, SCRAPE_DETAIL_ENABLED: true };
    const keyword = await createKeyword();
    mockScanResults([listing({ id: "m-detail", price: 9999 })]);
    vi.mocked(fetchMercariItemDetail).mockRejectedValueOnce(new Error("detail fetch failed"));

    const result = await scanKeyword(keyword.id, "manual", {
      config,
      logger: ctx.logger,
      metrics: ctx.metrics,
      prisma: ctx.prisma,
    });

    expect(result.itemsFound).toBe(1);
    expect(result.itemsNew).toBe(1);
    expect(fetchMercariItemDetail).toHaveBeenCalledTimes(1);
    expect(await ctx.prisma.notification.count()).toBe(1);

    const run = await ctx.prisma.scanRun.findFirstOrThrow();
    expect(run.status).toBe("success");
  });

  it("records per-term scan stats for multi-term keywords", async () => {
    const keyword = await createKeyword({ terms: ["vita", "psp"] });
    vi.mocked(scanMercariTerm)
      .mockResolvedValueOnce([listing({ id: "m-vita", price: 9999 })])
      .mockResolvedValueOnce([]);

    const result = await scanKeyword(keyword.id, "manual", {
      config: ctx.config,
      logger: ctx.logger,
      metrics: ctx.metrics,
      prisma: ctx.prisma,
    });

    expect(result.itemsFound).toBe(1);
    expect(result.itemsNew).toBe(1);

    const run = await ctx.prisma.scanRun.findFirstOrThrow({
      include: { terms: { orderBy: { createdAt: "asc" } } },
    });
    expect(run.status).toBe("success");
    expect(run.termsAttempted).toBe(2);
    expect(run.termsSucceeded).toBe(2);
    expect(run.termsRateLimited).toBe(0);
    expect(run.termsFailed).toBe(0);
    expect(run.terms.map((term) => ({
      term: term.term,
      status: term.status,
      itemsFound: term.itemsFound,
      itemsNew: term.itemsNew,
    }))).toEqual([
      { term: "vita", status: "success", itemsFound: 1, itemsNew: 1 },
      { term: "psp", status: "success", itemsFound: 0, itemsNew: 0 },
    ]);
  });

  it("stops remaining terms and marks the run rate_limited when Mercari returns 429 first", async () => {
    const keyword = await createKeyword({ terms: ["vita", "psp"] });
    vi.mocked(scanMercariTerm).mockRejectedValueOnce(new Error("Mercari API responded with 429: Too Many Requests"));

    const result = await scanKeyword(keyword.id, "manual", {
      config: ctx.config,
      logger: ctx.logger,
      metrics: ctx.metrics,
      prisma: ctx.prisma,
    });

    expect(result.itemsFound).toBe(0);
    expect(result.itemsNew).toBe(0);
    expect(scanMercariTerm).toHaveBeenCalledTimes(1);

    const run = await ctx.prisma.scanRun.findFirstOrThrow({
      include: { terms: true },
    });
    expect(run.status).toBe("rate_limited");
    expect(run.errorCode).toBe("rate_limited");
    expect(run.termsAttempted).toBe(1);
    expect(run.termsSucceeded).toBe(0);
    expect(run.termsRateLimited).toBe(1);
    expect(run.termsFailed).toBe(0);
    expect(run.terms).toHaveLength(1);
    expect(run.terms[0]).toMatchObject({
      term: "vita",
      status: "rate_limited",
      statusCode: 429,
      itemsFound: 0,
      itemsNew: 0,
    });
  });

  it("marks the run partial when a later term is rate-limited", async () => {
    const keyword = await createKeyword({ terms: ["vita", "psp"] });
    vi.mocked(scanMercariTerm)
      .mockResolvedValueOnce([listing({ id: "m-vita", price: 9999 })])
      .mockRejectedValueOnce(new Error("Mercari API responded with 429: Too Many Requests"));

    await scanKeyword(keyword.id, "manual", {
      config: ctx.config,
      logger: ctx.logger,
      metrics: ctx.metrics,
      prisma: ctx.prisma,
    });

    const run = await ctx.prisma.scanRun.findFirstOrThrow({
      include: { terms: { orderBy: { createdAt: "asc" } } },
    });
    expect(run.status).toBe("partial");
    expect(run.termsAttempted).toBe(2);
    expect(run.termsSucceeded).toBe(1);
    expect(run.termsRateLimited).toBe(1);
    expect(run.terms.map((term) => term.status)).toEqual(["success", "rate_limited"]);
  });

  it("skips missing or disabled keywords", async () => {
    const missing = await scanKeyword("missing-keyword", "manual", {
      config: ctx.config,
      logger: ctx.logger,
      metrics: ctx.metrics,
      prisma: ctx.prisma,
    });
    expect(missing).toEqual({ runId: "", itemsFound: 0, itemsNew: 0 });

    const disabledKeyword = await createKeyword({ enabled: false });
    const disabled = await scanKeyword(disabledKeyword.id, "manual", {
      config: ctx.config,
      logger: ctx.logger,
      metrics: ctx.metrics,
      prisma: ctx.prisma,
    });
    expect(disabled).toEqual({ runId: "", itemsFound: 0, itemsNew: 0 });
    expect(await ctx.prisma.scanRun.count()).toBe(0);
  });

  async function createKeyword(overrides: { enabled?: boolean; terms?: unknown } = {}) {
    return ctx.prisma.keyword.create({
      data: {
        id: uniqueId("kw"),
        name: uniqueId("keyword"),
        enabled: overrides.enabled ?? true,
        terms: overrides.terms ?? ["vita"],
        filters: {},
        intervalSec: 60,
      },
    });
  }
});

function mockScanResults(results: ScrapedListing[]) {
  vi.mocked(scanMercariTerm).mockResolvedValueOnce(results);
}

function listing({ id, price }: { id: string; price: number }): ScrapedListing {
  return {
    title: `Listing ${id}`,
    url: `https://jp.mercari.com/item/${id}`,
    imageUrl: `https://example.com/${id}.jpg`,
    currency: "¥",
    numericPrice: price,
    rawPriceDisplay: `¥${price.toLocaleString()}`,
    rawJson: JSON.stringify({ id, price }),
  };
}
