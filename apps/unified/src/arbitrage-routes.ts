import type { FastifyInstance } from "fastify";
import type { Logger } from "pino";

import { computeArbitrageEconomics } from "@mercari-bot/core";

import type { ArbitrageDeps, ArbitrageOpportunity } from "./arbitrage.js";
import { buildArbitrageProductDetail, buildArbitrageReport } from "./arbitrage.js";

function mercariUrl(mercariId: string): string {
  return `https://jp.mercari.com/item/${mercariId}`;
}

function sortOpportunities(opportunities: ArbitrageOpportunity[], sort: string): ArbitrageOpportunity[] {
  const key = sort === "margin" ? ("marginUsd" as const) : ("roiPct" as const);
  return [...opportunities].sort((a, b) => {
    // Opportunities without economics sink to the bottom.
    const aValue = a.economics?.[key] ?? Number.NEGATIVE_INFINITY;
    const bValue = b.economics?.[key] ?? Number.NEGATIVE_INFINITY;
    return bValue - aValue;
  });
}

export function registerArbitrageRoutes(
  app: FastifyInstance<import("http").Server, import("http").IncomingMessage, import("http").ServerResponse, Logger>,
  deps: ArbitrageDeps,
) {
  app.get("/v1/analytics/arbitrage/opportunities", async (request) => {
    const { sort } = request.query as { sort?: string };
    const report = await buildArbitrageReport(deps);

    return {
      fx: {
        jpyPerUsd: report.fx.jpyPerUsd,
        source: report.fx.source,
        fetchedAt: report.fx.fetchedAt.toISOString(),
      },
      feeModel: report.feeModel,
      generatedAt: report.generatedAt.toISOString(),
      opportunities: sortOpportunities(report.opportunities, sort ?? "roi").map((opportunity) => ({
        slug: opportunity.slug,
        label: opportunity.label,
        platform: opportunity.platform,
        kind: opportunity.kind,
        shippingClass: opportunity.shippingClass,
        mercari: opportunity.mercari,
        ebay: opportunity.ebay,
        economics: opportunity.economics,
        verdict: opportunity.verdict,
        effectiveMaxBuyJpy: opportunity.effectiveMaxBuyJpy,
      })),
    };
  });

  app.get("/v1/analytics/arbitrage/products/:slug", async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const result = await buildArbitrageProductDetail(deps, slug);

    if (!result) {
      reply.code(404);
      return { error: `Unknown arbitrage product "${slug}"` };
    }

    const { detail, fx, feeModel, generatedAt } = result;
    const { product } = detail;

    return {
      product: {
        slug: product.id,
        label: product.label,
        platform: product.platform,
        kind: product.kind,
        shippingClass: product.shippingClass,
        notes: product.notes,
        mercariCategoryIds: product.mercariCategoryIds,
        enabled: product.enabled,
      },
      fx: { jpyPerUsd: fx.jpyPerUsd, source: fx.source, fetchedAt: fx.fetchedAt.toISOString() },
      feeModel,
      generatedAt: generatedAt.toISOString(),
      mercari: detail.mercari,
      ebay: detail.ebay,
      economics: detail.economics,
      verdict: detail.verdict,
      effectiveMaxBuyJpy: detail.effectiveMaxBuyJpy,
      mercariLive: detail.mercariLive.map((row) => {
        // Per-listing economics against this listing's own price; only the
        // revenue side (eBay median comp) is shared.
        const perListing =
          detail.ebay.medianLiveUsd === null
            ? null
            : computeArbitrageEconomics({
                buyJpy: row.price,
                listPriceUsd: detail.ebay.medianLiveUsd,
                shippingClass: product.shippingClass,
                feeModel,
                jpyPerUsd: fx.jpyPerUsd,
              });
        return {
          title: row.title,
          url: mercariUrl(row.mercariId),
          priceJpy: row.price,
          listedAt: new Date(row.mercariCreatedSec * 1000).toISOString(),
          thumbnailUrl: row.thumbnailUrl,
          landedCostUsd: perListing?.landedCostUsd ?? null,
          marginUsd: perListing?.marginUsd ?? null,
          roiPct: perListing?.roiPct ?? null,
        };
      }),
      mercariRecentSold: detail.mercariRecentSold.map((row) => ({
        title: row.title,
        url: mercariUrl(row.mercariId),
        soldPriceJpy: row.soldPrice,
        soldObservedAt: row.soldObservedAt?.toISOString() ?? null,
      })),
      ebayLive: detail.ebayLive.map((row) => ({
        title: row.title,
        url: row.itemWebUrl,
        priceUsd: Number(row.price),
        condition: row.condition,
        listedAt: row.ebayCreatedAt?.toISOString() ?? null,
        imageUrl: row.imageUrl,
      })),
    };
  });
}
