import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";

import type { Prisma, PrismaClient } from "@prisma/client";
import { parse } from "yaml";

import type { ArbitrageFeeModel } from "@mercari-bot/core";

const ARBITRAGE_CATALOG_PATH = fileURLToPath(
  new URL("../../../catalog/arbitrage-products.yaml", import.meta.url),
);

export interface ArbitrageProductSeed {
  id: string;
  label: string;
  platform: string;
  kind: "software" | "console" | "accessory" | "other";
  shippingClass: string;
  mercariCategoryIds: number[];
  mercariAliases: string[];
  mercariExclude: string[];
  ebayAliases: string[];
  ebayExclude: string[];
  ebayRequireAny: string[];
  maxBuyJpyOverride: number | null;
  notes: string | null;
}

export interface ArbitrageCatalog {
  feeModel: ArbitrageFeeModel;
  fxJpyPerUsdFallback: number;
  products: ArbitrageProductSeed[];
}

export interface ArbitrageProductSyncResult {
  created: string[];
  updated: string[];
  disabled: string[];
}

const VALID_KINDS = new Set(["software", "console", "accessory", "other"]);
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

function requirePositiveNumber(value: unknown, field: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`arbitrage-products.yaml: economics.${field} must be a positive number`);
  }
  return parsed;
}

function requireNonNegativeNumber(value: unknown, field: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`arbitrage-products.yaml: economics.${field} must be a non-negative number`);
  }
  return parsed;
}

function stringArray(value: unknown): string[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(`arbitrage-products.yaml: expected a string list, got ${JSON.stringify(value)}`);
  }
  return value.map((entry) => String(entry)).filter((entry) => entry.trim().length > 0);
}

export function parseArbitrageCatalog(content: string): ArbitrageCatalog {
  const raw = parse(content) as {
    economics?: Record<string, unknown>;
    products?: Array<Record<string, unknown>>;
  } | null;

  const economics = raw?.economics ?? {};
  const intlRaw = (economics.intl_shipping_usd_by_class ?? {}) as Record<string, unknown>;
  const intlShippingUsdByClass: Record<string, number> = {};
  for (const [key, value] of Object.entries(intlRaw)) {
    intlShippingUsdByClass[key] = requireNonNegativeNumber(value, `intl_shipping_usd_by_class.${key}`);
  }
  if (Object.keys(intlShippingUsdByClass).length === 0) {
    throw new Error("arbitrage-products.yaml: economics.intl_shipping_usd_by_class must define at least one class");
  }

  const feeModel: ArbitrageFeeModel = {
    ebayFinalValueFeePct: requireNonNegativeNumber(economics.ebay_final_value_fee_pct, "ebay_final_value_fee_pct"),
    ebayFixedFeeUsd: requireNonNegativeNumber(economics.ebay_fixed_fee_usd, "ebay_fixed_fee_usd"),
    ebayAdRatePct: requireNonNegativeNumber(economics.ebay_ad_rate_pct, "ebay_ad_rate_pct"),
    proxyFeeJpy: requireNonNegativeNumber(economics.proxy_fee_jpy, "proxy_fee_jpy"),
    proxyFeePct: requireNonNegativeNumber(economics.proxy_fee_pct, "proxy_fee_pct"),
    jpDomesticShippingJpy: requireNonNegativeNumber(economics.jp_domestic_shipping_jpy, "jp_domestic_shipping_jpy"),
    intlShippingUsdByClass,
    targetRoiPct: requireNonNegativeNumber(economics.target_roi_pct, "target_roi_pct"),
  };

  const fxJpyPerUsdFallback = requirePositiveNumber(economics.fx_jpy_per_usd_fallback, "fx_jpy_per_usd_fallback");

  const products: ArbitrageProductSeed[] = [];
  const seen = new Set<string>();

  for (const entry of raw?.products ?? []) {
    const id = String(entry.id ?? "").trim();
    if (!SLUG_PATTERN.test(id)) {
      throw new Error(`arbitrage-products.yaml: invalid id ${JSON.stringify(entry.id)} (lowercase slug required)`);
    }
    if (seen.has(id)) {
      throw new Error(`arbitrage-products.yaml: duplicate id ${id}`);
    }
    seen.add(id);

    const kind = String(entry.kind ?? "other");
    if (!VALID_KINDS.has(kind)) {
      throw new Error(`arbitrage-products.yaml: product ${id} has invalid kind "${kind}"`);
    }

    const shippingClass = String(entry.shipping_class ?? "").trim();
    if (!(shippingClass in intlShippingUsdByClass)) {
      throw new Error(
        `arbitrage-products.yaml: product ${id} shipping_class "${shippingClass}" not in intl_shipping_usd_by_class`,
      );
    }

    const mercari = (entry.mercari ?? {}) as Record<string, unknown>;
    const ebay = (entry.ebay ?? {}) as Record<string, unknown>;

    const mercariCategoryIds = (Array.isArray(mercari.category_ids) ? mercari.category_ids : []).map((value) => {
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error(`arbitrage-products.yaml: product ${id} has invalid mercari category id ${JSON.stringify(value)}`);
      }
      return parsed;
    });
    const mercariAliases = stringArray(mercari.aliases);
    const ebayAliases = stringArray(ebay.aliases);

    if (mercariCategoryIds.length === 0 || mercariAliases.length === 0) {
      throw new Error(`arbitrage-products.yaml: product ${id} needs mercari.category_ids and mercari.aliases`);
    }
    if (ebayAliases.length === 0) {
      throw new Error(`arbitrage-products.yaml: product ${id} needs ebay.aliases`);
    }

    const maxBuyRaw = entry.max_buy_jpy_override;
    const maxBuyJpyOverride =
      maxBuyRaw === undefined || maxBuyRaw === null ? null : Math.floor(requirePositiveNumber(maxBuyRaw, `products.${id}.max_buy_jpy_override`));

    products.push({
      id,
      label: String(entry.label ?? id),
      platform: String(entry.platform ?? "unknown"),
      kind: kind as ArbitrageProductSeed["kind"],
      shippingClass,
      mercariCategoryIds,
      mercariAliases,
      mercariExclude: stringArray(mercari.exclude),
      ebayAliases,
      ebayExclude: stringArray(ebay.exclude),
      ebayRequireAny: stringArray(ebay.require_any),
      maxBuyJpyOverride,
      notes: entry.notes === undefined || entry.notes === null ? null : String(entry.notes),
    });
  }

  return { feeModel, fxJpyPerUsdFallback, products };
}

export async function loadArbitrageCatalog(): Promise<ArbitrageCatalog> {
  const content = await fs.readFile(ARBITRAGE_CATALOG_PATH, "utf-8");
  return parseArbitrageCatalog(content);
}

/** Reconcile catalog/arbitrage-products.yaml into the arbitrage_products table. */
export async function syncArbitrageProductsFromDisk(prisma: PrismaClient): Promise<ArbitrageProductSyncResult> {
  const catalog = await loadArbitrageCatalog();
  const existing = await prisma.arbitrageProduct.findMany();
  const existingById = new Map(existing.map((product) => [product.id, product]));
  const seedIds = new Set(catalog.products.map((seed) => seed.id));
  const result: ArbitrageProductSyncResult = { created: [], updated: [], disabled: [] };

  for (const seed of catalog.products) {
    const data = {
      label: seed.label,
      platform: seed.platform,
      kind: seed.kind,
      shippingClass: seed.shippingClass,
      enabled: true,
      mercariCategoryIds: seed.mercariCategoryIds as unknown as Prisma.InputJsonValue,
      mercariAliases: seed.mercariAliases as unknown as Prisma.InputJsonValue,
      mercariExclude: seed.mercariExclude as unknown as Prisma.InputJsonValue,
      ebayAliases: seed.ebayAliases as unknown as Prisma.InputJsonValue,
      ebayExclude: seed.ebayExclude as unknown as Prisma.InputJsonValue,
      ebayRequireAny: seed.ebayRequireAny as unknown as Prisma.InputJsonValue,
      maxBuyJpyOverride: seed.maxBuyJpyOverride,
      notes: seed.notes,
    };

    if (existingById.has(seed.id)) {
      await prisma.arbitrageProduct.update({ where: { id: seed.id }, data });
      result.updated.push(seed.id);
    } else {
      await prisma.arbitrageProduct.create({ data: { id: seed.id, ...data } });
      result.created.push(seed.id);
    }
  }

  for (const product of existing) {
    if (!seedIds.has(product.id) && product.enabled) {
      await prisma.arbitrageProduct.update({ where: { id: product.id }, data: { enabled: false } });
      result.disabled.push(product.id);
    }
  }

  return result;
}
