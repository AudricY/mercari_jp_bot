/**
 * Arbitrage unit economics: buy on Mercari JP (JPY), export via a proxy
 * service, sell on eBay US (USD). Pure functions so the fee model stays
 * testable and the numbers auditable.
 */

export interface ArbitrageFeeModel {
  /** eBay final value fee, percent of sale price (video games ≈ 13.25). */
  ebayFinalValueFeePct: number;
  /** eBay per-order fixed fee in USD (≈ 0.30). */
  ebayFixedFeeUsd: number;
  /** Promoted-listings ad rate percent (0 if not advertising). */
  ebayAdRatePct: number;
  /** Proxy/forwarder flat fee per item, JPY (plan fee, consolidation). */
  proxyFeeJpy: number;
  /** Proxy fee as percent of item price, JPY side. */
  proxyFeePct: number;
  /** Mercari seller → proxy warehouse domestic shipping, JPY. */
  jpDomesticShippingJpy: number;
  /** International shipping cost in USD, keyed by product shipping class. */
  intlShippingUsdByClass: Record<string, number>;
  /** ROI percent used to derive the max-buy price. */
  targetRoiPct: number;
}

export interface ArbitrageEconomics {
  /** Acquisition price used for the calculation (cheapest live listing). */
  buyJpy: number;
  /** Everything spent to get the item to a US buyer's door, USD. */
  landedCostUsd: number;
  /** eBay list price the revenue estimate is based on, USD. */
  listPriceUsd: number;
  /** List price minus eBay fees, USD. */
  netProceedsUsd: number;
  marginUsd: number;
  roiPct: number;
  /** Highest Mercari price that still hits targetRoiPct; null if unreachable. */
  maxBuyJpy: number | null;
  /** Highest Mercari price with margin ≥ 0; null if unreachable. */
  breakevenBuyJpy: number | null;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export function intlShippingUsd(feeModel: ArbitrageFeeModel, shippingClass: string): number {
  const cost = feeModel.intlShippingUsdByClass[shippingClass];
  if (cost === undefined) {
    throw new Error(`Unknown shipping class "${shippingClass}"`);
  }
  return cost;
}

/** Total cost in USD to acquire on Mercari and land the item stateside. */
export function landedCostUsd(params: {
  buyJpy: number;
  shippingClass: string;
  feeModel: ArbitrageFeeModel;
  jpyPerUsd: number;
}): number {
  const { buyJpy, feeModel, jpyPerUsd } = params;
  const jpySide =
    buyJpy * (1 + feeModel.proxyFeePct / 100) + feeModel.proxyFeeJpy + feeModel.jpDomesticShippingJpy;
  return round2(jpySide / jpyPerUsd + intlShippingUsd(feeModel, params.shippingClass));
}

/** What actually lands in the payout after eBay takes its cut. */
export function netProceedsUsd(listPriceUsd: number, feeModel: ArbitrageFeeModel): number {
  const feeRate = (feeModel.ebayFinalValueFeePct + feeModel.ebayAdRatePct) / 100;
  return round2(listPriceUsd * (1 - feeRate) - feeModel.ebayFixedFeeUsd);
}

/**
 * Invert the landed-cost formula: the highest JPY buy price whose landed cost
 * still leaves `roiPct` return against the given net proceeds. Null when even
 * a free item cannot reach it (shipping/fees exceed the proceeds).
 */
export function maxBuyJpyForRoi(params: {
  netProceedsUsd: number;
  roiPct: number;
  shippingClass: string;
  feeModel: ArbitrageFeeModel;
  jpyPerUsd: number;
}): number | null {
  const { feeModel, jpyPerUsd } = params;
  const allowedLandedUsd = params.netProceedsUsd / (1 + params.roiPct / 100);
  const jpyBudget = (allowedLandedUsd - intlShippingUsd(feeModel, params.shippingClass)) * jpyPerUsd;
  const maxBuy = (jpyBudget - feeModel.proxyFeeJpy - feeModel.jpDomesticShippingJpy) / (1 + feeModel.proxyFeePct / 100);
  return maxBuy > 0 ? Math.floor(maxBuy) : null;
}

export function computeArbitrageEconomics(params: {
  buyJpy: number;
  listPriceUsd: number;
  shippingClass: string;
  feeModel: ArbitrageFeeModel;
  jpyPerUsd: number;
}): ArbitrageEconomics {
  const { buyJpy, listPriceUsd, shippingClass, feeModel, jpyPerUsd } = params;
  const landed = landedCostUsd({ buyJpy, shippingClass, feeModel, jpyPerUsd });
  const net = netProceedsUsd(listPriceUsd, feeModel);
  const margin = round2(net - landed);

  return {
    buyJpy,
    landedCostUsd: landed,
    listPriceUsd: round2(listPriceUsd),
    netProceedsUsd: net,
    marginUsd: margin,
    roiPct: landed > 0 ? round1((margin / landed) * 100) : 0,
    maxBuyJpy: maxBuyJpyForRoi({
      netProceedsUsd: net,
      roiPct: feeModel.targetRoiPct,
      shippingClass,
      feeModel,
      jpyPerUsd,
    }),
    breakevenBuyJpy: maxBuyJpyForRoi({
      netProceedsUsd: net,
      roiPct: 0,
      shippingClass,
      feeModel,
      jpyPerUsd,
    }),
  };
}
