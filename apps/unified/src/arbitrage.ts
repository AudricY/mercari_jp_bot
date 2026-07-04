import type { ArbitrageProduct, PrismaClient } from "@prisma/client";
import type { Logger } from "pino";

import {
  computeArbitrageEconomics,
  type AppConfig,
  type ArbitrageEconomics,
  type ArbitrageFeeModel,
} from "@mercari-bot/core";

import { loadArbitrageCatalog } from "./arbitrage-config.js";
import { getJpyPerUsd, type FxRate } from "./fx.js";
import { normalizeForMatch } from "./items.js";
import { computePriceStats } from "./market-stats.js";

export interface ArbitrageDeps {
  config: AppConfig;
  logger: Logger;
  prisma: PrismaClient;
}

export interface CompiledArbitrageProduct {
  id: string;
  label: string;
  platform: string;
  kind: string;
  shippingClass: string;
  enabled: boolean;
  notes: string | null;
  maxBuyJpyOverride: number | null;
  mercariCategoryIds: number[];
  mercariAliases: string[];
  mercariExclude: string[];
  ebayAliases: string[];
  ebayExclude: string[];
  ebayRequireAny: string[];
}

export interface ArbitrageMercariStats {
  liveCount: number;
  cheapestLiveJpy: number | null;
  cheapestLiveUrl: string | null;
  cheapestLiveTitle: string | null;
  medianLiveJpy: number | null;
  medianSoldJpy: number | null;
  soldCount30d: number;
}

export interface ArbitrageEbayStats {
  liveCount: number;
  lowestLiveUsd: number | null;
  lowestLiveUrl: string | null;
  medianLiveUsd: number | null;
  goneCount30d: number;
}

export type ArbitrageVerdict = "buy" | "watch" | "skip" | "no_data";

export interface ArbitrageOpportunity {
  slug: string;
  label: string;
  platform: string;
  kind: string;
  shippingClass: string;
  mercari: ArbitrageMercariStats;
  ebay: ArbitrageEbayStats;
  economics: ArbitrageEconomics | null;
  verdict: ArbitrageVerdict;
  /** Alert threshold actually in effect (override or derived max-buy). */
  effectiveMaxBuyJpy: number | null;
}

export interface ArbitrageReport {
  fx: FxRate;
  feeModel: ArbitrageFeeModel;
  generatedAt: Date;
  opportunities: ArbitrageOpportunity[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

function jsonStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((entry) => String(entry)) : [];
}

function jsonNumberArray(value: unknown): number[] {
  return Array.isArray(value) ? value.map((entry) => Number(entry)).filter((entry) => Number.isFinite(entry)) : [];
}

export function compileArbitrageProduct(product: ArbitrageProduct): CompiledArbitrageProduct {
  return {
    id: product.id,
    label: product.label,
    platform: product.platform,
    kind: product.kind,
    shippingClass: product.shippingClass,
    enabled: product.enabled,
    notes: product.notes,
    maxBuyJpyOverride: product.maxBuyJpyOverride,
    mercariCategoryIds: jsonNumberArray(product.mercariCategoryIds),
    mercariAliases: jsonStringArray(product.mercariAliases).map(normalizeForMatch).filter(Boolean),
    mercariExclude: jsonStringArray(product.mercariExclude).map(normalizeForMatch).filter(Boolean),
    ebayAliases: jsonStringArray(product.ebayAliases).map(normalizeForMatch).filter(Boolean),
    ebayExclude: jsonStringArray(product.ebayExclude).map(normalizeForMatch).filter(Boolean),
    ebayRequireAny: jsonStringArray(product.ebayRequireAny).map(normalizeForMatch).filter(Boolean),
  };
}

export function matchesMercariTitle(product: CompiledArbitrageProduct, title: string): boolean {
  const normalized = normalizeForMatch(title);
  if (!product.mercariAliases.some((alias) => normalized.includes(alias))) {
    return false;
  }
  return !product.mercariExclude.some((term) => normalized.includes(term));
}

export function matchesEbayTitle(product: CompiledArbitrageProduct, title: string): boolean {
  const normalized = normalizeForMatch(title);
  if (!product.ebayAliases.some((alias) => normalized.includes(alias))) {
    return false;
  }
  if (product.ebayExclude.some((term) => normalized.includes(term))) {
    return false;
  }
  if (product.ebayRequireAny.length > 0 && !product.ebayRequireAny.some((term) => normalized.includes(term))) {
    return false;
  }
  return true;
}

interface MercariListingRow {
  mercariId: string;
  title: string;
  price: number;
  status: string;
  thumbnailUrl: string | null;
  mercariCreatedSec: number;
  soldPrice: number | null;
  soldObservedAt: Date | null;
}

interface EbayListingRow {
  ebayItemId: string;
  title: string;
  price: unknown; // Prisma Decimal
  currency: string;
  status: string;
  condition: string | null;
  itemWebUrl: string;
  imageUrl: string | null;
  ebayCreatedAt: Date | null;
  lastSeenAt: Date;
}

export interface ArbitrageProductDetail {
  product: CompiledArbitrageProduct;
  mercari: ArbitrageMercariStats;
  ebay: ArbitrageEbayStats;
  economics: ArbitrageEconomics | null;
  verdict: ArbitrageVerdict;
  effectiveMaxBuyJpy: number | null;
  mercariLive: MercariListingRow[];
  mercariRecentSold: MercariListingRow[];
  ebayLive: EbayListingRow[];
}

async function fetchMercariRows(prisma: PrismaClient, categoryIds: number[]): Promise<MercariListingRow[]> {
  if (categoryIds.length === 0) {
    return [];
  }
  return prisma.marketListing.findMany({
    where: { categoryId: { in: categoryIds } },
    select: {
      mercariId: true,
      title: true,
      price: true,
      status: true,
      thumbnailUrl: true,
      mercariCreatedSec: true,
      soldPrice: true,
      soldObservedAt: true,
    },
  });
}

async function fetchEbayRows(prisma: PrismaClient): Promise<EbayListingRow[]> {
  return prisma.ebayListing.findMany({
    select: {
      ebayItemId: true,
      title: true,
      price: true,
      currency: true,
      status: true,
      condition: true,
      itemWebUrl: true,
      imageUrl: true,
      ebayCreatedAt: true,
      lastSeenAt: true,
    },
  });
}

function mercariUrl(mercariId: string): string {
  return `https://jp.mercari.com/item/${mercariId}`;
}

function computeMercariStats(matched: MercariListingRow[], now: Date): ArbitrageMercariStats {
  const live = matched.filter((row) => row.status === "on_sale").sort((a, b) => a.price - b.price);
  const cutoff = new Date(now.getTime() - 30 * DAY_MS);
  const sold30d = matched.filter(
    (row) => row.soldPrice !== null && row.soldObservedAt !== null && row.soldObservedAt >= cutoff,
  );

  const cheapest = live[0] ?? null;
  return {
    liveCount: live.length,
    cheapestLiveJpy: cheapest?.price ?? null,
    cheapestLiveUrl: cheapest ? mercariUrl(cheapest.mercariId) : null,
    cheapestLiveTitle: cheapest?.title ?? null,
    medianLiveJpy: live.length > 0 ? computePriceStats(live.map((row) => row.price)).median : null,
    medianSoldJpy: sold30d.length > 0 ? computePriceStats(sold30d.map((row) => row.soldPrice!)).median : null,
    soldCount30d: sold30d.length,
  };
}

function computeEbayStats(matched: EbayListingRow[], now: Date): ArbitrageEbayStats {
  const live = matched
    .filter((row) => row.status === "on_sale" && row.currency === "USD")
    .map((row) => ({ ...row, priceUsd: Number(row.price) }))
    .sort((a, b) => a.priceUsd - b.priceUsd);
  const cutoff = new Date(now.getTime() - 30 * DAY_MS);
  const gone30d = matched.filter((row) => row.status === "gone" && row.lastSeenAt >= cutoff);

  const lowest = live[0] ?? null;
  return {
    liveCount: live.length,
    lowestLiveUsd: lowest?.priceUsd ?? null,
    lowestLiveUrl: lowest?.itemWebUrl ?? null,
    medianLiveUsd: live.length > 0 ? computePriceStats(live.map((row) => row.priceUsd)).median : null,
    goneCount30d: gone30d.length,
  };
}

function buildOpportunity(
  product: CompiledArbitrageProduct,
  mercari: ArbitrageMercariStats,
  ebay: ArbitrageEbayStats,
  feeModel: ArbitrageFeeModel,
  jpyPerUsd: number,
): ArbitrageOpportunity {
  let economics: ArbitrageEconomics | null = null;
  if (mercari.cheapestLiveJpy !== null && ebay.medianLiveUsd !== null) {
    economics = computeArbitrageEconomics({
      buyJpy: mercari.cheapestLiveJpy,
      listPriceUsd: ebay.medianLiveUsd,
      shippingClass: product.shippingClass,
      feeModel,
      jpyPerUsd,
    });
  }

  const effectiveMaxBuyJpy = product.maxBuyJpyOverride ?? economics?.maxBuyJpy ?? null;

  let verdict: ArbitrageVerdict;
  if (economics === null) {
    verdict = "no_data";
  } else if (effectiveMaxBuyJpy !== null && economics.buyJpy <= effectiveMaxBuyJpy) {
    verdict = "buy";
  } else if (economics.marginUsd > 0) {
    verdict = "watch";
  } else {
    verdict = "skip";
  }

  return {
    slug: product.id,
    label: product.label,
    platform: product.platform,
    kind: product.kind,
    shippingClass: product.shippingClass,
    mercari,
    ebay,
    economics,
    verdict,
    effectiveMaxBuyJpy,
  };
}

let reportCache: { report: ArbitrageReport; expiresAt: number } | null = null;

/** Test hook. */
export function resetArbitrageCache(): void {
  reportCache = null;
}

export async function buildArbitrageReport(deps: ArbitrageDeps, options?: { skipCache?: boolean }): Promise<ArbitrageReport> {
  const { config, logger, prisma } = deps;

  if (!options?.skipCache && reportCache && Date.now() < reportCache.expiresAt) {
    return reportCache.report;
  }

  const catalog = await loadArbitrageCatalog();
  const fx = await getJpyPerUsd({
    pin: config.ARBITRAGE_FX_JPY_PER_USD,
    fallback: catalog.fxJpyPerUsdFallback,
    logger,
  });

  const products = (await prisma.arbitrageProduct.findMany({ where: { enabled: true }, orderBy: { id: "asc" } })).map(
    compileArbitrageProduct,
  );

  const now = new Date();
  const ebayRows = await fetchEbayRows(prisma);
  const mercariRowsByCategory = new Map<string, MercariListingRow[]>();

  const opportunities: ArbitrageOpportunity[] = [];
  for (const product of products) {
    const categoryKey = product.mercariCategoryIds.join(",");
    let mercariRows = mercariRowsByCategory.get(categoryKey);
    if (!mercariRows) {
      mercariRows = await fetchMercariRows(prisma, product.mercariCategoryIds);
      mercariRowsByCategory.set(categoryKey, mercariRows);
    }

    const mercariMatched = mercariRows.filter((row) => matchesMercariTitle(product, row.title));
    const ebayMatched = ebayRows.filter((row) => matchesEbayTitle(product, row.title));

    opportunities.push(
      buildOpportunity(
        product,
        computeMercariStats(mercariMatched, now),
        computeEbayStats(ebayMatched, now),
        catalog.feeModel,
        fx.jpyPerUsd,
      ),
    );
  }

  const report: ArbitrageReport = { fx, feeModel: catalog.feeModel, generatedAt: now, opportunities };

  const ttlMs = config.ARBITRAGE_CACHE_TTL_SEC * 1000;
  if (ttlMs > 0) {
    reportCache = { report, expiresAt: Date.now() + ttlMs };
  }
  return report;
}

export async function buildArbitrageProductDetail(
  deps: ArbitrageDeps,
  slug: string,
): Promise<{ detail: ArbitrageProductDetail; fx: FxRate; feeModel: ArbitrageFeeModel; generatedAt: Date } | null> {
  const { config, logger, prisma } = deps;

  const record = await prisma.arbitrageProduct.findUnique({ where: { id: slug } });
  if (!record) {
    return null;
  }
  const product = compileArbitrageProduct(record);

  const catalog = await loadArbitrageCatalog();
  const fx = await getJpyPerUsd({
    pin: config.ARBITRAGE_FX_JPY_PER_USD,
    fallback: catalog.fxJpyPerUsdFallback,
    logger,
  });

  const now = new Date();
  const mercariRows = (await fetchMercariRows(prisma, product.mercariCategoryIds)).filter((row) =>
    matchesMercariTitle(product, row.title),
  );
  const ebayRows = (await fetchEbayRows(prisma)).filter((row) => matchesEbayTitle(product, row.title));

  const mercariStats = computeMercariStats(mercariRows, now);
  const ebayStats = computeEbayStats(ebayRows, now);
  const opportunity = buildOpportunity(product, mercariStats, ebayStats, catalog.feeModel, fx.jpyPerUsd);

  const mercariLive = mercariRows
    .filter((row) => row.status === "on_sale")
    .sort((a, b) => a.price - b.price)
    .slice(0, 10);
  const mercariRecentSold = mercariRows
    .filter((row) => row.soldPrice !== null && row.soldObservedAt !== null)
    .sort((a, b) => b.soldObservedAt!.getTime() - a.soldObservedAt!.getTime())
    .slice(0, 10);
  const ebayLive = ebayRows
    .filter((row) => row.status === "on_sale" && row.currency === "USD")
    .sort((a, b) => Number(a.price) - Number(b.price))
    .slice(0, 10);

  return {
    detail: {
      product,
      mercari: mercariStats,
      ebay: ebayStats,
      economics: opportunity.economics,
      verdict: opportunity.verdict,
      effectiveMaxBuyJpy: opportunity.effectiveMaxBuyJpy,
      mercariLive,
      mercariRecentSold,
      ebayLive,
    },
    fx,
    feeModel: catalog.feeModel,
    generatedAt: now,
  };
}
