import { describe, expect, it } from "vitest";

import {
  computeArbitrageEconomics,
  landedCostUsd,
  maxBuyJpyForRoi,
  netProceedsUsd,
  type ArbitrageFeeModel,
} from "./arbitrage.js";

const feeModel: ArbitrageFeeModel = {
  ebayFinalValueFeePct: 13.25,
  ebayFixedFeeUsd: 0.3,
  ebayAdRatePct: 2,
  proxyFeeJpy: 500,
  proxyFeePct: 0,
  jpDomesticShippingJpy: 800,
  intlShippingUsdByClass: { small_packet: 8, console: 28 },
  targetRoiPct: 30,
};

describe("arbitrage economics", () => {
  it("computes landed cost from JPY-side costs plus international shipping", () => {
    // (5000 + 500 + 800) / 150 + 28 = 42 + 28 = 70
    expect(landedCostUsd({ buyJpy: 5000, shippingClass: "console", feeModel, jpyPerUsd: 150 })).toBe(70);
  });

  it("applies a percent proxy fee to the item price only", () => {
    const model = { ...feeModel, proxyFeeJpy: 0, proxyFeePct: 10, jpDomesticShippingJpy: 0 };
    // 5000 * 1.1 / 150 + 28 = 36.67 + 28
    expect(landedCostUsd({ buyJpy: 5000, shippingClass: "console", feeModel: model, jpyPerUsd: 150 })).toBe(64.67);
  });

  it("computes net proceeds after final value fee, ad rate, and fixed fee", () => {
    // 100 * (1 - 0.1525) - 0.30 = 84.45
    expect(netProceedsUsd(100, feeModel)).toBe(84.45);
  });

  it("throws on an unknown shipping class", () => {
    expect(() => landedCostUsd({ buyJpy: 1, shippingClass: "freight", feeModel, jpyPerUsd: 150 })).toThrow(
      /Unknown shipping class/,
    );
  });

  it("max-buy inverts landed cost so buying at max-buy hits the target ROI", () => {
    const net = netProceedsUsd(100, feeModel);
    const maxBuy = maxBuyJpyForRoi({
      netProceedsUsd: net,
      roiPct: 30,
      shippingClass: "console",
      feeModel,
      jpyPerUsd: 150,
    });
    expect(maxBuy).not.toBeNull();

    const landedAtMax = landedCostUsd({ buyJpy: maxBuy!, shippingClass: "console", feeModel, jpyPerUsd: 150 });
    const roi = ((net - landedAtMax) / landedAtMax) * 100;
    // Floor rounding means ROI lands at or just above target.
    expect(roi).toBeGreaterThanOrEqual(30);
    expect(roi).toBeLessThan(30.5);
  });

  it("returns null max-buy when fees exceed proceeds even for a free item", () => {
    expect(
      maxBuyJpyForRoi({ netProceedsUsd: 20, roiPct: 30, shippingClass: "console", feeModel, jpyPerUsd: 150 }),
    ).toBeNull();
  });

  it("computes a full economics breakdown", () => {
    const economics = computeArbitrageEconomics({
      buyJpy: 5000,
      listPriceUsd: 100,
      shippingClass: "console",
      feeModel,
      jpyPerUsd: 150,
    });

    expect(economics.landedCostUsd).toBe(70);
    expect(economics.netProceedsUsd).toBe(84.45);
    expect(economics.marginUsd).toBe(14.45);
    expect(economics.roiPct).toBe(20.6);
    expect(economics.breakevenBuyJpy).toBeGreaterThan(economics.maxBuyJpy!);
  });
});
